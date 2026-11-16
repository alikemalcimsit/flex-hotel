import { useState } from 'react';
import { cancelAssetCountSchema, closeAssetCountSchema } from '@hotelos/hotel-contracts';
import { Alert, Checkbox, Textarea } from '@hotelos/ui';
import { useAssetCountAction } from '../../lib/assetQueries.js';
import { validateWith } from '../../lib/validate.js';
import { AssetDialog } from './AssetFields.jsx';

/**
 * Sayımın kapanış ve iptal diyalogları (modül 46). Kapanışta başka yerde bulunanlar istenirse bulunduğu yere taşınır
 * (her biri karta "yeri değişti" olarak yazılır); eksikler listede kalır — elden çıkarma ayrı ve yetkili işlemdir.
 */

/** @param {{ count: any, onClose: () => void }} props */
export function CloseAssetCountDialog({ count, onClose }) {
  const [applyTransfers, setApplyTransfers] = useState(true);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const action = useAssetCountAction(count.id, { onDone: onClose });
  const movable = count.totals.misplaced + count.totals.extra;

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(closeAssetCountSchema, { expectedUpdatedAt: count.updatedAt, applyTransfers, note: note || null });
    if (!checked.ok) return setErrors(checked.errors);
    action.mutate({ path: 'close', body: checked.data, message: `${count.number} kapandı` }, { onError: (error) => setErrors(error.fields ?? {}) });
  }

  return (
    <AssetDialog id="asset-count-close" title={`Sayımı kapat · ${count.number}`} busy={action.isPending} onClose={onClose} submitLabel="Kapat" icon="checkCheck" onSubmit={submit}>
      <dl className="grid grid-cols-2 gap-2 rounded-card bg-surface-muted p-3 text-sm">
        <dt className="text-ink-muted">Beklenen</dt>
        <dd className="text-right tabular-nums">{count.totals.expected}</dd>
        <dt className="text-ink-muted">Yerinde</dt>
        <dd className="text-right tabular-nums">{count.totals.found}</dd>
        <dt className="text-ink-muted">Başka yerde</dt>
        <dd className="text-right tabular-nums">{count.totals.misplaced}</dd>
        <dt className="text-ink-muted">Fazla (kapsam dışından)</dt>
        <dd className="text-right tabular-nums">{count.totals.extra}</dd>
        <dt className="font-semibold">Eksik</dt>
        <dd className={`text-right font-semibold tabular-nums ${count.totals.missing ? 'text-danger-ink' : ''}`}>{count.totals.missing}</dd>
      </dl>
      {movable > 0 && (
        <Checkbox
          label={`Başka yerde bulunan ${movable} demirbaşı bulunduğu yere taşı`}
          checked={applyTransfers}
          onChange={(event) => setApplyTransfers(event.target.checked)}
          disabled={action.isPending}
        />
      )}
      {count.totals.missing > 0 && (
        <Alert tone="warning" title={`${count.totals.missing} demirbaş bulunamadı`}>
          Eksikler sayım raporunda kalır; kayıpsa kartından "Elden çıkar → Kayıp" ile düşülür.
        </Alert>
      )}
      <Textarea label="Not (isteğe bağlı)" name="asset-count-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={action.isPending} />
    </AssetDialog>
  );
}

/** @param {{ count: any, onClose: () => void }} props */
export function CancelAssetCountDialog({ count, onClose }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const action = useAssetCountAction(count.id, { onDone: onClose });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(cancelAssetCountSchema, { expectedUpdatedAt: count.updatedAt, reason });
    if (!checked.ok) return setErrors(checked.errors);
    action.mutate({ path: 'cancel', body: checked.data, message: `${count.number} iptal edildi` }, { onError: (error) => setErrors(error.fields ?? {}) });
  }

  return (
    <AssetDialog id="asset-count-cancel" title={`Sayımı iptal et · ${count.number}`} busy={action.isPending} onClose={onClose} submitLabel="İptal et" icon="close" variant="danger" onSubmit={submit}>
      <p className="text-sm text-ink-soft">Okutulanlar kayıtta kalır ama sayım sonuç vermez; kartlara dokunulmaz.</p>
      <Textarea label="İptal sebebi" name="asset-count-cancel-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={action.isPending} />
    </AssetDialog>
  );
}
