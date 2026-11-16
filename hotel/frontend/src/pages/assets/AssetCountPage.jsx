import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ASSET_COUNT_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Icon, Input } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import {
  ASSET_COUNTS_PATH,
  ASSET_COUNT_STATUS_TONES,
  COUNT_ITEM_STATE_LABELS,
  COUNT_ITEM_STATE_TONES,
  assetPath,
  locationValue,
  parseLocationValue,
  scanFeedback,
} from '../../lib/assets.js';
import { useAssetCount, useAssetCountScan, useAssetOptions, useAssetsLive } from '../../lib/assetQueries.js';
import { formatDateTime } from '../../lib/format.js';
import { CancelAssetCountDialog, CloseAssetCountDialog } from './AssetCountDialogs.jsx';
import { LocationSelect, useAssetAccess } from './AssetFields.jsx';
import { CameraScanner, cameraScanSupported } from './CameraScanner.jsx';

/** Son okutmalardan ekranda kalan. */
const RECENT_SCANS = 8;
/** Sayım ekranının durum kutuları: süzgeç düğmesi + simge + renk. */
const TILES = Object.freeze([
  { state: 'MISSING', icon: 'alertCircle', tone: 'danger', hint: 'Henüz okutulmadı' },
  { state: 'MISPLACED', icon: 'arrowRight', tone: 'warning', hint: 'Beklenen yerden başka yerde' },
  { state: 'EXTRA', icon: 'plus', tone: 'warning', hint: 'Kapsam dışından okutuldu' },
  { state: 'FOUND', icon: 'checkCircle', tone: 'neutral', hint: 'Beklenen yerinde' },
]);
const TOTAL_KEYS = Object.freeze({ MISSING: 'missing', MISPLACED: 'misplaced', EXTRA: 'extra', FOUND: 'found' });

/** "Şu an buradayım" seçimi sayım başına bu tarayıcıda hatırlanır. @param {string} countId */
const storageKey = (countId) => `hotelos:asset-count-location:${countId}`;
/** @param {string} key */
function readStored(key) {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
/** @param {string} key @param {string} value */
function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Gizli pencere / kapalı depolama: seçim yalnız bu oturumda kalır.
  }
}

/**
 * Kısa sesli uyarı: olumlu okutmada tiz ve kısa, sorunluda pes ve uzun (göz ekranda değilken).
 * @param {boolean} ok
 */
function beep(ok) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(context.destination);
    oscillator.onended = () => context.close();
    oscillator.start();
    oscillator.stop(context.currentTime + (ok ? 0.08 : 0.3));
  } catch {
    // Ses yoksa sessiz devam.
  }
}

/**
 * Demirbaş sayım ekranı (modül 46): sayımı yapan bulunduğu yeri seçer, etiketi el okuyucusuyla (klavye gibi yazar +
 * Enter), kamerayla (destekleyen tarayıcıda) ya da elle okutur. Her okutmanın sonucu renkli bantta ve sesle;
 * eksik / başka yerde / fazla / yerinde listeleri canlı (birden çok okuyucu aynı sayımda çalışabilir).
 */
export function AssetCountPage() {
  const { countId } = useParams();
  useAssetsLive();
  const query = useAssetCount(countId);
  if (!query.data) return <QueryFallback query={query} errorTitle="Sayım okunamadı" />;
  return <CountView count={query.data} />;
}

