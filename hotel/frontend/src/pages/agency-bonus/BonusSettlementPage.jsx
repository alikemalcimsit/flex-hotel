import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AGENCY_BONUS_METRIC_LABELS,
  AGENCY_BONUS_MODE_LABELS,
  AGENCY_BONUS_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
  formatBonusPeriod,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SETTLEMENT_STATUS_TONES, agencyBonusKeys, formatQuantity, formatScore, useAgencyBonusLive, useBonusSettlement } from '../../lib/agencyBonus.js';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { useChannelTime } from '../../lib/channelManager.js';
import { formatDate, formatMoney, formatPercent } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { PayDialog, ReasonDialog, SubmitDialog } from './BonusDialogs.jsx';
import { Figure } from './BonusProgress.jsx';
import { SliceTable } from './BonusRulePage.jsx';

const STALE_TEXT = 'Hak ediş bu arada başkası tarafından değiştirildi; ekran yenilendi, tekrar deneyin.';
const LINE_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const LINE_SORTS = Object.freeze([
  { value: 'REVENUE_DESC', label: 'Ciro (yüksek önce)' },
  { value: 'NIGHTS_DESC', label: 'Gece (çok önce)' },
  { value: 'CHECK_IN', label: 'Giriş tarihi' },
]);

/**
 * Döküm Excel'i: rezervasyon başına gece ve vergisiz oda geliri (acenteye
 * gönderilen hak ediş eki, muhasebe kontrolü).
 * @param {any} bonus
 * @param {{ items: any[], currency: string }} data
 */
async function downloadLines(bonus, data) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = ['Onay kodu', 'Misafir', 'Oda tipi', 'Giriş', 'Çıkış', 'Durum', 'Dönemdeki gece', `Vergisiz oda geliri (${data.currency})`].map((value) => ({
    value,
    fontWeight: 'bold',
    backgroundColor: '#eef2f7',
  }));
  const rows = data.items.map((line) => [
    { value: line.confirmationCode, type: String },
    { value: line.guestName, type: String },
    { value: line.roomType?.name ?? '', type: String },
    { value: line.checkIn, type: String },
    { value: line.checkOut, type: String },
    { value: RESERVATION_STATUS_LABELS[line.status] ?? line.status, type: String },
    { value: line.nights, type: Number },
    { value: Number(line.revenue), type: Number, format: '#,##0.00' },
  ]);
  const total = [
    { value: 'Toplam', fontWeight: 'bold' },
    null,
    null,
    null,
    null,
    null,
    { value: bonus.nights, type: Number, fontWeight: 'bold' },
    { value: Number(bonus.revenue), type: Number, format: '#,##0.00', fontWeight: 'bold' },
  ];
  await writeXlsxFile([header, ...rows, total], {
    sheet: 'Hak ediş',
    columns: [{ width: 14 }, { width: 28 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 22 }],
    stickyRowsCount: 1,
  }).toFile(`prim-hak-edis-${bonus.agency.code}-${bonus.periodEnd}.xlsx`);
}

/**
 * Hak ediş ekranı (modül 35): dönem sonu hesabının dondurulmuş hali — rakamlar,
 * dilim dökümü, uyarılar (bugünkü veriyle fark, kural değişti, işlenmemiş gece,
 * son ret gerekçesi), akış eylemleri (yeniden hesapla, onaya gönder, ödendi,
 * yeniden aç, ödemeyi geri al), geçmiş ve rezervasyon dökümü (Excel).
 */
