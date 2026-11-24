import { useQuery } from '@tanstack/react-query';
import { SPA_APPOINTMENT_STATUS_LABELS, SPA_APPOINTMENT_STATUS_TONES, SPA_GENDER_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Spinner } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { api, withQuery } from '../../lib/api.js';
import { dottedDay, spaKeys } from '../../lib/spa.js';

/** Spa ekranlarının ortak parçaları (modül 57): durum rozeti, misafir seçimi, boş saat seçici. */

/** @param {{ status: string }} props */
export function AppointmentStatusBadge({ status }) {
  return <Badge tone={SPA_APPOINTMENT_STATUS_TONES[status] ?? 'neutral'}>{SPA_APPOINTMENT_STATUS_LABELS[status] ?? status}</Badge>;
}

export const GENDER_OPTIONS = Object.freeze([
  { value: 'FEMALE', label: `${SPA_GENDER_LABELS.FEMALE} terapist` },
  { value: 'MALE', label: `${SPA_GENDER_LABELS.MALE} terapist` },
]);

const CUSTOMER_KINDS = Object.freeze([
  { value: 'STAY', label: 'Otel misafiri' },
  { value: 'WALK_IN', label: 'Dışarıdan gelen' },
]);

/**
 * Randevunun / kaydın kime ait olduğu: otel misafiri (oda ya da adla aranır) ya da dışarıdan gelen (ad, telefon).
 *
 * @param {{
 *   value: { kind: 'STAY' | 'WALK_IN', stay: any | null, name: string, phone: string },
 *   onChange: (value: any) => void, errors?: Record<string, string>, disabled?: boolean,
 * }} props
 */
export function CustomerField({ value, onChange, errors = {}, disabled = false }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <ChoiceChips label="Misafir türü" options={CUSTOMER_KINDS} value={value.kind} onChange={(kind) => set({ kind })} required disabled={disabled} />
      {value.kind === 'STAY' ? (
        value.stay ? (
          <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface-muted px-4 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{value.stay.guestName}</span>
              <span className="block text-xs text-ink-muted">
                {value.stay.roomNumber ? `Oda ${value.stay.roomNumber} · ` : ''}
                {value.stay.confirmationCode} · {dottedDay(value.stay.checkIn)} – {dottedDay(value.stay.checkOut)}
                {value.stay.status === 'CONFIRMED' ? ' · henüz gelmedi' : ''}
              </span>
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => set({ stay: null })} disabled={disabled}>
              Değiştir
            </Button>
          </div>
        ) : (
          <SearchPicker
            label="Misafir"
            placeholder="Oda numarası ya da ad yazın"
            queryOf={(search) => ({ queryKey: spaKeys.stays(search), queryFn: () => (search ? api(withQuery('/spa/stays', { search })) : Promise.resolve({ stays: [] })) })}
            itemsOf={(data) => data?.stays ?? []}
            renderItem={(stay) => (
              <>
                <span className="block font-semibold text-ink">{stay.guestName}</span>
                <span className="block text-xs text-ink-muted">
                  {stay.roomNumber ? `Oda ${stay.roomNumber}` : 'Henüz gelmedi'} · {stay.confirmationCode}
                </span>
              </>
            )}
            onPick={(stay) => set({ stay })}
            emptyText="İçeride ya da gelecek misafir bulunamadı. Oda numarasını ya da adın bir kısmını yazın."
            disabled={disabled}
            error={errors.reservationId ?? errors.customerName}
          />
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Ad soyad" value={value.name} onChange={(event) => set({ name: event.target.value })} error={errors.customerName} disabled={disabled} />
          <Input label="Telefon (isteğe bağlı)" inputMode="tel" value={value.phone} onChange={(event) => set({ phone: event.target.value })} error={errors.customerPhone} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

/** Boş misafir alanı. */
export const emptyCustomer = () => ({ kind: 'STAY', stay: null, name: '', phone: '' });

/** Misafir alanının sunucuya giden hâli. @param {ReturnType<typeof emptyCustomer>} customer */
export const customerPayload = (customer) =>
  customer.kind === 'STAY' ? { reservationId: customer.stay?.id ?? null } : { reservationId: null, customerName: customer.name.trim(), customerPhone: customer.phone.trim() || null };

/**
 * Bir hizmetin bir gündeki saatleri: boş olanlar seçilebilir, dolular soluk. Hiç boş saat yoksa sebebi yazar
 * (tanım eksik mi, gün mü dolu).
 *
 * @param {{
 *   serviceId: string, day: string, therapistId?: string, gender?: string, ignoreAppointmentId?: string,
 *   value: string, onChange: (time: string) => void, error?: string,
 * }} props
 */
export function SlotPicker({ serviceId, day, therapistId, gender, ignoreAppointmentId, value, onChange, error }) {
  const params = { serviceId, day, therapistId: therapistId || undefined, gender: gender || undefined, ignoreAppointmentId };
  const query = useQuery({ queryKey: spaKeys.availability(params), queryFn: () => api(withQuery('/spa/availability', params)), enabled: Boolean(serviceId && day) });
  if (!serviceId || !day) return <p className="text-sm text-ink-muted">Saatleri görmek için hizmet ve gün seçin.</p>;
  if (query.isPending) return <Spinner label="Boş saatler hesaplanıyor…" className="justify-start py-2" />;
  if (query.isError) {
    return (
      <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
        {query.error.message}
      </Alert>
    );
  }
  const { slots, staffed } = query.data;
  const free = slots.filter((slot) => slot.available);
  if (!staffed) return <Alert tone="warning">Bu hizmeti verebilen kullanımda terapist ya da oda yok. Tanımlar → Hizmetler'den kadroyu tamamlayın.</Alert>;
  if (free.length === 0) return <Alert tone="info">Bu gün için boş saat yok{therapistId || gender ? ' (seçilen terapist / tercih için)' : ''}. Başka bir gün ya da terapist deneyin.</Alert>;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Saat · {free.length} boş</span>
      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label="Boş saatler">
        {slots.map((slot) => (
          <button
            key={slot.time}
            type="button"
            disabled={!slot.available}
            aria-pressed={value === slot.time}
            onClick={() => onChange(slot.time)}
            className={`rounded-control border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors ${
              value === slot.time ? 'border-ink bg-ink text-white' : slot.available ? 'border-line-strong bg-surface text-ink hover:border-ink' : 'cursor-not-allowed border-line bg-surface-muted text-ink-muted/50 line-through'
            }`}
          >
            {slot.time}
          </button>
        ))}
      </div>
      {error && <p className="text-xs font-semibold text-sec-strong">{error}</p>}
    </div>
  );
}
