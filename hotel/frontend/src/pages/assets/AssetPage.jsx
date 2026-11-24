import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ASSET_DISPOSAL_TYPE_LABELS, ASSET_MOVEMENT_KIND_LABELS, ASSET_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import {
  ASSETS_PATH,
  ASSET_DISPOSAL_TONES,
  ASSET_MOVEMENT_ICONS,
  ASSET_STATUS_TONES,
  DEPRECIATION_SOURCE_LABELS,
  DEPRECIATION_SOURCE_TONES,
  monthlyShare,
  warrantyTone,
} from '../../lib/assets.js';
import { useAsset, useAssetsLive } from '../../lib/assetQueries.js';
import { formatDate, formatDateTime, formatMoney, formatPercent } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { AssetLabelDialog, AssignAssetDialog, DisposeAssetDialog, ReturnAssetDialog, TransferAssetDialog } from './AssetDialogs.jsx';
import { Field, useAssetAccess } from './AssetFields.jsx';
import { AssetFormDialog } from './AssetFormDialog.jsx';

const DAY_MS = 86_400_000;

/** @param {string} from @param {string} to "YYYY-AA-GG" */
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * Demirbaş kartı (modül 46): kimlik, konum ve zimmet; maliyet, birikmiş amortisman ve net değer; yıl yıl amortisman
 * tablosu (açılış / kaydedilen / plan); ekle-yalnız hareket geçmişi. İşlemler yetkiye ve duruma göre.
 */
export function AssetPage() {
  const { assetId } = useParams();
  useAssetsLive();
  const query = useAsset(assetId);
  if (!query.data) return <QueryFallback query={query} errorTitle="Demirbaş kartı okunamadı" />;
  return <AssetView asset={query.data} />;
}

