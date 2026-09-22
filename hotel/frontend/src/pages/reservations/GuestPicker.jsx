import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Icon, Input, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { reservationKeys } from '../../lib/reservations.js';
import { statusLabel } from './reservationTheme.js';

const SEARCH_DEBOUNCE_MS = 300;
/** Sunucu 3 harften kısa ad aramaz; telefon/e-posta için en az 2 karakter yeter. */
const MIN_QUERY_LENGTH = 2;

export const EMPTY_GUEST_DRAFT = Object.freeze({ firstName: '', lastName: '', phone: '', email: '', nationality: '' });

/**
 * Misafir seçimi: var olan kartı ara ya da yeni kart bilgisi gir.
 *
 * Arama ad soyad (en az 3 harfli kelime), telefon ya da tam e-posta ile
 * yapılır; her sonuç son konaklamasını ve kaç kez kaldığını gösterir.
 *
 * @param {{
 *   value: { mode: 'search' | 'existing' | 'new', guest: object | null, draft: typeof EMPTY_GUEST_DRAFT },
 *   onChange: (value: { mode: 'search' | 'existing' | 'new', guest: object | null, draft: typeof EMPTY_GUEST_DRAFT }) => void,
 *   errors?: Record<string, string>,
 *   disabled?: boolean,
 * }} props
 */
export function GuestPicker({ value, onChange, errors = {}, disabled = false }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const listId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useQuery({
    queryKey: reservationKeys.guests(query),
    queryFn: () => api(withQuery('/reservations/guests', { q: query })),
    enabled: value.mode === 'search' && query.length >= MIN_QUERY_LENGTH,
    staleTime: 30_000,
  });

  const setDraft = (field, fieldValue) => onChange({ ...value, draft: { ...value.draft, [field]: fieldValue } });

  if (value.mode === 'existing' && value.guest) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-item border border-line bg-canvas p-4">
        <span className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-info-soft text-info-ink">
            <Icon name="user" className="size-5" />
          </span>
          <span className="flex flex-col">
            <span className="font-semibold text-ink">{value.guest.name}</span>
            <span className="text-xs text-ink-muted">{[value.guest.phone, value.guest.email].filter(Boolean).join(' · ') || 'İletişim bilgisi yok'}</span>
          </span>
        </span>
        <Button variant="outline" size="sm" icon="refresh" disabled={disabled} onClick={() => onChange({ ...value, mode: 'search', guest: null })}>
          Misafiri değiştir
        </Button>
      </div>
    );
  }

  if (value.mode === 'new') {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Ad" name="guest.firstName" value={value.draft.firstName} onChange={(e) => setDraft('firstName', e.target.value)} error={errors['guest.firstName']} disabled={disabled} required />
          <Input label="Soyad" name="guest.lastName" value={value.draft.lastName} onChange={(e) => setDraft('lastName', e.target.value)} error={errors['guest.lastName']} disabled={disabled} required />
          <Input label="Telefon" name="guest.phone" type="tel" placeholder="0532 111 22 33" value={value.draft.phone} onChange={(e) => setDraft('phone', e.target.value)} error={errors['guest.phone']} disabled={disabled} />
          <Input label="E-posta" name="guest.email" type="email" value={value.draft.email} onChange={(e) => setDraft('email', e.target.value)} error={errors['guest.email']} disabled={disabled} />
          <Input label="Uyruk (ülke kodu)" name="guest.nationality" placeholder="TR" maxLength={2} value={value.draft.nationality} onChange={(e) => setDraft('nationality', e.target.value.toUpperCase())} error={errors['guest.nationality']} disabled={disabled} className="sm:w-40" />
        </div>
        <p className="text-xs text-ink-muted">Telefon ya da e-postadan biri zorunlu. Aynı iletişim bilgisiyle kayıtlı kart varsa sistem size sorar.</p>
        <div>
          <Button variant="ghost" size="sm" icon="search" disabled={disabled} onClick={() => onChange({ ...value, mode: 'search' })}>
            Var olan misafiri ara
          </Button>
        </div>
      </div>
    );
  }

  const results = search.data ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Misafir ara"
        name="guest-search"
        type="search"
        placeholder="Ad soyad, telefon ya da e-posta"
        value={text}
        onChange={(event) => setText(event.target.value)}
        error={errors.guestId}
        disabled={disabled}
        aria-controls={listId}
      />
      <div id={listId} aria-live="polite" className="flex flex-col gap-1.5">
        {query.length > 0 && query.length < MIN_QUERY_LENGTH && <p className="text-xs text-ink-muted">En az {MIN_QUERY_LENGTH} karakter yazın.</p>}
        {search.isFetching && <Spinner label="Aranıyor…" />}
        {search.isError && <p className="text-xs text-sec-strong">Arama yapılamadı: {search.error.message}</p>}
        {search.data && results.length === 0 && (
          <p className="text-xs text-ink-muted">Kayıtlı misafir bulunamadı. Ad araması için en az 3 harfli kelime yazın ya da yeni misafir ekleyin.</p>
        )}
        {results.map((guest) => (
          <button
            key={guest.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, mode: 'existing', guest })}
            className="flex w-full items-center justify-between gap-3 rounded-item border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-ink"
          >
            <span className="flex flex-col">
              <span className="font-semibold text-ink">{guest.name}</span>
              <span className="text-xs text-ink-muted">{[guest.phone, guest.email].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="text-right text-xs text-ink-muted">
              {guest.stayCount > 0 ? `${guest.stayCount} konaklama` : 'Konaklaması yok'}
              {guest.lastStay && (
                <span className="block">
                  Son: {formatDate(guest.lastStay.checkIn)} · {statusLabel(guest.lastStay.status)}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div>
        <Button variant="outline" size="sm" icon="plus" disabled={disabled} onClick={() => onChange({ ...value, mode: 'new' })}>
          Yeni misafir
        </Button>
      </div>
    </div>
  );
}
