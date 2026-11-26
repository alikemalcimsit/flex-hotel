import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BOARD_TYPES,
  MAX_GROUP_LINES,
  RESERVATION_CREATE_STATUSES,
  RESERVATION_MANUAL_SOURCES,
  createGroupReservationSchema,
  createReservationSchema,
  createWaitlistSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Icon, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { AgencyPicker } from '../../components/AgencyPicker.jsx';
import { CouponField } from '../../components/CouponField.jsx';
import { agencyIssueText, useAgencyLive } from '../../lib/agencies.js';
import { useT } from '../../i18n/index.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { couponBlocks, couponStatusText, usePromotionLive } from '../../lib/promotions.js';
import { addDaysIso, newRequestId, reservationKeys } from '../../lib/reservations.js';
import { downloadRoomingTemplate, readRoomingList } from '../../lib/roomingList.js';
import { useHotelContext, useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { EMPTY_GUEST_DRAFT, GuestPicker } from './GuestPicker.jsx';
import { boardLong, sourceLabel } from './reservationTheme.js';

const QUOTE_DEBOUNCE_MS = 250;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;


let lineKey = 0;
const newLine = (boardType, roomTypeId = '') => ({ key: (lineKey += 1), roomTypeId, adults: '2', children: '0', boardType, quantity: '1', guestFirstName: '', guestLastName: '' });

/** @param {string} value */
const validDay = (value) => DAY_PATTERN.test(value ?? '');

/**
 * Yeni rezervasyon formu (modül 4).
 *
 * - **Misafir:** kayıtlı kart aranır ya da yeni bilgi girilir. Aynı telefon /
 *   e-posta başka ada kayıtlıysa sunucu sorar; personel kartı seçer ya da
 *   "farklı kişi" der.
 * - **Oda:** tarihler seçilince her tipin bu tarihlerde kaç boş odası olduğu
 *   ve toplam fiyatı görünür (canlı). Grup modunda birden fazla satır.
 * - **Fiyat:** gece gece döküm, vergiler, iptal koşulu. Yetkili personel
 *   toplamı elle girebilir (gerekçesiyle).
 * - **Promosyon ve kupon (modül 31):** uygun promosyon kendiliğinden düşer
 *   (tip kartında liste fiyatının yanında); kupon girilirse daha avantajlıysa
 *   onun yerine geçer. Acente satışında ve elle fiyatta indirim yoktur.
 * - **Tekrar gönderim:** form açılırken bir istek kimliği üretilir; çift tık
 *   ya da ağ tekrarı ikinci rezervasyon açmaz.
 * - **Yer yoksa:** otelin politikasına göre ya reddedilir (misafiri bekleme
 *   listesine almak tek tıkla) ya da yönetici onayına gider.
 *
 * Adresten ön doldurma: `?giris=&cikis=&tip=&oda=` (oda planı), `?bekleme=` (bekleme listesi).
 */
export function NewReservationTab() {
  const t = useT();
  const boardOptions = BOARD_TYPES.map((value) => ({ value, label: boardLong(value) }));
  const sourceOptions = RESERVATION_MANUAL_SOURCES.map((value) => ({ value, label: sourceLabel(value) }));
  const statusOptions = RESERVATION_CREATE_STATUSES.map((value) => ({ value, label: t(`reservations.createStatus.${value}`) }));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useCan();
  const canOverridePrice = can(PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE);
  const canSeeApprovals = can(PERMISSIONS.APPROVALS_VIEW);
  const { today } = useHotelToday();
  const hotel = useHotelContext().data;
  const defaultBoard = hotel?.defaultBoardType ?? 'BB';
  const { roomTypes } = useRoomTypes();
  const [params] = useSearchParams();

  const prefillRoomId = params.get('oda');
  const waitlistId = params.get('bekleme');

  const [requestId, setRequestId] = useState(newRequestId);
  const [guest, setGuest] = useState({ mode: 'search', guest: null, draft: EMPTY_GUEST_DRAFT });
  const [forceNewGuest, setForceNewGuest] = useState(false);
  const [mode, setMode] = useState('single');
  const [checkIn, setCheckIn] = useState(() => (validDay(params.get('giris')) ? params.get('giris') : today));
  const [checkOut, setCheckOut] = useState(() => (validDay(params.get('cikis')) ? params.get('cikis') : addDaysIso(validDay(params.get('giris')) ? params.get('giris') : today, 1)));
  const [single, setSingle] = useState({ roomTypeId: params.get('tip') ?? '', adults: '2', children: '0', boardType: '', packageId: '' });
  const [groupName, setGroupName] = useState('');
  const [lines, setLines] = useState(() => [newLine('')]);
  /** Rooming list (modül 30) yüklemesinin satır hataları. */
  const [roomingErrors, setRoomingErrors] = useState([]);
  const [status, setStatus] = useState('CONFIRMED');
  const [source, setSource] = useState('UI');
  // Acente adına açılıyorsa (modül 29): fiyat kontrattan gelir, kaynak her zaman "Acente".
  const [agency, setAgency] = useState(null);
  const [notes, setNotes] = useState('');
  const [manual, setManual] = useState({ enabled: false, total: '', note: '' });
  const [couponCode, setCouponCode] = useState(null);
  const [errors, setErrors] = useState({});
  const [guestMatch, setGuestMatch] = useState(null);
  const [shortfall, setShortfall] = useState(null);
  const [approval, setApproval] = useState(null);

  const board = (value) => value || defaultBoard;
  // Kontrat ya da stop-sale değişince açık formun fiyat önizlemesi de tazelenir.
  useAgencyLive();
  usePromotionLive();
  const chooseAgency = (next) => {
    setAgency(next);
    // Acente satışında kupon kullanılmaz (kontrat fiyatı nettir).
    if (next) {
      setSource('AGENCY');
      setCouponCode(null);
    } else if (source === 'AGENCY') setSource('UI');
  };
  const chooseSource = (value) => {
    setSource(value);
    if (value !== 'AGENCY') setAgency(null);
  };

  // Bekleme listesinden çevriliyorsa kaydın bilgileriyle doldur.
  const waitlistQuery = useQuery({
    queryKey: reservationKeys.waitlistEntry(waitlistId ?? ''),
    queryFn: () => api(`/reservations/waitlist/${waitlistId}`),
    enabled: Boolean(waitlistId),
  });
  useEffect(() => {
    const entry = waitlistQuery.data;
    if (!entry) return;
    setGuest({ mode: 'new', guest: null, draft: { firstName: entry.firstName, lastName: entry.lastName, phone: entry.phone ?? '', email: entry.email ?? '', nationality: '' } });
    setCheckIn(entry.checkIn);
    setCheckOut(entry.checkOut);
    setMode('single');
    setSingle({ roomTypeId: entry.roomType.id, adults: String(entry.adults), children: String(entry.children), boardType: entry.boardType, packageId: '' });
    if (entry.notes) setNotes(entry.notes);
  }, [waitlistQuery.data]);

  // Paketler (modül 28): yayındaki paketler seçicide; paket seçilince pansiyon ve
  // oda gece fiyatı paketten gelir. Acente / elle fiyatla birleşmez.
  const packagesQuery = useQuery({
    queryKey: reservationKeys.activePackages,
    queryFn: () => api('/pricing/packages/active'),
  });
  const packages = packagesQuery.data ?? [];
  const packagesDisabled = Boolean(agency) || source === 'AGENCY' || manual.enabled;
  const selectedPackage = !packagesDisabled ? packages.find((pkg) => pkg.id === single.packageId) ?? null : null;

  const stayValid = validDay(checkIn) && validDay(checkOut) && checkOut > checkIn;
  const agencyId = agency?.id ?? null;
  // Pansiyon önizlemeye girer: acente kontratı pansiyona göre fiyatlar, promosyonun
  // pansiyon koşulu da (modül 31) ona bakar. Paket seçiliyse pansiyon paketten.
  const quoteBoard = selectedPackage ? selectedPackage.boardType : board(single.boardType);
  // Kupon yalnızca doğrudan satışta ve sistem fiyatında (elle fiyatta indirim yok).
  const couponUsable = !agency && source !== 'AGENCY' && !(mode === 'single' && manual.enabled);
  const activeCoupon = couponUsable ? couponCode : null;
  const quoteLines = useMemo(
    () =>
      mode === 'single'
        ? single.roomTypeId
          ? [{ roomTypeId: single.roomTypeId, quantity: 1, adults: Number(single.adults) || 1, children: Number(single.children) || 0, boardType: quoteBoard }]
          : []
        : lines
            .filter((line) => line.roomTypeId)
            .map((line) => ({
              roomTypeId: line.roomTypeId,
              quantity: Number(line.quantity) || 1,
              adults: Number(line.adults) || 1,
              children: Number(line.children) || 0,
              boardType: line.boardType || defaultBoard,
            })),
    [mode, single, lines, defaultBoard, quoteBoard],
  );
  const [quoteInput, setQuoteInput] = useState(null);
  useEffect(() => {
    if (!stayValid) {
      setQuoteInput(null);
      return undefined;
    }
    const timer = setTimeout(
      () =>
        setQuoteInput({
          checkIn,
          checkOut,
          lines: quoteLines,
          boardType: mode === 'single' ? quoteBoard : defaultBoard,
          // Promosyonun kanal koşulu satış kaynağına bakar; acente fiyatlanıyorsa promosyon yok.
          ...(agencyId ? { agencyId } : { source, ...(activeCoupon ? { couponCode: activeCoupon } : {}) }),
        }),
      QUOTE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [stayValid, checkIn, checkOut, quoteLines, agencyId, quoteBoard, mode, defaultBoard, source, activeCoupon]);

  const quote = useQuery({
    queryKey: reservationKeys.quote(quoteInput ?? {}),
    queryFn: () => apiPost('/reservations/quote', quoteInput),
    enabled: Boolean(quoteInput),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const quoteData = quote.data;
  const typeQuotes = quoteData?.roomTypes ?? [];
  const selectedQuote = typeQuotes.find((type) => type.id === single.roomTypeId);

  const buildPayload = (overrides = {}) => {
    const guestPart =
      guest.mode === 'existing' && guest.guest
        ? { guestId: guest.guest.id, guest: null }
        : guest.mode === 'new'
          ? { guestId: null, guest: { ...guest.draft } }
          : { guestId: null, guest: null };
    const common = {
      ...guestPart,
      forceNewGuest,
      checkIn,
      checkOut,
      status,
      source: agency ? 'AGENCY' : source,
      agencyId: agency?.id ?? null,
      notes: notes || null,
      requestId,
      waitlistId: waitlistId ?? null,
      couponCode: activeCoupon,
      ...overrides,
    };
    if (mode === 'group') {
      return {
        ...common,
        groupName,
        lines: lines.map((line) => ({
          roomTypeId: line.roomTypeId,
          adults: line.adults,
          children: line.children,
          boardType: board(line.boardType),
          quantity: line.quantity,
          // Satır misafiri (modül 30, rooming list): verilmezse oda grup sorumlusuna açılır.
          guest:
            line.guestFirstName.trim() || line.guestLastName.trim()
              ? { firstName: line.guestFirstName.trim(), lastName: line.guestLastName.trim(), phone: null, email: null, nationality: null }
              : null,
        })),
      };
    }
    return {
      ...common,
      roomTypeId: single.roomTypeId,
      adults: single.adults,
      children: single.children,
      // Paket seçiliyse pansiyon paketten gelir (modül 28).
      boardType: selectedPackage ? selectedPackage.boardType : board(single.boardType),
      packageId: selectedPackage ? selectedPackage.id : null,
      roomId: prefillRoomId ?? null,
      manualTotal: manual.enabled ? manual.total : null,
      priceNote: manual.enabled ? manual.note : null,
    };
  };

  const mutation = useMutation({
    mutationFn: (payload) => apiPost(mode === 'group' ? '/reservations/groups' : '/reservations', payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: reservationKeys.lists });
      queryClient.invalidateQueries({ queryKey: reservationKeys.waitlists });
      if (result.outcome === 'APPROVAL_REQUESTED' || result.outcome === 'APPROVAL_PENDING') {
        setApproval({ approvalId: result.approvalId, pending: result.outcome === 'APPROVAL_PENDING' });
        return;
      }
      const code = result.reservation?.confirmationCode;
      toastSuccess(
        result.outcome === 'EXISTING'
          ? t('reservations.new.alreadyCreated', { code })
          : mode === 'group'
            ? t('reservations.new.groupCreated', { count: result.reservation?.groupMembers?.length ?? '' })
            : t('reservations.new.created', { code }),
      );
      navigate(`/rezervasyonlar/${result.reservation.id}`);
    },
    onError: (error) => {
      if (error.code === 'GUEST_MATCH') {
        setGuestMatch(error.details?.candidates ?? []);
        return;
      }
      if (error.code === 'NO_AVAILABILITY') {
        setShortfall({ message: error.message, nights: error.details?.shortfall ?? [] });
        return;
      }
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.message);
    },
  });

  // Önizleme kuponu "geçersiz" ya da "uymuyor" diyorsa sunucu da reddeder: göndermeden söylenir.
  const couponProblem = activeCoupon && quoteInput?.couponCode === activeCoupon && couponBlocks(quoteData?.coupon) ? couponStatusText(quoteData.coupon) : null;

  const waitlistMutation = useMutation({
    mutationFn: (payload) => apiPost('/reservations/waitlist', payload),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: reservationKeys.waitlists });
      toastSuccess(entry.status === 'AVAILABLE' ? t('reservations.new.waitlistedAvailable') : t('reservations.new.waitlisted'));
      navigate(`/rezervasyonlar/bekleme-listesi?kayit=${entry.id}`);
    },
    onError: (error) => toastError(error.message),
  });

  function submit(event, overrides = {}) {
    event?.preventDefault();
    setGuestMatch(null);
    setShortfall(null);
    const payload = buildPayload(overrides);
    const result = validateWith(mode === 'group' ? createGroupReservationSchema : createReservationSchema, payload);
    if (!result.ok) {
      setErrors(result.errors);
      toastError(t('reservations.new.formErrors'));
      return;
    }
    if (couponProblem) {
      setErrors({ couponCode: couponProblem });
      toastError(t('reservations.new.couponUnusable'));
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  function addToWaitlist() {
    const person =
      guest.mode === 'existing' && guest.guest
        ? { guestId: guest.guest.id, firstName: guest.guest.firstName, lastName: guest.guest.lastName, phone: guest.guest.phone ?? '', email: guest.guest.email ?? '' }
        : { guestId: null, firstName: guest.draft.firstName, lastName: guest.draft.lastName, phone: guest.draft.phone, email: guest.draft.email };
    const payload = {
      ...person,
      roomTypeId: single.roomTypeId,
      adults: single.adults,
      children: single.children,
      boardType: board(single.boardType),
      checkIn,
      checkOut,
      notes: notes || null,
    };
    const result = validateWith(createWaitlistSchema, payload);
    if (!result.ok) {
      toastError(Object.values(result.errors)[0] ?? t('reservations.new.waitlistIncomplete'));
      return;
    }
    waitlistMutation.mutate(payload);
  }

  function resetForm() {
    setRequestId(newRequestId());
    setGuest({ mode: 'search', guest: null, draft: EMPTY_GUEST_DRAFT });
    setForceNewGuest(false);
    setApproval(null);
    setShortfall(null);
    setGuestMatch(null);
    setNotes('');
    setManual({ enabled: false, total: '', note: '' });
    setAgency(null);
    setSource('UI');
    setCouponCode(null);
  }

  const busy = mutation.isPending;
  const typeName = (id) => roomTypes.find((type) => type.id === id)?.name ?? '';

  if (approval) {
    return (
      <Card>
        <div className="flex flex-col gap-4 p-2">
          <Alert tone="warning" title={approval.pending ? t('reservations.new.approvalPending') : t('reservations.new.approvalRequested')}>
            {t('reservations.new.approvalText')}
          </Alert>
          <div className="flex flex-wrap gap-2">
            {canSeeApprovals && (
              <Link to={`/onaylar/bekleyen?onay=${approval.approvalId}`}>
                <Button variant="outline" icon="checkCheck">{t('reservations.new.viewApproval')}</Button>
              </Link>
            )}
            <Button icon="plus" onClick={resetForm}>{t('reservations.list.newReservation')}</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]" noValidate>
      <div className="flex flex-col gap-5">
        {waitlistId && (
          <Alert tone="info" title={t('reservations.new.fromWaitlistTitle')}>
            {waitlistQuery.isPending ? t('reservations.new.entryLoading') : waitlistQuery.isError ? waitlistQuery.error.message : t('reservations.new.fromWaitlistText')}
          </Alert>
        )}
        {prefillRoomId && (
          <Alert tone="info" title={t('reservations.new.fromPlanTitle')}>
            {t('reservations.new.fromPlanText')}
          </Alert>
        )}

        <Card>
          <Section title={t('reservations.detail.guestCard')} icon="user">
            <GuestPicker value={guest} onChange={(value) => { setGuest(value); setForceNewGuest(false); setGuestMatch(null); }} errors={errors} disabled={busy} />
            {guestMatch && (
              <Alert tone="warning" title={t('reservations.new.guestMatchTitle')}>
                <p className="mb-2">{t('reservations.new.guestMatchText')}</p>
                <div className="flex flex-col gap-1.5">
                  {guestMatch.map((candidate) => (
                    <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-item bg-surface px-3 py-2">
                      <span>
                        <span className="font-semibold">{candidate.name}</span>
                        <span className="ml-2 text-xs text-ink-muted">{[candidate.phone, candidate.email].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Button size="sm" variant="outline" onClick={() => { setGuest({ mode: 'existing', guest: candidate, draft: guest.draft }); setGuestMatch(null); }}>
                        {t('reservations.new.thisGuest')}
                      </Button>
                    </div>
                  ))}
                </div>
                <Button className="mt-3" size="sm" onClick={() => { setForceNewGuest(true); submit(null, { forceNewGuest: true }); }}>
                  {t('reservations.new.differentGuest')}
                </Button>
              </Alert>
            )}
          </Section>
        </Card>

        <Card>
          <Section title={t('reservations.detail.stayCard')} icon="calendar">
            <div className="flex flex-wrap items-end gap-3">
              <Input label={t('reservations.form.checkIn')} name="checkIn" type="date" min={today} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} error={errors.checkIn} disabled={busy} className="w-full sm:w-44" required />
              <Input label={t('reservations.form.checkOut')} name="checkOut" type="date" min={validDay(checkIn) ? addDaysIso(checkIn, 1) : today} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} error={errors.checkOut} disabled={busy} className="w-full sm:w-44" required />
              {stayValid && <Badge tone="neutral">{t('reservations.form.nights', { count: quoteData?.nights ?? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000) })}</Badge>}
              {!prefillRoomId && (
                <div className="ml-auto flex gap-1" role="group" aria-label={t('reservations.new.typeLabel')}>
                  {[['single', t('reservations.new.typeSingle')], ['group', t('reservations.new.typeGroup')]].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={mode === value}
                      onClick={() => setMode(value)}
                      disabled={busy}
                      className={`rounded-full border px-3 py-1 text-sm font-semibold ${mode === value ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink-soft'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={t('reservations.detail.fieldSource')} name="source" value={agency ? 'AGENCY' : source} onChange={(e) => chooseSource(e.target.value)} options={sourceOptions} disabled={busy} />
              {(source === 'AGENCY' || agency) && <AgencyPicker value={agency} onChange={chooseAgency} error={errors.agencyId} disabled={busy} required />}
            </div>
            {agency && (
              <p className="text-xs text-ink-muted">
                {t('reservations.new.agencyPriceHint', { agency: agency.name })}
              </p>
            )}
            {quoteData?.agency?.issue && (
              <Alert tone="danger" title={t('reservations.new.agencyBlocked')}>
                {quoteData.agency.issue.message}
              </Alert>
            )}
          </Section>
        </Card>

        <Card>
          <Section title={mode === 'group' ? t('reservations.new.rooms') : t('reservations.new.room')} icon={mode === 'group' ? 'users' : 'bed'}>
            {!stayValid && <p className="text-sm text-ink-muted">{t('reservations.new.pickDatesFirst')}</p>}
            {stayValid && quote.isPending && <Spinner label={t('reservations.new.calculatingAvailability')} />}
            {quote.isError && (
              <Alert tone="danger" title={t('reservations.new.availabilityFailed')} action={<Button size="sm" variant="outline" icon="refresh" onClick={() => quote.refetch()}>{t('common.retry')}</Button>}>
                {quote.error.message}
              </Alert>
            )}

            {mode === 'single' ? (
              <div className="flex flex-col gap-4">
                {typeQuotes.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('reservations.form.roomType')}>
                    {typeQuotes.map((type) => {
                      const selected = type.id === single.roomTypeId;
                      return (
                        <button
                          key={type.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={busy}
                          onClick={() => setSingle((current) => ({ ...current, roomTypeId: type.id }))}
                          className={`flex items-center justify-between gap-3 rounded-item border p-3 text-left transition-colors ${
                            selected ? 'border-ink bg-canvas' : 'border-line hover:border-line-strong'
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="font-semibold text-ink">{type.name}</span>
                            <span className="text-xs text-ink-muted">{t('reservations.new.capacity', { adults: type.capacityAdults, children: type.capacityChildren })}</span>
                          </span>
                          <span className="text-right">
                            {type.discount && (
                              <span className="block text-xs text-ink-muted line-through">{formatMoney(type.listTotal, quoteData?.currency)}</span>
                            )}
                            <span className="block font-semibold">{formatMoney(type.total, quoteData?.currency)}</span>
                            {type.discount && (
                              <Badge tone="success" className="mb-1 max-w-[11rem] truncate">
                                {type.discount.couponCode ? t('reservations.edit.coupon', { code: type.discount.couponCode }) : type.discount.promotion.name}
                              </Badge>
                            )}
                            {type.agency && !type.agency.sellable && (
                              <Badge tone="danger" className="mb-1">
                                {type.agency.issue?.code === 'AGENCY_STOP_SALE' ? t('reservations.new.stopSale') : t('reservations.new.notInContract')}
                              </Badge>
                            )}
                            <Badge tone={type.available > 0 ? 'success' : 'danger'}>{type.available > 0 ? t('reservations.new.available', { count: type.available }) : t('reservations.new.noAvailability')}</Badge>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {errors.roomTypeId && <p className="text-xs text-sec-strong">{errors.roomTypeId}</p>}
                {selectedQuote?.agency && !selectedQuote.agency.sellable && (
                  <Alert tone="warning" title={t('reservations.new.typeNotSellable', { agency: agency?.name ?? t('reservations.detail.fieldAgency') })}>
                    {agencyIssueText(selectedQuote.agency.issue, canOverridePrice)}
                  </Alert>
                )}
                <div className="flex flex-wrap gap-3">
                  <Input label={t('reservations.form.adults')} name="adults" type="number" min={1} max={20} value={single.adults} onChange={(e) => setSingle((c) => ({ ...c, adults: e.target.value }))} error={errors.adults} disabled={busy} className="w-28" />
                  <Input label={t('reservations.form.children')} name="children" type="number" min={0} max={20} value={single.children} onChange={(e) => setSingle((c) => ({ ...c, children: e.target.value }))} error={errors.children} disabled={busy} className="w-28" />
                  <Select
                    label={t('reservations.form.board')}
                    name="boardType"
                    value={quoteBoard}
                    onChange={(e) => setSingle((c) => ({ ...c, boardType: e.target.value }))}
                    options={boardOptions}
                    disabled={busy || Boolean(selectedPackage)}
                    className="w-full sm:w-64"
                  />
                  {packages.length > 0 && (
                    <Select
                      label={t('reservations.detail.fieldPackage')}
                      name="packageId"
                      value={single.packageId}
                      onChange={(e) => setSingle((c) => ({ ...c, packageId: e.target.value }))}
                      options={[{ value: '', label: t('reservations.new.noPackage') }, ...packages.map((pkg) => ({ value: pkg.id, label: `${pkg.name} — ${boardLong(pkg.boardType)}` }))]}
                      disabled={busy || packagesDisabled}
                      className="w-full sm:w-72"
                    />
                  )}
                </div>
                {packagesDisabled && single.packageId && (
                  <p className="text-xs text-ink-muted">{t('reservations.new.packageIgnored')}</p>
                )}
                {selectedPackage && (
                  <Alert tone="info" title={t('reservations.new.packageTitle', { name: selectedPackage.name })}>
                    {t('reservations.new.packageText', { price: formatMoney(selectedPackage.nightlyPrice, quoteData?.currency), board: boardLong(selectedPackage.boardType) })}
                  </Alert>
                )}
                {selectedQuote && single.adults && Number(single.adults) > selectedQuote.capacityAdults && (
                  <Alert tone="warning" title={t('reservations.new.capacityTitle')}>
                    {t('reservations.new.capacityText', { type: selectedQuote.name, adults: selectedQuote.capacityAdults })}
                  </Alert>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Input label={t('reservations.new.groupName')} name="groupName" placeholder={t('reservations.new.groupNamePlaceholder')} value={groupName} onChange={(e) => setGroupName(e.target.value)} error={errors.groupName} disabled={busy} className="w-full sm:w-96" />
                {lines.map((line, index) => {
                  const typeQuote = typeQuotes.find((type) => type.id === line.roomTypeId);
                  const lineQuote = agency ? quoteData?.lines?.[lines.filter((row) => row.roomTypeId).findIndex((row) => row.key === line.key)] : null;
                  const update = (field, value) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, [field]: value } : row)));
                  return (
                    <div key={line.key} className="flex flex-wrap items-end gap-2 rounded-item border border-line p-3">
                      <Select
                        label={t('reservations.form.roomType')}
                        name={`lines.${index}.roomTypeId`}
                        value={line.roomTypeId}
                        onChange={(e) => update('roomTypeId', e.target.value)}
                        options={[{ value: '', label: t('reservations.form.choose') }, ...roomTypes.map((type) => {
                          const q = typeQuotes.find((row) => row.id === type.id);
                          return { value: type.id, label: `${type.code} — ${type.name}${q ? ` (${t('reservations.new.available', { count: q.available })})` : ''}` };
                        })]}
                        error={errors[`lines.${index}.roomTypeId`]}
                        disabled={busy}
                        className="w-full sm:w-64"
                      />
                      <Input label={t('reservations.new.roomCount')} type="number" min={1} max={50} value={line.quantity} onChange={(e) => update('quantity', e.target.value)} error={errors[`lines.${index}.quantity`]} disabled={busy} className="w-28" />
                      <Input label={t('reservations.new.adultsPerRoom')} type="number" min={1} max={20} value={line.adults} onChange={(e) => update('adults', e.target.value)} error={errors[`lines.${index}.adults`]} disabled={busy} className="w-32" />
                      <Input label={t('reservations.new.childrenPerRoom')} type="number" min={0} max={20} value={line.children} onChange={(e) => update('children', e.target.value)} disabled={busy} className="w-28" />
                      <Select label={t('reservations.form.board')} value={board(line.boardType)} onChange={(e) => update('boardType', e.target.value)} options={boardOptions} disabled={busy} className="w-full sm:w-56" />
                      <Input
                        label={t('reservations.new.lineGuestFirstName')}
                        value={line.guestFirstName}
                        onChange={(e) => update('guestFirstName', e.target.value)}
                        error={errors[`lines.${index}.guest.firstName`]}
                        disabled={busy}
                        placeholder={t('reservations.new.lineGuestPlaceholder')}
                        className="w-full sm:w-40"
                      />
                      <Input
                        label={t('reservations.new.lineGuestLastName')}
                        value={line.guestLastName}
                        onChange={(e) => update('guestLastName', e.target.value)}
                        error={errors[`lines.${index}.guest.lastName`]}
                        disabled={busy}
                        className="w-full sm:w-36"
                      />
                      {typeQuote && (
                        <span className="self-center text-sm">
                          {lineQuote && lineQuote.unitTotal === null ? (
                            <span className="font-semibold text-sec-strong">{agencyIssueText(lineQuote.agency?.issue, canOverridePrice) || t('reservations.new.noPrice')}</span>
                          ) : (
                            <>{t('reservations.new.perRoom', { amount: formatMoney(lineQuote ? lineQuote.unitTotal : typeQuote.total, quoteData?.currency) })}</>
                          )}
                          {typeQuote.available < Number(line.quantity) && <Badge tone="danger" className="ml-2">{t('reservations.new.available', { count: Math.max(0, typeQuote.available) })}</Badge>}
                        </span>
                      )}
                      {lines.length > 1 && (
                        <Button variant="ghost" size="sm" icon="trash" aria-label={t('reservations.new.removeLine', { index: index + 1 })} disabled={busy} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} />
                      )}
                    </div>
                  );
                })}
                {errors.lines && <p className="text-xs text-sec-strong">{errors.lines}</p>}
                {lines.length < MAX_GROUP_LINES && (
                  <div>
                    <Button variant="outline" size="sm" icon="plus" disabled={busy} onClick={() => setLines((current) => [...current, newLine('')])}>
                      {t('reservations.new.addLine')}
                    </Button>
                  </div>
                )}

                {/* Rooming list (modül 30): operatörün Excel listesi satırlara dönüşür; tarihler formun ortak giriş / çıkışı. */}
                <div className="flex flex-col gap-2 rounded-item border border-dashed border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{t('reservations.new.roomingTitle')}</span>
                    <span className="text-xs text-ink-muted">{t('reservations.new.roomingHint')}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      icon="fileText"
                      disabled={busy}
                      onClick={() => downloadRoomingTemplate({ roomTypes }).catch(() => toastError(t('reservations.new.templateFailed')))}
                    >
                      {t('reservations.new.downloadTemplate')}
                    </Button>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-muted">
                      <Icon name="inbox" className="size-4" />
                      {t('reservations.new.uploadFile')}
                      <input
                        type="file"
                        accept=".xlsx"
                        className="sr-only"
                        disabled={busy}
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (!file) return;
                          try {
                            const { lines: parsed, errors: issues } = await readRoomingList(file, { roomTypes, defaultBoardType: defaultBoard || 'BB' });
                            setRoomingErrors(issues);
                            if (parsed.length > 0) {
                              setLines(
                                parsed.map((row) => ({
                                  ...newLine(row.boardType, row.roomTypeId),
                                  adults: String(row.adults),
                                  children: String(row.children),
                                  guestFirstName: row.guest.firstName,
                                  guestLastName: row.guest.lastName,
                                })),
                              );
                              toastSuccess(t('reservations.new.linesLoaded', { count: parsed.length }));
                            }
                          } catch {
                            setRoomingErrors([t('reservations.new.fileUnreadable')]);
                          }
                        }}
                      />
                    </label>
                  </div>
                  {roomingErrors.length > 0 && (
                    <Alert tone="warning" title={t('reservations.new.someLinesSkipped')}>
                      <ul className="list-inside list-disc text-sm">
                        {roomingErrors.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                </div>
              </div>
            )}
          </Section>
        </Card>

        <Card>
          <Section title={t('reservations.new.statusAndNote')} icon="fileText">
            <div className="flex flex-wrap gap-3">
              <Select label={t('reservations.list.colStatus')} name="status" value={status} onChange={(e) => setStatus(e.target.value)} options={statusOptions} disabled={busy} className="w-full sm:w-64" />
            </div>
            {status === 'PENDING' && <p className="text-xs text-ink-muted">{t('reservations.new.pendingHint')}</p>}
            <Textarea label={t('reservations.form.notes')} name="notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} disabled={busy} />
          </Section>
        </Card>
      </div>

      <aside className="flex flex-col gap-5 xl:sticky xl:top-28 xl:self-start">
        <Card>
          <Section title={t('reservations.detail.priceCard')} icon="percent">
            {!quoteData || quoteLines.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('reservations.new.priceEmpty')}</p>
            ) : (
              <PriceSummary quote={quoteData} selectedQuote={mode === 'single' ? selectedQuote : null} manual={manual} typeName={typeName} />
            )}
            {/* Kupon (modül 31): acente satışında ve elle fiyatta yok. */}
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              {couponUsable ? (
                <CouponField
                  value={couponCode}
                  onChange={(code) => {
                    setCouponCode(code);
                    setErrors((current) => ({ ...current, couponCode: undefined }));
                  }}
                  coupon={quoteInput?.couponCode === couponCode ? quoteData?.coupon : null}
                  // Önizleme yoksa (tarih / oda seçilmedi) denetim de yok: durum boş kalır.
                  checking={Boolean(couponCode && quoteInput) && (quoteInput.couponCode !== couponCode || quote.isFetching)}
                  error={errors.couponCode}
                  disabled={busy}
                />
              ) : (
                <p className="text-xs text-ink-muted">
                  {agency || source === 'AGENCY' ? t('reservations.new.agencyNoCoupon') : t('reservations.new.manualNoCoupon')}
                </p>
              )}
            </div>
            {mode === 'single' && canOverridePrice && (
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <Checkbox label={t('reservations.new.manualPrice')} checked={manual.enabled} onChange={(e) => setManual((c) => ({ ...c, enabled: e.target.checked }))} disabled={busy} />
                {manual.enabled && (
                  <>
                    <Input label={t('reservations.form.totalWithCurrency', { currency: quoteData?.currency ?? hotel?.currency ?? '' })} name="manualTotal" inputMode="decimal" placeholder="1250,00" value={manual.total} onChange={(e) => setManual((c) => ({ ...c, total: e.target.value }))} error={errors.manualTotal} disabled={busy} />
                    <Input label={t('reservations.form.justification')} name="priceNote" placeholder={t('reservations.new.justificationPlaceholder')} value={manual.note} onChange={(e) => setManual((c) => ({ ...c, note: e.target.value }))} error={errors.priceNote} disabled={busy} />
                  </>
                )}
              </div>
            )}
          </Section>
        </Card>

        {shortfall && (
          <Alert tone="danger" title={t('reservations.new.noAvailability')}>
            <p>{shortfall.message}</p>
            {mode === 'single' && (
              <Button className="mt-3" size="sm" variant="outline" icon="clock" disabled={waitlistMutation.isPending} onClick={addToWaitlist}>
                {waitlistMutation.isPending ? t('reservations.waitlist.adding') : t('reservations.new.addGuestToWaitlist')}
              </Button>
            )}
          </Alert>
        )}

        <Button type="submit" icon="check" disabled={busy} className="w-full">
          {busy ? t('reservations.new.submitting') : mode === 'group' ? t('reservations.new.submitGroup') : t('reservations.new.submit')}
        </Button>
        {quoteData?.overbookingPolicy === 'APPROVAL' && (
          <p className="text-xs text-ink-muted">{t('reservations.new.approvalPolicyHint')}</p>
        )}
      </aside>
    </form>
  );
}