/** @param {{ asset: any }} props */
function AssetView({ asset }) {
  const access = useAssetAccess();
  const { today } = useHotelToday();
  const [dialog, setDialog] = useState(null);
  const active = asset.status === 'ACTIVE';
  const close = () => setDialog(null);
  const warrantyDays = asset.warrantyUntil ? daysBetween(today, asset.warrantyUntil) : null;
  const currentYear = Number(today.slice(0, 4));
  const thisYear = asset.schedule.find((row) => row.year === currentYear);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={ASSETS_PATH} className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink">
            <Icon name="arrowLeft" className="size-3.5" /> Demirbaşlar
          </Link>
          <h1 className="mt-1 text-[1.75rem] font-bold leading-tight text-ink">{asset.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="font-mono font-semibold text-ink">{asset.code}</span>
            <Badge tone={ASSET_STATUS_TONES[asset.status]}>{ASSET_STATUS_LABELS[asset.status]}</Badge>
            <span>{asset.category.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.manage && active && (
            <>
              <Button type="button" variant="outline" icon="fileText" onClick={() => setDialog('labels')}>
                Etiket
              </Button>
              <Button type="button" variant="outline" icon="pencil" onClick={() => setDialog('edit')}>
                Düzelt
              </Button>
              <Button type="button" variant="outline" icon="arrowRight" onClick={() => setDialog('transfer')}>
                Taşı
              </Button>
              <Button type="button" variant="outline" icon="user" onClick={() => setDialog('assign')}>
                {asset.employee ? 'Devret' : 'Zimmetle'}
              </Button>
              {asset.employee && (
                <Button type="button" variant="outline" icon="rotateCcw" onClick={() => setDialog('return')}>
                  İade al
                </Button>
              )}
            </>
          )}
          {access.finance && active && (
            <Button type="button" variant="dangerSoft" icon="trash" onClick={() => setDialog('dispose')}>
              Elden çıkar
            </Button>
          )}
        </div>
      </header>

      {asset.disposal && (
        <Alert tone="warning" title={`${ASSET_DISPOSAL_TYPE_LABELS[asset.disposal.type]} · ${formatDate(asset.disposal.disposedOn)}`}>
          <p>{asset.disposal.reason}</p>
          <p className="mt-1">
            Net değer {formatMoney(asset.disposal.bookValue)}
            {asset.disposal.type === 'SOLD' && ` · satış bedeli ${formatMoney(asset.disposal.price)} · ${Number(asset.disposal.gainLoss) >= 0 ? 'kâr' : 'zarar'} ${formatMoney(String(Math.abs(Number(asset.disposal.gainLoss))))}`}
            {' · '}
            {asset.disposal.disposedBy}
          </p>
          <Badge tone={ASSET_DISPOSAL_TONES[asset.disposal.type]} className="mt-2">
            {ASSET_DISPOSAL_TYPE_LABELS[asset.disposal.type]}
          </Badge>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Bilgiler" className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Field label="Konum">{asset.location.label}</Field>
            <Field label="Zimmet">
              {asset.employee ? (
                <>
                  {asset.employee.name} <span className="text-ink-muted">({asset.employee.code})</span>
                  {asset.assignedAt && <span className="block text-xs text-ink-muted">{formatDate(asset.assignedAt)} tarihinden beri</span>}
                </>
              ) : (
                'Zimmet yok'
              )}
            </Field>
            <Field label="Garanti">
              {asset.warrantyUntil ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {formatDate(asset.warrantyUntil)}
                  {active && (
                    <Badge tone={warrantyTone(warrantyDays)} dot={false}>
                      {warrantyDays < 0 ? 'bitti' : `${warrantyDays} gün kaldı`}
                    </Badge>
                  )}
                </span>
              ) : (
                'Yok'
              )}
            </Field>
            <Field label="Marka / model">{[asset.brand, asset.model].filter(Boolean).join(' · ') || '—'}</Field>
            <Field label="Seri no">{asset.serialNumber}</Field>
            <Field label="Tedarikçi / fatura">{[asset.supplierName, asset.invoiceNumber].filter(Boolean).join(' · ') || '—'}</Field>
            {asset.note && (
              <div className="sm:col-span-3">
                <Field label="Not">{asset.note}</Field>
              </div>
            )}
          </dl>
        </Card>
        <Card title="Değer">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-ink-muted">Alış</dt>
            <dd className="text-right">{formatDate(asset.purchaseDate)}</dd>
            <dt className="text-ink-muted">Maliyet</dt>
            <dd className="text-right tabular-nums">{formatMoney(asset.cost)}</dd>
            <dt className="text-ink-muted">Ömür / oran</dt>
            <dd className="text-right tabular-nums">
              {asset.usefulLifeYears} yıl · {formatPercent(asset.ratePct)}
            </dd>
            <dt className="text-ink-muted">Birikmiş amortisman</dt>
            <dd className="text-right tabular-nums">{formatMoney(asset.accumulated)}</dd>
            <dt className="font-semibold">Net değer</dt>
            <dd className="text-right text-lg font-bold tabular-nums">{formatMoney(asset.bookValue)}</dd>
            {thisYear && active && (
              <>
                <dt className="text-ink-muted">{currentYear} payı</dt>
                <dd className="text-right tabular-nums">
                  {formatMoney(thisYear.amount)}
                  <span className="block text-xs text-ink-muted">aylık {formatMoney(monthlyShare(thisYear.amount))}</span>
                </dd>
              </>
            )}
          </dl>
          {asset.lastPostedYear && <p className="mt-3 text-xs text-ink-muted">{asset.lastPostedYear} yılına kadar kaydedildi; finansal alanlar kilitli.</p>}
        </Card>
      </div>

      <Card title="Amortisman tablosu" description="VUK usulü, yıllık doğrusal: alındığı yıl tam yıl; elden çıkarıldığı yıl ayrılmaz.">
        {asset.schedule.length === 0 ? (
          <p className="text-sm text-ink-muted">Ayrılacak amortisman yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-3 py-2.5">Yıl</th>
                  <th className="px-3 py-2.5 text-right">Amortisman</th>
                  <th className="px-3 py-2.5 text-right">Birikmiş</th>
                  <th className="px-3 py-2.5 text-right">Net değer</th>
                  <th className="px-3 py-2.5">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {asset.schedule.map((row) => (
                  <tr key={`${row.source}-${row.year}`} className={row.year === currentYear ? 'bg-info-soft/40' : ''}>
                    <td className="px-3 py-2 tabular-nums">{row.source === 'OPENING' ? `≤ ${row.year}` : row.year}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.accumulated)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.bookValue)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={DEPRECIATION_SOURCE_TONES[row.source]} dot={false}>
                        {DEPRECIATION_SOURCE_LABELS[row.source]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Hareket geçmişi">
        <ol className="flex flex-col gap-3">
          {asset.movements.map((movement) => (
            <li key={movement.id} className="flex gap-3">
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-item bg-surface-muted text-ink-muted">
                <Icon name={ASSET_MOVEMENT_ICONS[movement.kind] ?? 'info'} className="size-4" />
              </span>
              <span className="min-w-0 text-sm">
                <span className="block font-semibold">
                  {ASSET_MOVEMENT_KIND_LABELS[movement.kind]}
                  {(movement.fromLabel || movement.toLabel) && (
                    <span className="font-normal text-ink-soft">
                      {' · '}
                      {movement.fromLabel ?? '—'} → {movement.toLabel ?? '—'}
                    </span>
                  )}
                </span>
                {movement.note && <span className="block text-ink-soft">{movement.note}</span>}
                <span className="block text-xs text-ink-muted">
                  {formatDateTime(movement.occurredAt)} · {movement.actor}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {dialog === 'edit' && <AssetFormDialog asset={asset} onClose={close} onDone={close} />}
      {dialog === 'transfer' && <TransferAssetDialog asset={asset} onClose={close} />}
      {dialog === 'assign' && <AssignAssetDialog asset={asset} onClose={close} />}
      {dialog === 'return' && <ReturnAssetDialog asset={asset} onClose={close} />}
      {dialog === 'dispose' && <DisposeAssetDialog asset={asset} onClose={close} />}
      {dialog === 'labels' && <AssetLabelDialog ids={[asset.id]} onClose={close} />}
    </div>
  );
}
