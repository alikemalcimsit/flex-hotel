import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { api, withQuery } from '../../lib/api.js';
import { crmKeys, guestPath, useGuestCard, useMergeGuests } from '../../lib/crm.js';

const FIELDS = [
  { key: 'firstName', label: 'Ad' },
  { key: 'lastName', label: 'Soyad' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'E-posta' },
  { key: 'nationality', label: 'Uyruk' },
  { key: 'idType', label: 'Kimlik türü' },
  { key: 'idNumber', label: 'Kimlik no' },
  { key: 'birthDate', label: 'Doğum tarihi' },
];

const show = (v) => (v === null || v === undefined || v === '' ? '—' : v);

/**
 * Misafir birleştirme (modül 22): bu kart hedef (kalır), seçilen kart kaynak
 * (silinir). Her alan için hangi değerin kalacağı seçilir. Geri alınamaz.
 */
export function MergeDialog({ open, onClose, target }) {
  const navigate = useNavigate();
  const [sourceId, setSourceId] = useState(null);
  const [choice, setChoice] = useState({}); // field → 'target' | 'source'
  const sourceCard = useGuestCard(sourceId);
  const merge = useMergeGuests();
  const source = sourceCard.data;

  const reset = () => { setSourceId(null); setChoice({}); };
  const close = () => { reset(); onClose(); };

  const submit = () => {
    const keep = {};
    for (const { key } of FIELDS) keep[key] = (choice[key] === 'source' ? source?.[key] : target?.[key]) ?? null;
    merge.mutate({ sourceId, targetId: target.id, keep }, {
      onSuccess: () => { close(); navigate(guestPath(target.id)); },
    });
  };

  return (
    <Modal open={open} title="Misafir kartlarını birleştir" onClose={close} size="lg"
      footer={source && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>Vazgeç</Button>
          <Button icon="checkCheck" onClick={submit} disabled={merge.isPending}>Birleştir</Button>
        </div>
      )}
    >
      {!source ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">Bu kartla birleştirilecek mükerrer kaydı arayın. <strong>{target.name}</strong> kaydı kalır, seçilen kayıt silinir.</p>
          <SearchPicker
            label="Birleştirilecek kart"
            placeholder="Ad soyad, telefon ya da e-posta"
            queryOf={(q) => ({ queryKey: crmKeys.search(q), queryFn: async () => (await api(withQuery('/guests', { q }))).items ?? [], enabled: q.length >= 2 })}
            isDisabled={(item) => (item.id === target.id ? 'Bu kartın kendisi' : null)}
            renderItem={(item) => (
              <span className="flex w-full flex-col">
                <span className="font-semibold">{item.name}</span>
                <span className="text-xs text-ink-muted">{[item.phone, item.email].filter(Boolean).join(' · ') || '—'}</span>
              </span>
            )}
            onPick={(item) => setSourceId(item.id)}
            emptyText="Eşleşen kart yok"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <Alert tone="warning" title="Geri alınamaz">Seçilen kaydın bütün konaklama, folyo, tercih ve notları bu karta taşınır; sonra silinir.</Alert>
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs font-bold uppercase text-ink-muted">
                <tr><th className="px-3 py-2 text-left">Alan</th><th className="px-3 py-2 text-left">{target.name} (kalır)</th><th className="px-3 py-2 text-left">{source.name} (silinir)</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {FIELDS.map(({ key, label }) => {
                  const sel = choice[key] ?? 'target';
                  return (
                    <tr key={key}>
                      <td className="px-3 py-2 font-semibold text-ink-muted">{label}</td>
                      <td className={`px-3 py-2 ${sel === 'target' ? 'bg-canvas' : ''}`}>
                        <label className="flex items-center gap-2"><input type="radio" checked={sel === 'target'} onChange={() => setChoice({ ...choice, [key]: 'target' })} />{show(target[key])}</label>
                      </td>
                      <td className={`px-3 py-2 ${sel === 'source' ? 'bg-canvas' : ''}`}>
                        <label className="flex items-center gap-2"><input type="radio" checked={sel === 'source'} onChange={() => setChoice({ ...choice, [key]: 'source' })} />{show(source[key])}</label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button variant="ghost" size="sm" icon="arrowLeft" onClick={reset}>Başka kart seç</Button>
        </div>
      )}
    </Modal>
  );
}
