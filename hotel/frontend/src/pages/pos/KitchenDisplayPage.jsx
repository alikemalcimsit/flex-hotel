import { Link, useSearchParams } from 'react-router-dom';
import { KITCHEN_ORDER_STATUS_LABELS, KDS_LATE_MINUTES, KDS_WARN_MINUTES, POS_STATIONS, POS_STATION_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, EmptyState, Icon } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { deliveryOrderPath } from '../../lib/delivery.js';
import { boardSummary, cardTone, kdsActions, waitedMinutes } from '../../lib/kds.js';
import { useAdvanceKitchenOrder, useKitchenBoard, useKitchenLive } from '../../lib/kdsQueries.js';
import { checkPath, timeText, usePosOutlets } from '../../lib/pos.js';
import { orderPath } from '../../lib/roomService.js';
import { useNow } from '../../lib/useNow.js';

/** Kartlardaki süre yarım dakikada bir tazelenir (eşikler dakika). */
const CLOCK_TICK_MS = 30_000;
/** Kanal kopukken pano bu aralıkla okunur. */
const OFFLINE_REFRESH_MS = 15_000;

/** Mutfağa düşen istasyonlar (NONE — tepsi ücreti gibi — mutfağa gitmez). */
const STATION_OPTIONS = Object.freeze(POS_STATIONS.filter((station) => station !== 'NONE').map((station) => ({ value: station, label: POS_STATION_LABELS[station] })));

const TONE_CLASSES = Object.freeze({
  new: 'border-info-line bg-surface',
  preparing: 'border-violet-300 bg-violet-50/60',
  warn: 'border-warning-line bg-warning-soft/60',
  late: 'border-danger-line bg-danger-soft/60',
  ready: 'border-success-line bg-success-soft/60',
});
const STATUS_TONES = Object.freeze({ NEW: 'info', PREPARING: 'violet', READY: 'success' });
const CLOCK_CLASSES = Object.freeze({ warn: 'text-warning-ink', late: 'text-danger-ink', ready: 'text-success-ink' });

/**
 * Mutfak ekranı / KDS (modül 40): mutfak tabletinde açık duran pano. Turlar düştükleri sırayla (en eski önde),
 * geçen süreyle ve renkle (yeni / hazırlanıyor / 10 dk uyarı / 20 dk gecikti / hazır); kartta masa ya da oda
 * (teslim saatiyle), kalemler ve notlar, "Başla" / "Hazır" / "Servis edildi". "Hazır" garsonun ziline düşer.
 * Süzgeçler (satış noktası, istasyon) adres çubuğunda: tablet yenilense de istasyon kalır.
 */