/** @param {{ count: any }} props */
function CountView({ count }) {
  const access = useAssetAccess();
  const [filter, setFilter] = useState(count.status === 'OPEN' ? 'MISSING' : '');
  const [dialog, setDialog] = useState(null);
  const open = count.status === 'OPEN';
  const items = filter ? count.items.filter((item) => item.state === filter) : count.items;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={ASSET_COUNTS_PATH} className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink">
            <Icon name="arrowLeft" className="size-3.5" /> Sayımlar
          </Link>
          <h1 className="mt-1 text-[1.75rem] font-bold leading-tight text-ink">{count.title || count.scope.label}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="font-mono font-semibold text-ink">{count.number}</span>
            <Badge tone={ASSET_COUNT_STATUS_TONES[count.status]}>{ASSET_COUNT_STATUS_LABELS[count.status]}</Badge>
            <span>Kapsam: {count.scope.label}</span>
            <span>
              · {formatDateTime(count.openedAt)} · {count.openedBy}
            </span>
          </p>
        </div>
        {open && access.manage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" icon="close" onClick={() => setDialog('cancel')}>
              İptal et
            </Button>
            <Button type="button" icon="checkCheck" onClick={() => setDialog('close')}>
              Sayımı kapat
            </Button>
          </div>
        )}
      </header>

      {count.status === 'CLOSED' && (
        <Alert tone="success" title={`Kapandı · ${formatDateTime(count.closedAt)} · ${count.closedBy}`}>
          {count.transferredCount ? `${count.transferredCount} demirbaş bulunduğu yere taşındı. ` : ''}
          {count.totals.missing ? `${count.totals.missing} demirbaş bulunamadı.` : 'Eksik yok.'}
          {count.note && <span className="block">{count.note}</span>}
        </Alert>
      )}
      {count.status === 'CANCELLED' && <Alert tone="warning" title="İptal edildi">{count.cancelReason}</Alert>}

      {open && access.count && <ScanPanel count={count} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILES.map((tile) => (
          <SummaryTile
            key={tile.state}
            label={COUNT_ITEM_STATE_LABELS[tile.state]}
            value={count.totals[TOTAL_KEYS[tile.state]]}
            hint={tile.hint}
            icon={tile.icon}
            tone={tile.state === 'MISSING' && count.totals.missing ? 'danger' : tile.tone === 'warning' && count.totals[TOTAL_KEYS[tile.state]] ? 'warning' : 'neutral'}
            selected={filter === tile.state}
            onClick={() => setFilter((current) => (current === tile.state ? '' : tile.state))}
          />
        ))}
      </div>

      <Card title={filter ? COUNT_ITEM_STATE_LABELS[filter] : `Tüm satırlar · beklenen ${count.totals.expected}`}>
        {count.itemsTruncated && <p className="mb-3 text-xs text-warning-ink">Liste uzun; ilk satırlar gösteriliyor (sayılar tam).</p>}
        {items.length === 0 ? (
          <p className="text-sm text-ink-muted">{filter === 'MISSING' && open ? 'Eksik kalmadı.' : 'Bu grupta demirbaş yok.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Demirbaş</th>
                  <th className="px-3 py-2">Beklenen yer</th>
                  <th className="px-3 py-2">Bulunduğu yer</th>
                  <th className="px-3 py-2">Okutma</th>
                  <th className="px-3 py-2">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((item) => (
                  <tr key={item.assetId}>
                    <td className="px-3 py-2">
                      <Link to={assetPath(item.assetId)} className="font-semibold hover:underline">
                        {item.name}
                      </Link>
                      <span className="block text-xs text-ink-muted">
                        <span className="font-mono">{item.code}</span> · {item.categoryName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{item.expectedLabel ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{item.foundLabel ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-ink-muted">{item.foundAt ? `${formatDateTime(item.foundAt)} · ${item.foundBy}` : '—'}</td>
                    <td className="px-3 py-2">
                      <Badge tone={COUNT_ITEM_STATE_TONES[item.state]}>{COUNT_ITEM_STATE_LABELS[item.state]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog === 'close' && <CloseAssetCountDialog count={count} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelAssetCountDialog count={count} onClose={() => setDialog(null)} />}
    </div>
  );
}

/**
 * Okutma paneli: "şu an buradayım", okutma alanı (el okuyucusu klavye gibi yazıp Enter'a basar; her okutmadan sonra
 * alan temizlenip odakta kalır), kamera (destekleyen tarayıcıda) ve son okutmaların sonucu.
 * @param {{ count: any }} props
 */
function ScanPanel({ count }) {
  const options = useAssetOptions();
  const scan = useAssetCountScan(count.id);
  const inputRef = useRef(null);
  const [location, setLocation] = useState(() => readStored(storageKey(count.id)) || locationValue(count.scope));
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [sound, setSound] = useState(true);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState(null);
  const canCamera = cameraScanSupported();

  useEffect(() => {
    writeStored(storageKey(count.id), location);
  }, [count.id, location]);

  /** @param {string} text */
  function send(text) {
    const raw = text.trim();
    if (!raw) return;
    const place = parseLocationValue(location);
    if (!place.roomId && !place.areaId) {
      setError('Önce bulunduğunuz yeri seçin');
      if (sound) beep(false);
      return;
    }
    setError(null);
    // El okuyucusu art arda okutur: `mutate`'in çağrı başına geri çağrıları yalnız son istekte çalışır, önceki
    // okutmaların sonucu kaybolurdu. Her okutma kendi sözünü bekler.
    scan.mutateAsync({ code: raw, ...place }).then(
      (result) => {
        const feedback = scanFeedback(result);
        if (sound) beep(feedback.ok);
        setRecent((current) => [{ key: `${Date.now()}-${raw}`, ...feedback, code: result.code ?? raw, name: result.asset?.name ?? null }, ...current].slice(0, RECENT_SCANS));
      },
      (failure) => {
        if (sound) beep(false);
        setError(failure.message);
      },
    );
  }

  function submit(event) {
    event.preventDefault();
    send(code);
    setCode('');
    inputRef.current?.focus();
  }

  const latest = recent[0];
  return (
    <Card title="Okut" description="El okuyucusu etiketi okuyunca kod alana yazılır ve kendiliğinden gönderilir; okuyucu yoksa kodu (DM-…) yazıp Enter'a basın.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <LocationSelect label="Şu an buradayım" name="asset-count-here" value={location} onChange={setLocation} options={options.data} error={error && !location ? error : undefined} disabled={options.isPending} />
          <form onSubmit={submit} className="flex items-end gap-2">
            <Input
              ref={inputRef}
              label="Etiket"
              name="asset-count-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Okutun ya da DM-000123 yazın"
              autoFocus
              autoComplete="off"
              className="flex-1"
            />
            <Button type="submit" icon="check" disabled={!code.trim()}>
              Gönder
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-4">
            {canCamera && !camera && (
              <Button type="button" variant="outline" icon="camera" onClick={() => setCamera(true)}>
                Kamerayla okut
              </Button>
            )}
            <Checkbox label="Sesli uyarı" checked={sound} onChange={(event) => setSound(event.target.checked)} />
          </div>
          {camera && <CameraScanner onDetected={send} onClose={() => setCamera(false)} />}
        </div>
        <div className="flex flex-col gap-2">
          {error && location && <Alert tone="danger" title="Okutulamadı">{error}</Alert>}
          {latest ? (
            <Alert tone={latest.tone} title={`${latest.title}${latest.code ? ` · ${latest.code}` : ''}`}>
              {latest.name && <span className="block font-semibold">{latest.name}</span>}
              {latest.message}
            </Alert>
          ) : (
            <p className="text-sm text-ink-muted">Okutulan etiketin sonucu burada görünür.</p>
          )}
          {recent.length > 1 && (
            <ul className="flex flex-col gap-1 text-xs text-ink-muted">
              {recent.slice(1).map((item) => (
                <li key={item.key}>
                  <span className="font-mono">{item.code}</span> · {item.title}
                  {item.name ? ` · ${item.name}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
