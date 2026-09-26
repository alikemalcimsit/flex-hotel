import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BOARD_TYPE_LABELS, OCCUPANCY_LOW_PCT, ROOM_BLOCK_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Card, EmptyState, Icon, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { useManualTaskScope, useManualTaskSummary } from '../../lib/actors.js';
import { useApprovalSummary } from '../../lib/approvals.js';
import {
  WEEK_DAYS_BEFORE_TODAY,
  longDay,
  shiftIsoDay,
  useDashboardLive,
  useDashboardToday,
  useDashboardWeek,
} from '../../lib/dashboard.js';
import { formatMoney } from '../../lib/format.js';
import { READINESS, frontDeskKeys } from '../../lib/front-desk.js';
import { useInboxSummary, useRequestSummary } from '../../lib/frontOffice.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { QueryError } from '../activity/shared.jsx';
import { WeekOccupancyChart } from './WeekOccupancyChart.jsx';

/** Ana sayfadaki gelecek / gidecek kısa listesinin satır sayısı (tamamı ön büroda). */
const SHORT_LIST_SIZE = 5;

/**
 * Günlük durum (modül 13): müdürün sabah baktığı tek ekran — doluluk (dünle
 * kıyaslı), kalan oda, gelecek / gidecek, oda durumu, vergiler hariç oda
 * geliri, ADR ve RevPAR, haftalık doluluk, oda tipine göre bu gece,
 * konaklayan misafirler, bekleyen işler, bugünün kısa listeleri.
 *
 * Sayılar sunucudan hesaplanmış gelir (tanımlar oda planıyla aynı); ekran
 * yalnızca gösterir. Rezervasyon, giriş / çıkış ve oda durumu değişince
 * canlı tazelenir.
 */