/**
 * @param {{ title: string, icon: string, children: React.ReactNode }} props
 */
function Section({ title, icon, children }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 p-1">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">
        <Icon name={icon} className="size-[18px] text-ink-muted" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * @param {{ quote: object, selectedQuote: object | null, manual: { enabled: boolean, total: string }, typeName: (id: string) => string }} props
 */
function PriceSummary({ quote, selectedQuote, manual, typeName }) {
  const t = useT();
  const currency = quote.currency;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {selectedQuote && selectedQuote.total === null ? (
        <p className="text-xs text-ink-muted">{t('reservations.new.noPriceForType')}</p>
      ) : selectedQuote ? (
        <>
          {selectedQuote.discount && !manual.enabled && (
            <div className="flex flex-col gap-0.5 rounded-item bg-canvas p-2 text-xs">
              <span className="flex justify-between"><span>{t('reservations.detail.listPrice')}</span><span>{formatMoney(selectedQuote.listTotal, currency)}</span></span>
              <span className="flex justify-between gap-2 font-semibold text-success-ink">
                <span className="min-w-0 truncate">
                  {selectedQuote.discount.promotion.name} ({selectedQuote.discount.promotion.label}){selectedQuote.discount.couponCode ? ` · ${selectedQuote.discount.couponCode}` : ''}
                </span>
                <span className="shrink-0">−{formatMoney(selectedQuote.discount.amount, currency)}</span>
              </span>
            </div>
          )}
          <table className="w-full text-xs">
            <caption className="sr-only">{t('reservations.detail.nightlyCaption')}</caption>
            <tbody className="divide-y divide-line">
              {selectedQuote.nights.slice(0, 14).map((night) => (
                <tr key={night.date}>
                  <td className="py-1">{formatDate(night.date)}</td>
                  <td className="py-1 text-ink-muted">{night.seasonName ? (night.multiplier ? `${night.seasonName} ×${night.multiplier.replace('.', ',')}` : night.seasonName) : ''}</td>
                  <td className="py-1 text-right font-semibold">
                    {night.discount && night.discount !== '0.00' && <span className="mr-1.5 font-normal text-success-ink">−{formatMoney(night.discount, currency)}</span>}
                    {formatMoney(night.amount, currency)}
                  </td>
                </tr>
              ))}
              {selectedQuote.nights.length > 14 && (
                <tr>
                  <td colSpan={3} className="py-1 text-ink-muted">{t('reservations.new.moreNights', { count: selectedQuote.nights.length - 14 })}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {quote.lines.map((line, index) => (
            <li key={`${line.roomTypeId}-${index}`} className="flex flex-col">
              <span className="flex justify-between">
                <span>{typeName(line.roomTypeId)} × {line.quantity}</span>
                <span className="font-semibold">{formatMoney(line.total, currency)}</span>
              </span>
              {line.discount && (
                <span className="text-success-ink">
                  {t('reservations.new.lineDiscount', { name: line.discount.couponCode ? t('reservations.edit.coupon', { code: line.discount.couponCode }) : line.discount.promotion.name, amount: formatMoney(line.discount.amount, currency) })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-baseline justify-between border-t border-line pt-2">
        <span className="font-semibold">{t('reservations.detail.total')}</span>
        <span className="text-lg font-bold">{manual.enabled && manual.total ? formatMoney(manual.total.replace(',', '.'), currency) : formatMoney(quote.total, currency)}</span>
      </div>
      {manual.enabled && <p className="text-xs text-ink-muted">{t('reservations.new.systemPrice', { amount: formatMoney(quote.total, currency) })}</p>}
      {quote.taxes.included.map((tax) => (
        <p key={tax.name} className="text-xs text-ink-muted">{t('reservations.detail.taxIncluded', { rate: tax.rate, name: tax.name, amount: formatMoney(tax.amount, currency) })}</p>
      ))}
      {quote.taxes.added.map((tax) => (
        <p key={tax.name} className="text-xs text-ink-muted">{t('reservations.detail.taxAdded', { rate: tax.rate, name: tax.name, amount: formatMoney(tax.amount, currency) })}</p>
      ))}
      {quote.shortages.length > 0 && (
        <Alert tone="warning" title={t('reservations.new.shortageTitle')}>
          {quote.shortages.map((row) => t('reservations.new.shortageLine', { type: typeName(row.roomTypeId), requested: row.requested, available: row.available })).join('; ')}
        </Alert>
      )}
      <p className="text-xs text-ink-muted">
        {quote.cancellation.freeUntil
          ? quote.cancellation.penaltyApplies
            ? t('reservations.new.policyPenalty', { fee: formatMoney(quote.cancellation.fee, currency) })
            : t('reservations.detail.freeCancelUntil', { date: formatDate(quote.cancellation.freeUntil) })
          : t('reservations.new.noPolicy')}
      </p>
    </div>
  );
}
