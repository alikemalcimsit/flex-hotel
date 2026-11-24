import { useState } from 'react';
import { PREFERENCE_CATEGORIES, PREFERENCE_CONFIDENCES, PREFERENCE_SOURCES } from '@hotelos/hotel-contracts';
import { Badge, Button, Select } from '@hotelos/ui';
import { formatDate } from '../../lib/format.js';
import { ALLERGEN_OPTIONS, allergenLabel, prefCategoryLabel, prefConfidenceLabel, prefSourceLabel } from '../../lib/crm.js';

const CATEGORY_OPTIONS = PREFERENCE_CATEGORIES.map((v) => ({ value: v, label: prefCategoryLabel(v) }));
const SOURCE_OPTIONS = PREFERENCE_SOURCES.map((v) => ({ value: v, label: prefSourceLabel(v) }));
const CONFIDENCE_OPTIONS = PREFERENCE_CONFIDENCES.map((v) => ({ value: v, label: prefConfidenceLabel(v) }));

const EMPTY = { category: 'FLOOR', value: '', source: 'STAFF', confidence: 'MEDIUM' };

function valueLabel(pref) {
  return pref.category === 'ALLERGY' ? allergenLabel(pref.value) : pref.value;
}

/**
 * Misafir tercihleri sekmesi (modül 22): kategori + değer + kaynak + güven.
 * ALLERGY değerleri modül 43'ün alerjen kodlarından seçilir.
 */
export function PreferencesTab({ preferences, actions, canManage }) {
  const [draft, setDraft] = useState(EMPTY);
  const isAllergy = draft.category === 'ALLERGY';

  const add = () => {
    if (!draft.value) return;
    actions.addPreference.mutate(draft, { onSuccess: () => setDraft({ ...EMPTY, category: draft.category }) });
  };

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-canvas p-4">
          <Select label="Kategori" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value, value: '' })} options={CATEGORY_OPTIONS} />
          {isAllergy ? (
            <Select label="Alerjen" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} options={[{ value: '', label: 'Seçin…' }, ...ALLERGEN_OPTIONS]} />
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Değer</span>
              <input className="rounded-item border border-line-strong bg-surface px-3 py-2 text-sm" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder="Üst kat, sessiz…" />
            </label>
          )}
          <Select label="Kaynak" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} options={SOURCE_OPTIONS} />
          <Select label="Güven" value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: e.target.value })} options={CONFIDENCE_OPTIONS} />
          <Button icon="plus" onClick={add} disabled={!draft.value || actions.addPreference.isPending}>Ekle</Button>
        </div>
      )}

      {preferences.length === 0 ? (
        <p className="text-sm text-ink-muted">Henüz tercih kaydı yok.</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {preferences.map((pref) => (
            <li key={pref.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="flex flex-col">
                <span className="font-semibold text-ink">{prefCategoryLabel(pref.category)}: {valueLabel(pref)}</span>
                <span className="text-xs text-ink-muted">
                  {prefSourceLabel(pref.source)} · Güven: {prefConfidenceLabel(pref.confidence)}
                  {pref.lastConfirmedAt && ` · Son teyit: ${formatDate(pref.lastConfirmedAt)}`}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {pref.category === 'ALLERGY' && <Badge tone="danger">Alerji</Badge>}
                {canManage && (
                  <Button variant="ghost" size="sm" icon="trash" onClick={() => actions.deletePreference.mutate(pref.id)} aria-label="Sil" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