export function DashboardOverview() {
  const can = useCan();
  const live = useDashboardLive({ enabled: true });
  const todayQuery = useDashboardToday({ enabled: true });
  const data = todayQuery.data;
  const weekFrom = data ? shiftIsoDay(data.businessDate, -WEEK_DAYS_BEFORE_TODAY) : null;
  const weekQuery = useDashboardWeek({ from: weekFrom });

  return (
    <section aria-labelledby="dashboard-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-title" className="text-lg font-bold text-ink">
          Günlük durum{data ? ` · ${longDay(data.businessDate)}` : ''}
        </h2>
        <span className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
          {todayQuery.isFetching && !todayQuery.isPending && <Spinner label="Yenileniyor…" />}
          <Badge tone={live.isLive ? 'success' : 'warning'}>{live.isLive ? 'Canlı' : 'Canlı değil · 5 dk’da bir'}</Badge>
        </span>
      </div>

      {todayQuery.isPending && <Spinner label="Günün durumu yükleniyor…" className="py-12" />}
      {todayQuery.isError && <QueryError query={todayQuery} title="Günün durumu yüklenemedi" />}

      {data && data.totalRooms === 0 && (
        <EmptyState
          icon="bed"
          title="Henüz oda tanımlı değil"
          description="Doluluk ve gelir, odalar tanımlanıp rezervasyon girildikçe burada görünür (Ayarlar › Oda tipleri, Odalar)."
        />
      )}

      {data && data.totalRooms > 0 && (
        <>
          {data.today.available < 0 && (
            <Alert tone="danger" title="Bu gece fazla satış var">
              Satılan oda satılabilir odadan {-data.today.available} fazla. Oda planından ve onay kuyruğundan kontrol edin.
            </Alert>
          )}
          {data.today.otherCurrencies.length > 0 && (
            <Alert tone="warning" title="Otelin para birimi dışında rezervasyon var">
              Bu gece {data.today.otherCurrencies.map((entry) => formatMoney(entry.amount, entry.currency)).join(', ')} tutarındaki
              gelir {data.currency} toplamına ve ADR'ye katılmadı.
            </Alert>
          )}
          <KpiGrid data={data} can={can} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <WeekOccupancyChart query={weekQuery} />
            <PendingWork faults={data.faults} can={can} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <RoomTypesTonight rows={data.roomTypes} />
            <GuestsTonight guests={data.guests} />
          </div>
          {can(PERMISSIONS.STAYS_VIEW) && (
            <div className="grid gap-5 lg:grid-cols-2">
              <StayShortList kind="arrivals" title="Bugün gelecekler" total={data.arrivals.expected} to="/on-buro/gelecekler" />
              <StayShortList kind="departures" title="Bugün gidecekler" total={data.departures.expected} to="/on-buro/gidecekler" />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Doluluk farkı (puan) — dün geceye göre.
 * @param {number} today
 * @param {number} yesterday
 */
function pointsDiff(today, yesterday) {
  const diff = today - yesterday;
  if (diff === 0) return 'aynı';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} puan`;
}

/**
 * Gelir farkı (yüzde) — dün geceye göre; dün gelir yoksa kıyas yok.
 * @param {string} today
 * @param {string} yesterday
 */
function percentDiff(today, yesterday) {
  const base = Number(yesterday);
  if (!(base > 0)) return null;
  const change = Math.round(((Number(today) - base) / base) * 100);
  if (change === 0) return 'aynı';
  return `${change > 0 ? '+' : '−'}%${Math.abs(change)}`;
}

/**
 * Altı kart: doluluk, gelecekler, gidecekler, odalar, kat hizmeti ve arıza, gelir.
 * @param {{ data: any, can: (permission: string) => boolean }} props
 */
function KpiGrid({ data, can }) {
  const { today, yesterday, arrivals, departures, rooms } = data;
  const staysLink = can(PERMISSIONS.STAYS_VIEW);
  const roomsLink = can(PERMISSIONS.ROOMS_VIEW);
  // Odası verilmemiş gelecekler, şu an verilebilecek (hazır ve kimseye atanmamış) odadan fazlaysa temizlik yetişmeli.
  const cleaningBehind = arrivals.unassigned > rooms.vacantReadyFree;
  const revenueChange = percentDiff(today.revenue, yesterday.revenue);
  const taxNote = Number(data.includedTaxRate) > 0 ? `Vergiler hariç (%${data.includedTaxRate.replace('.', ',')})` : 'Fiyata dahil vergi yok';

  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Kpi
        icon="percent"
        label="Doluluk (bu gece)"
        value={`%${today.occupancyPct}`}
        valueHint={`Dün gece %${yesterday.occupancyPct} · ${pointsDiff(today.occupancyPct, yesterday.occupancyPct)}`}
        tone={today.available < 0 ? 'danger' : today.occupancyPct < OCCUPANCY_LOW_PCT ? 'warning' : 'neutral'}
        lines={[
          `${today.sold} / ${today.sellable} satılabilir oda${today.pendingSold > 0 ? ` · ${today.pendingSold} opsiyonlu` : ''}`,
          today.available > 0
            ? `${today.available} oda daha satılabilir`
            : today.available === 0
              ? 'Bu gece satılacak oda kalmadı'
              : `${-today.available} oda fazla satılmış`,
          today.outOfOrder > 0 ? `${today.outOfOrder} arızalı oda paydadan düştü` : 'Arızalı oda yok',
        ]}
        to={roomsLink ? '/oda-plani' : null}
      />
      <Kpi
        icon="arrowRight"
        label="Gelecekler"
        value={String(arrivals.expected)}
        valueHint="bekleniyor"
        tone={arrivals.late > 0 ? 'danger' : arrivals.unassigned > 0 ? 'warning' : 'neutral'}
        lines={[
          `Bugün giriş yapan: ${arrivals.checkedIn}`,
          arrivals.unassigned > 0 ? `${arrivals.unassigned} misafirin odası verilmedi` : 'Hepsinin odası verildi',
          ...(arrivals.late > 0 ? [`${arrivals.late} misafir dünden beri bekleniyor (gelmedi adayı)`] : []),
        ]}
        to={staysLink ? '/on-buro/gelecekler' : null}
      />
      <Kpi
        icon="logout"
        label="Gidecekler"
        value={String(departures.expected)}
        valueHint="çıkış bekleniyor"
        tone={departures.overdue > 0 ? 'danger' : 'neutral'}
        lines={[
          `Bugün çıkış yapan: ${departures.checkedOut}`,
          departures.overdue > 0 ? `${departures.overdue} gecikmiş çıkış` : `İçeride ${data.inHouse} konaklama`,
        ]}
        to={staysLink ? '/on-buro/gidecekler' : null}
      />
      <Kpi
        icon="bed"
        label="Odalar (şu an)"
        value={`${rooms.occupied} dolu · ${rooms.vacant} boş`}
        lines={[`Hazır boş oda: ${rooms.vacantReady}`, `Bunlardan bu gece kimseye verilmemiş: ${rooms.vacantReadyFree}`]}
        to={roomsLink ? '/odalar/liste' : null}
      />
      <Kpi
        icon="wrench"
        label="Kat hizmeti ve arıza"
        value={`${rooms.dirty} kirli · ${today.outOfOrder} arızalı`}
        tone={cleaningBehind ? 'warning' : 'neutral'}
        lines={[
          cleaningBehind
            ? `Odası verilmemiş ${arrivals.unassigned} misafire ${rooms.vacantReadyFree} hazır oda var: temizlik öncelikli`
            : `Temizleniyor ${rooms.cleaning} · kontrol edildi ${rooms.inspected}`,
          today.outOfService > 0 ? `${today.outOfService} oda hizmet dışı (satışta)` : 'Hizmet dışı oda yok',
        ]}
        to={roomsLink ? '/odalar/liste' : null}
      />
      <Kpi
        icon="bookOpen"
        label="Oda geliri (bu gece)"
        value={formatMoney(today.revenue, data.currency)}
        valueHint={revenueChange ? `Dün geceye göre ${revenueChange}` : undefined}
        lines={[
          `ADR ${today.adr !== null ? formatMoney(today.adr, data.currency) : '—'} · RevPAR ${
            today.revpar !== null ? formatMoney(today.revpar, data.currency) : '—'
          }`,
          `${taxNote}${Number(today.pendingRevenue) > 0 ? ` · ${formatMoney(today.pendingRevenue, data.currency)} opsiyonlu` : ''}`,
        ]}
      />
    </ul>
  );
}

const TONES = Object.freeze({ neutral: 'text-ink', warning: 'text-warning-ink', danger: 'text-sec-strong' });

/**
 * @param {{ icon: string, label: string, value: string, valueHint?: string, lines: string[],
 *   tone?: 'neutral' | 'warning' | 'danger', to?: string | null }} props
 */
function Kpi({ icon, label, value, valueHint, lines, tone = 'neutral', to = null }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink-muted">{label}</p>
        <span className="grid size-9 place-items-center rounded-control bg-black/[0.05] text-ink">
          <Icon name={icon} className="size-4" />
        </span>
      </div>
      <p className={`mt-2 text-2xl font-bold leading-tight ${TONES[tone]}`}>{value}</p>
      {valueHint && <p className="text-xs font-semibold text-ink-muted">{valueHint}</p>}
      <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
  const className = 'block h-full rounded-card bg-surface p-5 shadow-card';
  return (
    <li>
      {to ? (
        <Link to={to} className={`${className} transition duration-200 hover:-translate-y-0.5 hover:shadow-float`}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

/**
 * Oda tipine göre bu gece: satılan / satılabilir, doluluk, kalan. Rezervasyon
 * ekranının "yer var mı" cevabıyla aynı sayı; negatif kalan fazla satıştır.
 * @param {{ rows: any[] }} props
 */
function RoomTypesTonight({ rows }) {
  return (
    <Card title="Oda tipine göre bu gece" description="Hangi tip doluyor, hangisinde yer var. Kalan = daha satılabilecek oda.">
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">Odası olan oda tipi yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-2 py-2 font-bold">Tip</th>
                <th scope="col" className="px-2 py-2 text-right font-bold">Satılan / satılabilir</th>
                <th scope="col" className="px-2 py-2 text-right font-bold">Doluluk</th>
                <th scope="col" className="px-2 py-2 text-right font-bold">Kalan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <th scope="row" className="px-2 py-2 text-left font-semibold text-ink">
                    {row.name}
                    <span className="ml-1 font-mono text-[0.7rem] text-ink-muted">{row.code}</span>
                    {row.outOfOrder > 0 && <span className="ml-1 text-xs font-normal text-ink-muted">· {row.outOfOrder} arızalı</span>}
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {row.sold} / {row.sellable}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">%{row.occupancyPct}</td>
                  <td
                    className={`px-2 py-2 text-right font-bold tabular-nums ${
                      row.available < 0 ? 'text-sec-strong' : row.available === 0 ? 'text-warning-ink' : 'text-ink'
                    }`}
                  >
                    {row.available < 0 ? `${row.available} (fazla)` : row.available === 0 ? 'Dolu' : row.available}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * Bu gece konaklayanlar: kişi sayısı ve pansiyon dağılımı (kahvaltı ve mutfak
 * planı). Eldeki rezervasyonun kişi sayısı; opsiyonlular dahil.
 * @param {{ guests: any }} props
 */
function GuestsTonight({ guests }) {
  return (
    <Card title="Bu gece konaklayan" description="Rezervasyondaki kişi sayısı; kahvaltı ve mutfak planı için pansiyona göre.">
      {guests.stays === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">Bu gece konaklayan yok.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-2xl font-bold text-ink">
            {guests.guests} misafir
            <span className="ml-2 text-sm font-semibold text-ink-muted">
              {guests.adults} yetişkin · {guests.children} çocuk · {guests.stays} oda
            </span>
          </p>
          <ul className="divide-y divide-line text-sm">
            {guests.byBoard.map((entry) => (
              <li key={entry.boardType} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-ink-soft">{BOARD_TYPE_LABELS[entry.boardType] ?? entry.boardType}</span>
                <span className="tabular-nums text-ink">
                  <span className="font-bold">{entry.guests}</span> kişi
                  <span className="ml-1 text-xs text-ink-muted">({entry.stays} oda)</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/**
 * Bekleyen işler: onaylar, manuel görevler, cevapsız mesajlar, açık
 * istekler, açık arızalar. Kişi yalnızca yetkisi olanı görür; özetler
 * sunucuda önbellekli (her panel ayrı hesaplatmaz).
 *
 * @param {{ faults: { total: number, items: any[] }, can: (permission: string) => boolean }} props
 */
function PendingWork({ faults, can }) {
  const canApprovals = can(PERMISSIONS.APPROVALS_VIEW);
  const canMessages = can(PERMISSIONS.MESSAGES_VIEW);
  const canRequests = can(PERMISSIONS.REQUESTS_VIEW);
  const taskScope = useManualTaskScope();
  const approvals = useApprovalSummary({ enabled: canApprovals });
  const tasks = useManualTaskSummary({ enabled: !taskScope.empty });
  const inbox = useInboxSummary({ enabled: canMessages });
  const requests = useRequestSummary({ enabled: canRequests });

  return (
    <Card title="Bekleyen işler" description="Kararınızı ya da elinizi bekleyenler.">
      <ul className="divide-y divide-line">
        {canApprovals && (
          <PendingRow
            icon="checkCheck"
            label="Onay bekleyen"
            query={approvals}
            value={(summary) => summary.pending}
            hint={(summary) =>
              summary.pending === 0
                ? 'Bekleyen onay yok'
                : summary.expiringSoon > 0
                  ? `${summary.expiringSoon} tanesinin süresi bir saat içinde doluyor`
                  : 'Süresi yaklaşan yok'
            }
            urgent={(summary) => summary.expiringSoon > 0}
            to="/onaylar/bekleyen"
          />
        )}
        {!taskScope.empty && (
          <PendingRow
            icon="wrench"
            label="Manuel görev"
            query={tasks}
            value={(summary) => summary.open}
            hint={(summary) =>
              summary.open === 0
                ? 'Açık görev yok'
                : summary.open - summary.claimed > 0
                  ? `${summary.open - summary.claimed} tanesini kimse üstlenmedi`
                  : 'Hepsi üstlenildi'
            }
            urgent={(summary) => summary.open - summary.claimed > 0}
            to="/gorevler"
          />
        )}
        {canMessages && (
          <PendingRow
            icon="message"
            label="Cevap bekleyen mesaj"
            query={inbox}
            value={(summary) => summary.waiting}
            hint={(summary) =>
              summary.waiting === 0
                ? 'Cevapsız misafir yok'
                : summary.waitingTooLong > 0
                  ? `${summary.waitingTooLong} tanesi ${summary.replyWarningMinutes} dakikadan uzun süredir bekliyor`
                  : 'Hepsi yeni'
            }
            urgent={(summary) => summary.waitingTooLong > 0}
            to="/mesajlar"
          />
        )}
        {canRequests && (
          <PendingRow
            icon="clipboard"
            label="Açık misafir isteği"
            query={requests}
            value={(summary) => summary.open}
            hint={(summary) => (summary.overdue > 0 ? `${summary.overdue} tanesi gecikti` : summary.open === 0 ? 'Açık istek yok' : 'Geciken yok')}
            urgent={(summary) => summary.overdue > 0}
            to="/istekler"
          />
        )}
        <li className="py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-control bg-black/[0.05] text-ink">
              <Icon name="alertTriangle" className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">Açık arıza kaydı</span>
              <span className="block text-xs text-ink-muted">
                {faults.total === 0 ? 'Bugün arızalı ya da hizmet dışı oda yok' : 'Arızalı oda satılamaz; hizmet dışı oda satışta ama atanmaz'}
              </span>
            </span>
            <span className={`text-xl font-bold tabular-nums ${faults.total > 0 ? 'text-warning-ink' : 'text-ink'}`}>{faults.total}</span>
          </div>
          {faults.items.length > 0 && (
            <ul className="mt-2 space-y-1 pl-12 text-xs">
              {faults.items.map((fault) => (
                <li key={fault.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold tabular-nums text-ink">{fault.roomNumber}</span>
                  <Badge tone={fault.type === 'OUT_OF_ORDER' ? 'danger' : 'warning'}>{ROOM_BLOCK_TYPE_LABELS[fault.type]}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink-soft" title={fault.reason}>
                    {fault.reason}
                  </span>
                  <span className="text-ink-muted">{fault.endDate ? `${longDay(fault.endDate)} tarihinde biter` : 'süresiz'}</span>
                </li>
              ))}
              {faults.total > faults.items.length && (
                <li className="text-ink-muted">ve {faults.total - faults.items.length} kayıt daha (Odalar › Oda listesi)</li>
              )}
            </ul>
          )}
        </li>
      </ul>
    </Card>
  );
}

/**
 * @param {{ icon: string, label: string, query: import('@tanstack/react-query').UseQueryResult<any>,
 *   value: (summary: any) => number, hint: (summary: any) => string, urgent: (summary: any) => boolean, to: string }} props
 */
function PendingRow({ icon, label, query, value, hint, urgent, to }) {
  const summary = query.data;
  return (
    <li className="py-3">
      <Link to={to} className="flex items-center gap-3 rounded-item hover:bg-black/[0.02]">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-black/[0.05] text-ink">
          <Icon name={icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{label}</span>
          <span className="block text-xs text-ink-muted">
            {query.isPending ? 'Yükleniyor…' : query.isError ? 'Yüklenemedi; bölüme gidip bakın' : hint(summary)}
          </span>
        </span>
        <span className={`text-xl font-bold tabular-nums ${summary && urgent(summary) ? 'text-sec-strong' : 'text-ink'}`}>
          {summary ? value(summary) : '—'}
        </span>
      </Link>
    </li>
  );
}

/**
 * Bugünün gelecek / gidecek kısa listesi; tamamı ön büroda. Dünden kalan
 * gelen (gelmedi adayı) ve gecikmiş çıkış ayrıca işaretli.
 * @param {{ kind: 'arrivals' | 'departures', title: string, total: number, to: string }} props
 */
function StayShortList({ kind, title, total, to }) {
  const filters = { view: 'EXPECTED', page: 1, pageSize: SHORT_LIST_SIZE, shortList: true };
  const query = useQuery({
    queryKey: frontDeskKeys.list(kind, filters),
    queryFn: () => api(withQuery(`/front-desk/${kind}`, { view: 'EXPECTED', page: 1, pageSize: SHORT_LIST_SIZE })),
  });
  const items = query.data?.items ?? [];
  return (
    <Card
      title={title}
      actions={
        <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink hover:underline">
          Tümü ({total}) <Icon name="arrowRight" className="size-4" />
        </Link>
      }
    >
      {query.isPending && <Spinner label="Yükleniyor…" className="py-6" />}
      {query.isError && <QueryError query={query} title="Liste yüklenemedi" />}
      {query.isSuccess && items.length === 0 && (
        <p className="py-4 text-center text-sm text-ink-muted">
          {kind === 'arrivals' ? 'Bugün gelmesi beklenen misafir kalmadı.' : 'Bugün çıkışı beklenen misafir kalmadı.'}
        </p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-line">
          {items.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className="w-12 shrink-0 text-base font-bold tabular-nums text-ink">{row.room?.number ?? '—'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{row.guest.name}</span>
                <Link to={`/rezervasyonlar/${row.id}`} className="font-mono text-xs font-bold text-info-ink underline-offset-2 hover:underline">
                  {row.confirmationCode}
                </Link>
              </span>
              {kind === 'arrivals' && row.lateArrival && <Badge tone="danger">Dünden beri bekleniyor</Badge>}
              {kind === 'arrivals' && !row.room && <Badge tone="warning">Oda verilmedi</Badge>}
              {kind === 'arrivals' && row.roomState && (
                <Badge tone={READINESS[row.roomState.readiness]?.tone}>{READINESS[row.roomState.readiness]?.label}</Badge>
              )}
              {kind === 'departures' && row.overdue && <Badge tone="danger">Gecikmiş</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
