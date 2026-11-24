import { Badge } from '@hotelos/ui';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { allergenLabel, prefCategoryLabel, useGuestPreview } from '../../lib/crm.js';

/**
 * Rezervasyon formunda seçili misafirin CRM önizlemesi (modül 22): etiketler ve
 * tercihler personelin gözüne girsin (alerji, kat / yastık). Yalnız okuma; CRM
 * yetkisi yoksa gösterilmez.
 */
export function GuestCrmPreview({ guestId }) {
  const can = useCan();
  const query = useGuestPreview(can(PERMISSIONS.GUESTS_VIEW) ? guestId : null);
  const guest = query.data;
  if (!guest) return null;

  const tags = guest.tags ?? [];
  const prefs = guest.preferences ?? [];
  if (tags.length === 0 && prefs.length === 0) return null;

  return (
    <div className="w-full basis-full rounded-item border border-dashed border-line-strong bg-canvas p-3">
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {tags.map((t) => <Badge key={t} tone={t.toLowerCase() === 'vip' ? 'success' : t.toLowerCase() === 'sorunlu' ? 'danger' : 'neutral'}>{t}</Badge>)}
        </div>
      )}
      {prefs.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {prefs.slice(0, 8).map((p) => (
            <li key={p.id}>
              <span className="font-semibold text-ink-soft">{prefCategoryLabel(p.category)}:</span> {p.category === 'ALLERGY' ? allergenLabel(p.value) : p.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
