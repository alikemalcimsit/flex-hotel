import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EVENT_CLIENT_TYPES, EVENT_CLIENT_TYPE_LABELS, createEventClientSchema } from '@hotelos/hotel-contracts';
import { Button, Icon, Input, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { banquetKeys } from '../../lib/banquet.js';
import { toastSuccess } from '../../store/toast.js';
import { validateWith } from '../../lib/validate.js';

const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 20;
const CLIENT_TYPE_OPTIONS = EVENT_CLIENT_TYPES.map((value) => ({ value, label: EVENT_CLIENT_TYPE_LABELS[value] }));

/**
 * Etkinlik müşterisi seçici (modül 37): ada, yetkiliye, telefona ya da vergi
 * numarasına göre sunucuda arar (en fazla 20 sonuç); bulunamazsa "yeni müşteri"
 * diyaloğu aynı adla açılır. Klavye: ↑ ↓, Enter, Esc.
 *
 * @param {{ value: { id: string, name: string } | null, onChange: (client: { id: string, name: string } | null) => void, error?: string, disabled?: boolean, canCreate: boolean }} props
 */
export function ClientPicker({ value, onChange, error, disabled = false, canCreate }) {
  const inputId = useId();
  const listId = useId();
  const rootRef = useRef(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const results = useQuery({
    queryKey: banquetKeys.clients({ search: query, picker: true }),
    queryFn: () => api(withQuery('/banquet/clients', { search: query || undefined, page: 1, pageSize: RESULT_LIMIT })),
    enabled: open && !value,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
  const items = results.data?.items ?? [];

  function choose(client) {
    onChange({ id: client.id, name: client.name });
    setText('');
    setOpen(false);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') setOpen(false);
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(items.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && items[active]) {
      event.preventDefault();
      choose(items[active]);
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
        Müşteri<span aria-hidden="true"> *</span>
      </label>
      {value ? (
        <div className={`flex items-center justify-between gap-3 rounded-control border bg-surface px-4 py-2.5 ${error ? 'border-sec-strong' : 'border-line-strong'}`}>
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Icon name="user" className="size-4 shrink-0 text-ink-muted" />
            <span className="truncate font-semibold text-ink">{value.name}</span>
          </span>
          {!disabled && (
            <button type="button" aria-label="Müşteriyi kaldır" onClick={() => onChange(null)} className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-black/[0.06] hover:text-ink">
              <Icon name="close" className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            disabled={disabled}
            placeholder="Müşteri adı, yetkili, telefon ya da vergi no"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={`w-full rounded-control border bg-surface px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-ink disabled:opacity-60 ${error ? 'border-sec-strong' : 'border-line-strong'}`}
          />
          {open && (
            <ul id={listId} role="listbox" aria-label="Müşteriler" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-card">
              {results.isPending && (
                <li className="px-4 py-3">
                  <Spinner label="Müşteriler aranıyor…" />
                </li>
              )}
              {results.isError && (
                <li className="px-4 py-3 text-sm text-sec-strong">
                  Müşteriler alınamadı.{' '}
                  <button type="button" className="font-semibold underline" onClick={() => results.refetch()}>
                    Tekrar dene
                  </button>
                </li>
              )}
              {results.isSuccess && items.length === 0 && <li className="px-4 py-3 text-sm text-ink-muted">{query ? 'Eşleşen müşteri yok' : 'Kayıtlı müşteri yok'}</li>}
              {items.map((client, index) => (
                <li key={client.id} role="option" aria-selected={index === active}>
                  <button
                    type="button"
                    onClick={() => choose(client)}
                    onMouseEnter={() => setActive(index)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${index === active ? 'bg-surface-muted' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{client.name}</span>
                      <span className="block truncate text-xs text-ink-muted">{[client.contactName, client.phone].filter(Boolean).join(' · ') || EVENT_CLIENT_TYPE_LABELS[client.type]}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">{client.eventCount} etkinlik</span>
                  </button>
                </li>
              ))}
              {canCreate && (
                <li className="border-t border-line">
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(text.trim());
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-info-ink hover:bg-surface-muted"
                  >
                    <Icon name="plus" className="size-4" />
                    {text.trim() ? `"${text.trim()}" adıyla yeni müşteri` : 'Yeni müşteri kartı'}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-sec-strong">
          {error}
        </p>
      )}
      {/* Diyalog portalda: etkinlik formunun içinde iç içe form olmasın. */}
      {creating !== null &&
        createPortal(
        <ClientDialog
          initialName={creating}
          onClose={() => setCreating(null)}
          onSaved={(client) => {
            setCreating(null);
            choose(client);
          }}
        />,
        document.body,
      )}
    </div>
  );
}

const EMPTY_CLIENT = Object.freeze({ type: 'COMPANY', name: '', contactName: '', phone: '', email: '', taxOffice: '', taxNumber: '', address: '', notes: '' });

/**
 * Müşteri kartı (yeni ya da düzenleme). Aynı ada ikinci kart açılmaz (sunucu
 * mükerrer kartı reddeder; hata ad alanının altına düşer).
 *
 * @param {{ client?: any, initialName?: string, onClose: () => void, onSaved: (client: any) => void }} props
 */
export function ClientDialog({ client, initialName = '', onClose, onSaved }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() =>
    client ? Object.fromEntries(Object.keys(EMPTY_CLIENT).map((key) => [key, client[key] ?? ''])) : { ...EMPTY_CLIENT, name: initialName },
  );
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const save = useMutation({
    mutationFn: (body) => (client ? api(`/banquet/clients/${client.id}`, { method: 'PUT', body: JSON.stringify(body) }) : apiPost('/banquet/clients', body)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess(client ? 'Müşteri kartı güncellendi' : 'Müşteri kartı açıldı');
      onSaved(saved);
    },
    onError: (error) => setErrors(error.fields && Object.keys(error.fields).length ? error.fields : { _: error.message }),
  });

  function submit(event) {
    event.preventDefault();
    // React olayları portaldan da kabarır: dışarıdaki etkinlik formu gönderilmesin.
    event.stopPropagation();
    const body = client ? { ...values, expectedUpdatedAt: client.updatedAt } : values;
    const checked = validateWith(createEventClientSchema, values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      title={client ? 'Müşteri kartı' : 'Yeni müşteri'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="banquet-client-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="banquet-client-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {errors._ && <p role="alert" className="text-sm font-semibold text-sec-strong sm:col-span-2">{errors._}</p>}
        <ChoiceChips label="Tip" options={CLIENT_TYPE_OPTIONS} value={values.type} onChange={(type) => setValues((current) => ({ ...current, type }))} className="sm:col-span-2" />
        <Input label={values.type === 'COMPANY' ? 'Firma unvanı' : 'Ad soyad'} name="client-name" value={values.name} onChange={set('name')} error={errors.name} required className="sm:col-span-2" />
        <Input label="Yetkili" name="client-contact" value={values.contactName} onChange={set('contactName')} error={errors.contactName} />
        <Input label="Telefon" name="client-phone" type="tel" value={values.phone} onChange={set('phone')} error={errors.phone} />
        <Input label="E-posta" name="client-email" type="email" value={values.email} onChange={set('email')} error={errors.email} />
        <Input label="Vergi dairesi" name="client-tax-office" value={values.taxOffice} onChange={set('taxOffice')} error={errors.taxOffice} />
        <Input label={values.type === 'COMPANY' ? 'Vergi no' : 'T.C. kimlik no'} name="client-tax-number" value={values.taxNumber} onChange={set('taxNumber')} error={errors.taxNumber} />
        <Textarea label="Adres" name="client-address" rows={2} value={values.address} onChange={set('address')} error={errors.address} className="sm:col-span-2" />
        <Textarea label="Not" name="client-notes" rows={2} value={values.notes} onChange={set('notes')} error={errors.notes} className="sm:col-span-2" />
      </form>
    </Modal>
  );
}