export function BonusSettlementPage() {
  const { bonusId } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const query = useBonusSettlement(bonusId);
  const timeOf = useChannelTime();
  const { today } = useHotelToday();
  useAgencyBonusLive();
  const [dialog, setDialog] = useState(null);
  /** Excel hazırlanırken parça ilerlemesi ("2/3"); boşta `false`. */
  const [exporting, setExporting] = useState(/** @type {string | false} */ (false));

  const action = useMutation({
    mutationFn: ({ path, body }) => apiPost(path, body),
    onSuccess: (result, { message }) => {
      setDialog(null);
      queryClient.invalidateQueries({ queryKey: agencyBonusKeys.all });
      queryClient.setQueryData(agencyBonusKeys.settlement(bonusId), result);
      toastSuccess(message);
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE' || error.code === 'BONUS_STALE') queryClient.invalidateQueries({ queryKey: agencyBonusKeys.all });
    },
  });

  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <QueryFallback query={query} errorTitle="Hak ediş yüklenemedi" />
      </div>
    );
  }

  const bonus = query.data;
  const currency = bonus.currency;
  const busy = action.isPending;
  const canManage = can(PERMISSIONS.AGENCY_BONUS_MANAGE);
  const canPay = can(PERMISSIONS.AGENCY_BONUS_PAY);
  const zero = Number(bonus.amount) <= 0;
  const blocked = bonus.status === 'DRAFT' && (bonus.drift || bonus.ruleChanged);
  const quantity = (value) => formatQuantity(bonus.metric, value, currency);
  const run = (path, body, message) => action.mutate({ path, body, message });
  const base = `/agency-bonus/settlements/${bonus.id}`;

  // Döküm parça parça çekilir (büyük tur operatöründe on binlerce satır), tek dosyada birleşir.
  async function exportLines() {
    setExporting('1');
    try {
      const first = await api(withQuery(`${base}/export`, { part: 1 }));
      const items = [...first.items];
      for (let part = 2; part <= first.parts; part += 1) {
        setExporting(`${part}/${first.parts}`);
        const next = await api(withQuery(`${base}/export`, { part }));
        items.push(...next.items);
      }
      await downloadLines(bonus, { items, currency: first.currency });
    } catch (error) {
      toastError(error.message);
    } finally {
      setExporting(false);
    }
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      {bonus.status === 'DRAFT' && canManage && (
        <>
          <Button type="button" variant="outline" icon="refresh" disabled={busy} onClick={() => run(`/agency-bonus/rules/${bonus.ruleId}/settle`, {}, 'Hak ediş yeniden hesaplandı')}>
            Yeniden hesapla
          </Button>
          <Button type="button" icon={zero ? 'check' : 'send'} disabled={busy || Boolean(blocked)} title={blocked ? 'Önce yeniden hesaplayın' : undefined} onClick={() => setDialog('submit')}>
            {zero ? 'Kapat (prim yok)' : 'Onaya gönder'}
          </Button>
        </>
      )}
      {bonus.status === 'APPROVED' && canPay && !zero && (
        <Button type="button" icon="banknote" disabled={busy} onClick={() => setDialog('pay')}>
          Ödendi işaretle
        </Button>
      )}
      {bonus.status === 'APPROVED' && canManage && (
        <Button type="button" variant="outline" icon="rotateCcw" disabled={busy} onClick={() => setDialog('reopen')}>
          Yeniden aç
        </Button>
      )}
      {bonus.status === 'PAID' && canPay && (
        <Button type="button" variant="outline" icon="rotateCcw" disabled={busy} onClick={() => setDialog('revert')}>
          Ödemeyi geri al
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader
        title={`Hak ediş: ${bonus.agency.name}`}
        description={
          <>
            <Link to={`/acente-primleri/kural/${bonus.ruleId}`} className="font-semibold hover:underline">
              {bonus.rule.name}
            </Link>
            {` · ${formatBonusPeriod(bonus.periodStart, bonus.periodEnd)} · ${AGENCY_BONUS_METRIC_LABELS[bonus.metric]} · ${AGENCY_BONUS_MODE_LABELS[bonus.mode]}`}
          </>
        }
        actions={actions}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SETTLEMENT_STATUS_TONES[bonus.status]}>{AGENCY_BONUS_STATUS_LABELS[bonus.status]}</Badge>
        {bonus.revision > 1 && <Badge tone="neutral">{bonus.revision}. sürüm</Badge>}
        {bonus.status === 'PENDING_APPROVAL' && bonus.approvalId && can(PERMISSIONS.APPROVALS_VIEW) && (
          <Link to={`/onaylar/bekleyen?onay=${bonus.approvalId}`} className="text-sm font-semibold text-info-ink hover:underline">
            Onay kuyruğunda aç
          </Link>
        )}
      </div>

      {bonus.status === 'DRAFT' && bonus.ruleChanged && (
        <Alert tone="warning" title="Kural hesaptan sonra değişti">
          Bu hak ediş eski koşullarla hesaplandı. Onaya göndermeden önce yeniden hesaplayın.
        </Alert>
      )}
      {bonus.drift && (
        <Alert tone={bonus.status === 'DRAFT' ? 'warning' : 'info'} title={bonus.status === 'DRAFT' ? 'Hesaptan sonra üretim değişti' : 'Onaydan sonra üretim değişti'}>
          Bugünkü verilerle fark: {bonus.drift.nights >= 0 ? '+' : ''}
          {bonus.drift.nights} gece, {formatMoney(bonus.drift.revenue, currency)} vergisiz ciro. Prim bugün {formatMoney(bonus.currentAmount, currency)} olurdu.
          {bonus.status === 'DRAFT' ? ' Onaya göndermeden önce yeniden hesaplayın.' : bonus.status === 'APPROVED' ? ' Düzeltmek için hak edişi yeniden açıp yeniden hesaplayın.' : ' Hak ediş ödendi; fark bilgi içindir.'}
        </Alert>
      )}
      {bonus.missingPostings > 0 && (
        <Alert tone="warning" title="Folyoya işlenmemiş geceler">
          Gerçekleşmiş {bonus.missingPostings} gecenin oda ücreti folyoya işlenmemiş; ciro ve prim eksik olabilir. Gece oda ücretlerini kontrol edip yeniden hesaplayın.
        </Alert>
      )}
      {bonus.decisionNote && (
        <Alert tone={bonus.status === 'DRAFT' ? 'warning' : 'info'} title={bonus.status === 'DRAFT' ? 'Son karar' : 'Onay notu'}>
          {bonus.decisionNote}
        </Alert>
      )}

      <Card>
        <section aria-label="Hak ediş" className="flex flex-col gap-4 p-1">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Figure label="Gerçekleşen" value={quantity(bonus.achieved)} hint={`${bonus.reservationCount.toLocaleString('tr-TR')} rezervasyon`} />
            <Figure label="Hedef" value={quantity(bonus.target)} hint={`Puan ${formatScore(bonus.scorePct)}`} tone={Number(bonus.scorePct) >= 100 ? 'success' : 'neutral'} />
            <Figure label="Vergisiz oda geliri" value={formatMoney(bonus.revenue, currency)} hint={`${bonus.nights.toLocaleString('tr-TR')} gece`} />
            <Figure label="Kademe" value={bonus.tierIndex ? `${bonus.tierIndex}.` : 'Yok'} hint={bonus.tierIndex ? `Oran ${formatPercent(bonus.tiers[bonus.tierIndex - 1]?.ratePct ?? '0')}` : 'Kademeye ulaşılmadı'} />
            <Figure label="Prim" value={formatMoney(bonus.amount, currency)} tone="success" hint={bonus.capped ? `Tavan öncesi ${formatMoney(bonus.grossAmount, currency)}` : bonus.maxBonus ? `Tavan ${formatMoney(bonus.maxBonus, currency)}` : 'Tavansız'} />
          </dl>
          {bonus.slices.length > 0 && <SliceTable slices={bonus.slices} metric={bonus.metric} currency={currency} />}
          {bonus.roomTypes.length > 0 && <p className="text-xs text-ink-muted">Sayılan oda tipleri: {bonus.roomTypes.map((type) => type.name).join(', ')}</p>}
        </section>
      </Card>

      <Card>
        <section aria-label="Geçmiş" className="flex flex-col gap-2 p-1">
          <h2 className="text-base font-bold text-ink">Geçmiş</h2>
          <ol className="flex flex-col gap-1.5 text-sm text-ink-soft">
            <li>
              Hesaplandı: {bonus.calculatedBy === 'system' ? 'Sistem (dönem sonu)' : bonus.calculatedBy} · {timeOf(bonus.calculatedAt)}
            </li>
            {bonus.reopenedAt && (
              <li>
                Yeniden açıldı: {bonus.reopenedBy} · {timeOf(bonus.reopenedAt)} — {bonus.reopenReason}
              </li>
            )}
            {bonus.submittedAt && (
              <li>
                Onaya gönderildi: {bonus.submittedBy} · {timeOf(bonus.submittedAt)}
                {bonus.submitNote && ` — ${bonus.submitNote}`}
              </li>
            )}
            {bonus.approvedAt && (
              <li>
                Onaylandı: {bonus.approvedBy} · {timeOf(bonus.approvedAt)}
              </li>
            )}
            {bonus.paidAt && (
              <li>
                Ödendi: {formatDate(bonus.paidAt)} · belge {bonus.paymentRef} · işleyen {bonus.paidBy}
                {bonus.paymentNote && ` — ${bonus.paymentNote}`}
              </li>
            )}
          </ol>
        </section>
      </Card>

      <BonusLines bonus={bonus} onExport={exportLines} exporting={exporting} />

      {dialog === 'submit' && (
        <SubmitDialog
          open
          bonus={bonus}
          busy={busy}
          onConfirm={(body) => run(`${base}/submit`, body, zero ? 'Hak ediş kapandı (prim yok)' : 'Hak ediş onaya gönderildi')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'pay' && (
        <PayDialog
          open
          bonus={bonus}
          today={today}
          busy={busy}
          serverErrors={action.error?.fields}
          onConfirm={(body) => run(`${base}/pay`, body, 'Hak ediş ödendi olarak işaretlendi')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'reopen' && (
        <ReasonDialog
          open
          title="Hak edişi yeniden aç"
          intro="Onay kalkar, hak ediş yeniden hesaplanabilir ve yeniden onaya gider (sürüm artar). Önceki onay denetim izinde kalır."
          label="Yeniden açma gerekçesi"
          confirmLabel="Yeniden aç"
          confirmVariant="primary"
          confirmIcon="rotateCcw"
          version={bonus.updatedAt}
          busy={busy}
          serverErrors={action.error?.fields}
          onConfirm={(body) => run(`${base}/reopen`, body, 'Hak ediş yeniden açıldı')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'revert' && (
        <ReasonDialog
          open
          title="Ödeme işaretini geri al"
          intro="Hak ediş onaylı (ödenmemiş) duruma döner. Ödeme kaydı denetim izinde kalır."
          label="Geri alma gerekçesi"
          confirmLabel="Geri al"
          confirmIcon="rotateCcw"
          version={bonus.updatedAt}
          busy={busy}
          serverErrors={action.error?.fields}
          onConfirm={(body) => run(`${base}/revert-payment`, body, 'Ödeme işareti geri alındı')}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/**
 * Rezervasyon dökümü (sayfalı; onay kodu / misafir araması, sıralama, Excel).
 * @param {{ bonus: any, onExport: () => void, exporting: string | false }} props `exporting`: hazırlanan parça ("2/3") ya da yok
 */
function BonusLines({ bonus, onExport, exporting }) {
  const can = useCan();
  const canOpenReservation = can(PERMISSIONS.RESERVATIONS_VIEW);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('REVENUE_DESC');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filters = { search, sort, page, version: bonus.updatedAt };
  const lines = useQuery({
    queryKey: agencyBonusKeys.lines(bonus.id, filters),
    queryFn: () => api(withQuery(`/agency-bonus/settlements/${bonus.id}/lines`, { search: search || undefined, sort, page, pageSize: LINE_PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });
  const currency = bonus.currency;
  const columns = [
    {
      key: 'reservation',
      header: 'Rezervasyon',
      render: (row) => {
        const body = (
          <>
            <span className={`block font-mono text-xs font-semibold text-ink ${canOpenReservation ? 'hover:underline' : ''}`}>{row.confirmationCode}</span>
            <span className="block truncate text-xs text-ink-muted">{row.guestName}</span>
          </>
        );
        // Muhasebenin rezervasyon ekranı izni yok: kod düz metin.
        return canOpenReservation ? (
          <Link to={`/rezervasyonlar/${row.reservationId}`} className="block min-w-0">
            {body}
          </Link>
        ) : (
          <span className="block min-w-0">{body}</span>
        );
      },
    },
    { key: 'roomType', header: 'Oda tipi', render: (row) => <span className="text-xs">{row.roomType?.name}</span> },
    {
      key: 'stay',
      header: 'Konaklama',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block text-ink">{formatBonusPeriod(row.checkIn, row.checkOut)}</span>
          <span className="block text-ink-muted">{RESERVATION_STATUS_LABELS[row.status] ?? row.status}</span>
        </span>
      ),
    },
    { key: 'nights', header: 'Dönemdeki gece', className: 'text-right tabular-nums', render: (row) => row.nights.toLocaleString('tr-TR') },
    { key: 'revenue', header: 'Vergisiz ciro', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => formatMoney(row.revenue, currency) },
  ];

  return (
    <Card>
      <section aria-label="Rezervasyon dökümü" className="flex flex-col gap-3 p-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">Rezervasyon dökümü</h2>
            <p className="text-xs text-ink-muted">Hesap anında dondurulmuş: hangi rezervasyon kaç gece ve ne kadar ciroyla sayıldı.</p>
          </div>
          <Button type="button" variant="outline" icon="download" onClick={onExport} disabled={Boolean(exporting) || bonus.reservationCount === 0}>
            {exporting ? `Hazırlanıyor… ${exporting === '1' ? '' : exporting}`.trim() : 'Excel'}
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Ara" name="bonus-line-search" placeholder="Onay kodu ya da misafir" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:max-w-xs" />
          <Select label="Sırala" name="bonus-line-sort" options={LINE_SORTS} value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} className="w-full sm:w-52" />
        </div>
        <DataTable
          columns={columns}
          rows={lines.data?.items}
          meta={lines.data?.meta}
          isLoading={lines.isPending}
          isFetching={lines.isFetching}
          error={lines.isError ? lines.error : null}
          onRetry={() => lines.refetch()}
          onPageChange={setPage}
          emptyTitle={search ? 'Aramaya uyan rezervasyon yok' : 'Dönemde sayılan rezervasyon yok'}
          emptyHint={search ? 'Aramayı değiştirin.' : undefined}
        />
      </section>
    </Card>
  );
}

function BackLink() {
  return (
    <Link to="/acente-primleri/hak-edis" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      Hak ediş raporu
    </Link>
  );
}