export function KitchenDisplayPage() {
  const { isLive } = useKitchenLive();
  const now = useNow(CLOCK_TICK_MS);
  const [params, setParams] = useSearchParams();
  const outlets = (usePosOutlets().data?.items ?? []).filter((outlet) => outlet.isActive);
  const outletId = outlets.some((outlet) => outlet.id === params.get('nokta')) ? params.get('nokta') : '';
  const station = STATION_OPTIONS.some((option) => option.value === params.get('istasyon')) ? params.get('istasyon') : '';
  const board = useKitchenBoard({ outletId, station }, { refetchInterval: isLive ? false : OFFLINE_REFRESH_MS });
  const advance = useAdvanceKitchenOrder();

  /** @param {string} key @param {string} value */
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/pos" className="flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="size-4" /> Restoran
        </Link>
        <h1 className="text-2xl font-bold text-ink">Mutfak ekranı</h1>
        <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : `Bağlantı yok · ${OFFLINE_REFRESH_MS / 1000} sn'de bir okunuyor`}</Badge>
        {board.isSuccess && <Summary cards={board.data} now={now} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <ChoiceChips label="İstasyon" options={[{ value: '', label: 'Bütün istasyonlar' }, ...STATION_OPTIONS]} value={station} onChange={(value) => setFilter('istasyon', value)} required />
        {outlets.length > 1 && (
          <ChoiceChips
            label="Satış noktası"
            options={[{ value: '', label: 'Bütün noktalar' }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
            value={outletId}
            onChange={(value) => setFilter('nokta', value)}
            required
          />
        )}
      </div>
      {board.isPending || board.isError ? (
        <QueryFallback query={board} errorTitle="Mutfak panosu yüklenemedi" />
      ) : board.data.length === 0 ? (
        <EmptyState icon="utensils" title="Mutfakta bekleyen sipariş yok" description="Garson “Gönder” dediğinde tur buraya düşer." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {board.data.map((card) => (
            <KitchenCard
              key={card.orderId}
              card={card}
              now={now}
              showStation={!station}
              busy={advance.isPending && advance.variables?.orderId === card.orderId}
              onAdvance={(status) => advance.mutate({ orderId: card.orderId, status, expectedUpdatedAt: card.updatedAt })}
            />
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">
        Renk: {KDS_WARN_MINUTES} dakikada sarı, {KDS_LATE_MINUTES} dakikada kırmızı; hazır tur yeşil. Oda servisi ve paket turu mutfakta “hazır”da biter, teslimi kendi panosundan.
      </p>
    </div>
  );
}

/** @param {{ cards: any[], now: number }} props */
function Summary({ cards, now }) {
  const summary = boardSummary(cards, now);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Özet">
      <Badge tone="info">Yeni {summary.NEW}</Badge>
      <Badge tone="violet">Hazırlanıyor {summary.PREPARING}</Badge>
      <Badge tone="success">Hazır {summary.READY}</Badge>
      {summary.late > 0 && <Badge tone="danger">Gecikti {summary.late}</Badge>}
    </div>
  );
}

/**
 * Tur kartı: yer (masa / oda / masasız), geçen süre, adisyon ve tur, kalemler ve notlar, durum düğmeleri.
 * @param {{ card: any, now: number, showStation: boolean, busy: boolean, onAdvance: (status: string) => void }} props
 */
function KitchenCard({ card, now, showStation, busy, onAdvance }) {
  const tone = cardTone(card, now);
  const { roomService, delivery } = card;
  const { place, to } = cardPlace(card);
  return (
    <li className={`flex flex-col gap-2 rounded-item border-2 p-3 ${TONE_CLASSES[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={to} className="min-w-0">
          <span className="block text-xl font-bold leading-tight text-ink">{place}</span>
          <span className="block truncate text-xs text-ink-soft">
            {card.outletName} · <span className="font-mono">{delivery ? delivery.number : card.checkNumber}</span> · {card.seq}. tur{delivery ? '' : ` · ${card.covers} kişi`}
          </span>
        </Link>
        <span className={`flex items-center gap-1 text-lg font-bold tabular-nums ${CLOCK_CLASSES[tone] ?? 'text-ink'}`} title={`Mutfağa düştü ${timeText(card.sentAt)}`}>
          <Icon name="clock" className="size-4" />
          {waitedMinutes(card.sentAt, now)} dk
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={STATUS_TONES[card.status]}>{KITCHEN_ORDER_STATUS_LABELS[card.status]}</Badge>
        {roomService && <span className="font-semibold text-ink-soft">{roomService.deliverAt ? `Teslim ${timeText(roomService.deliverAt)}` : 'Hemen teslim'}</span>}
        {tone === 'late' && <span className="font-bold text-danger-ink">Gecikti</span>}
      </div>
      <ul className="flex flex-col gap-1 border-t border-line pt-2 text-base">
        {card.lines.map((line) => (
          <li key={line.id}>
            <strong className="tabular-nums">{line.quantity}×</strong> {line.name}
            {showStation && <span className="ml-1 text-xs text-ink-muted">{POS_STATION_LABELS[line.station]}</span>}
            {line.note && <span className="block text-sm font-semibold italic text-warning-ink">“{line.note}”</span>}
          </li>
        ))}
      </ul>
      <KitchenCardActions card={card} busy={busy} onAdvance={onAdvance} />
    </li>
  );
}

/**
 * Kartın yeri ve bağlantısı: paket (müşteri adı → paket sipariş), oda servisi (oda → oda servisi siparişi), masa
 * ya da masasız (→ adisyon).
 * @param {any} card
 */
function cardPlace(card) {
  if (card.delivery) return { place: `Paket · ${card.delivery.customerName}`, to: deliveryOrderPath(card.delivery.id) };
  if (card.roomService) return { place: `Oda ${card.roomService.roomNumber}`, to: orderPath(card.roomService.id) };
  return { place: card.tableName ? `Masa ${card.tableName}` : 'Masasız', to: checkPath(card.checkId) };
}

/** @param {{ card: any, busy: boolean, onAdvance: (status: string) => void }} props */
function KitchenCardActions({ card, busy, onAdvance }) {
  const actions = kdsActions(card);
  if (actions.length === 0) return <p className="text-xs text-ink-muted">Teslim {card.delivery ? 'paket servis' : 'oda servisi'} panosundan işaretlenir.</p>;
  return (
    <div className="mt-auto flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button key={action.status} type="button" variant={action.variant} icon={action.icon} className="flex-1" disabled={busy} onClick={() => onAdvance(action.status)}>
          {action.label}
        </Button>
      ))}
    </div>
  );
}
