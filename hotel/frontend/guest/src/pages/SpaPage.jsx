import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Icon, Select, Spinner, Textarea } from '@hotelos/ui';
import { guestApi, portalPath } from '../api.js';
import { usePortal } from '../App.jsx';
import { errorText, useI18n } from '../i18n.jsx';
import { SPA_MAX_ENROLL_GUESTS, SPA_NOTE_MAX } from '../limits.js';
import { useLoad } from '../useLoad.js';

const STATUS_TONES = Object.freeze({ BOOKED: 'info', WAITLISTED: 'warning', COMPLETED: 'success', CANCELLED: 'neutral', NO_SHOW: 'danger' });
/** Gün seçiminde gösterilen en fazla gün (uzun konaklamada liste taşmasın; sonrası için resepsiyon). */
const DAY_LIMIT = 14;
const GENDERS = Object.freeze(['', 'FEMALE', 'MALE']);

/** @param {string} day @param {number} count */
const addDays = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

/**
 * Spa (modül 57): misafir konaklama günlerine randevu alır — hizmet → gün → boş saat → onay. Randevu anında kesinleşir.
 * Grup derslerine kaydolur (doluysa yedek liste). Kendi kayıtlarını görür ve saati gelmemiş olanı iptal eder; iptal
 * bedeli varsa onaydan önce gösterilir.
 */
export function SpaPage() {
  const { token } = usePortal();
  const { t, fmt, language } = useI18n();
  const page = useLoad(portalPath(token, '/spa'), { intervalMs: 60_000 });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const data = page.data;

  /** Sunucuya yazan işlemlerin ortak kalıbı: sayfa yenilenir, sonuç üstte yazar. */
  const run = async (key, work, success) => {
    setBusy(key);
    setStatus(null);
    try {
      const result = await work();
      await page.reload({ quiet: true });
      setStatus({ tone: 'success', text: typeof success === 'function' ? success(result) : success });
      return result;
    } catch (error) {
      setStatus({ tone: 'danger', text: errorText(t, error) });
      // Saat / yer bu arada dolduysa liste yenilensin.
      await page.reload({ quiet: true });
      return null;
    } finally {
      setBusy('');
    }
  };

  if (page.loading && !data) return <Spinner label={t('common.loading')} className="py-10" />;
  if (page.error && !data) return <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => page.reload()}>{t('common.retry')}</Button>}>{errorText(t, page.error)}</Alert>;

  const nameOf = (serviceId, fallback) => data.services.find((service) => service.id === serviceId)?.texts[language]?.name ?? fallback;
  const mine = data.appointments.filter((item) => ['BOOKED', 'WAITLISTED'].includes(item.status));
  const past = data.appointments.filter((item) => !['BOOKED', 'WAITLISTED'].includes(item.status));
  const full = data.activeCount >= data.policy.maxActive;

  const cancel = (item) => {
    const question = item.cancelFee ? t('spa.cancelFeeConfirm', { amount: fmt.money(item.cancelFee.total, data.currency), pct: Number(item.cancelFee.pct) }) : t('spa.cancelConfirm');
    if (!window.confirm(question)) return;
    run(`cancel:${item.id}`, () => guestApi(portalPath(token, `/spa/appointments/${item.id}/cancel`), { method: 'POST' }), t('spa.cancelled'));
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-brand text-2xl font-bold text-ink">{t('spa.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('spa.intro')}</p>
      </div>
      {status && <Alert tone={status.tone}>{status.text}</Alert>}

      {mine.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold text-ink">{t('spa.mine')}</h2>
          <ul className="flex flex-col gap-2">
            {mine.map((item) => (
              <li key={item.id} className="rounded-panel border border-line bg-surface p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{nameOf(item.serviceId, item.serviceName)}</span>
                    <span className="block text-ink-soft">
                      {fmt.day(item.day)} · {item.time}–{item.endTime}
                      {item.guestCount > 1 ? ` · ${t('spa.persons', { count: item.guestCount })}` : ''}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {item.code} · {fmt.money(item.priceTotal, data.currency)}
                      {item.roomName ? ` · ${item.roomName}` : ''}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONES[item.status]}>{t(`spaStatus.${item.status}`)}</Badge>
                </div>
                {item.canCancel && (
                  <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => cancel(item)} disabled={busy === `cancel:${item.id}`}>
                    {t('spa.cancel')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!data.enabled ? (
        <Alert tone="info">{t('spa.closed')}</Alert>
      ) : (
        <>
          {full && <Alert tone="warning">{t('spa.limit', { count: data.policy.maxActive })}</Alert>}
          <BookingSection data={data} token={token} disabled={full || Boolean(busy)} run={run} />
          {data.sessions.length > 0 && <SessionsSection data={data} token={token} disabled={Boolean(busy)} blocked={full} run={run} />}
          <p className="text-xs text-ink-muted">
            <Icon name="info" className="mr-1 inline size-3.5 align-text-bottom" />
            {data.policy.freeCancelHours > 0
              ? t('spa.policy', { hours: data.policy.freeCancelHours, late: Number(data.policy.lateCancelFeePct), noShow: Number(data.policy.noShowFeePct) })
              : t('spa.policyFree', { noShow: Number(data.policy.noShowFeePct) })}
          </p>
        </>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold text-ink">{t('spa.past')}</h2>
          <ul className="flex flex-col gap-2">
            {past.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-panel border border-line bg-surface p-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{nameOf(item.serviceId, item.serviceName)}</span>
                  <span className="block text-xs text-ink-muted">
                    {fmt.day(item.day)} · {item.time}
                    {Number(item.totalDue) > 0 ? ` · ${fmt.money(item.totalDue, data.currency)}` : ''}
                  </span>
                </span>
                <Badge tone={STATUS_TONES[item.status]}>{t(`spaStatus.${item.status}`)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Randevu al: hizmet → gün → (tercih) → boş saat → onay. */
function BookingSection({ data, token, disabled, run }) {
  const { t, fmt, language } = useI18n();
  const services = data.services.filter((service) => service.kind === 'PRIVATE');
  const days = useMemo(() => {
    const list = [];
    for (let day = data.window.from; day <= data.window.to && list.length < DAY_LIMIT; day = addDays(day, 1)) list.push(day);
    return list;
  }, [data.window.from, data.window.to]);
  const [serviceId, setServiceId] = useState('');
  const [day, setDay] = useState(days[0]);
  const [gender, setGender] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  // Aynı onay iki kez gönderilse de tek randevu açılır.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const service = services.find((item) => item.id === serviceId);
  const query = serviceId && day ? `/spa/availability?serviceId=${serviceId}&day=${day}${gender ? `&gender=${gender}` : ''}` : null;
  const slots = useLoad(query ? portalPath(token, query) : null);

  if (services.length === 0) return null;
  const choose = (patch) => {
    setTime('');
    if ('serviceId' in patch) setServiceId(patch.serviceId);
    if ('day' in patch) setDay(patch.day);
    if ('gender' in patch) setGender(patch.gender);
  };
  const book = async () => {
    const result = await run(
      'book',
      () => guestApi(portalPath(token, '/spa/appointments'), { method: 'POST', body: { requestId, serviceId, day, time, gender: gender || null, note: note.trim() || null } }),
      (done) => t('spa.booked', { time: done.appointment.time, day: fmt.day(done.appointment.day) }),
    );
    setTime('');
    if (result) {
      setServiceId('');
      setNote('');
      setRequestId(crypto.randomUUID());
    } else {
      slots.reload({ quiet: true });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-bold text-ink">{t('spa.book')}</h2>
      <ul className="flex flex-col gap-2">
        {services.map((item) => {
          const selected = item.id === serviceId;
          const text = item.texts[language] ?? item.texts.tr;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => choose({ serviceId: selected ? '' : item.id })}
                className={`flex w-full items-start justify-between gap-3 rounded-panel border p-3 text-left text-sm disabled:opacity-60 ${selected ? 'border-ink bg-surface-muted' : 'border-line bg-surface hover:border-line-strong'}`}
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{text.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {t(`spaCategory.${item.category}`)} · {t('spa.minutes', { count: item.durationMinutes })}
                    {item.guestCount > 1 ? ` · ${t('spa.persons', { count: item.guestCount })}` : ''}
                  </span>
                  {selected && text.description && <span className="mt-1 block text-ink-soft">{text.description}</span>}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-ink">{fmt.money(item.priceTotal, data.currency)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {service && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{t('spa.day')}</span>
            <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={t('spa.day')}>
              {days.map((item) => (
                <button key={item} type="button" aria-pressed={day === item} onClick={() => choose({ day: item })} className={`shrink-0 rounded-control border px-3 py-1.5 text-xs font-semibold ${day === item ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'}`}>
                  {fmt.shortDay(item)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{t('spa.preference')}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={t('spa.preference')}>
              {GENDERS.map((item) => (
                <button key={item || 'any'} type="button" aria-pressed={gender === item} onClick={() => choose({ gender: item })} className={`rounded-control border px-3 py-1.5 text-xs font-semibold ${gender === item ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'}`}>
                  {t(`spa.gender.${item || 'ANY'}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{t('spa.time')}</span>
            {slots.loading && !slots.data ? (
              <Spinner label={t('common.loading')} className="justify-start py-2" />
            ) : slots.error ? (
              <Alert tone="danger" className="mt-1.5">{errorText(t, slots.error)}</Alert>
            ) : !slots.data?.times.length ? (
              <p className="mt-1.5 text-sm text-ink-muted">{t('spa.noTimes')}</p>
            ) : (
              <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label={t('spa.time')}>
                {slots.data.times.map((item) => (
                  <button key={item} type="button" aria-pressed={time === item} onClick={() => setTime(item)} className={`rounded-control border px-3 py-1.5 text-xs font-semibold tabular-nums ${time === item ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'}`}>
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Textarea label={`${t('spa.note')} (${t('common.optional')})`} rows={2} maxLength={SPA_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('spa.notePlaceholder')} />
          <Button type="button" icon="check" disabled={!time || disabled} onClick={book}>
            {time ? t('spa.confirm', { time, amount: fmt.money(service.priceTotal, data.currency) }) : t('spa.pickTime')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Grup dersleri: yer varsa kayıt, doluysa yedek liste. */
function SessionsSection({ data, token, disabled, blocked, run }) {
  const { t, fmt, language } = useI18n();
  const [counts, setCounts] = useState({});
  const enroll = (session, waitlist) =>
    run(
      `enroll:${session.id}`,
      () => guestApi(portalPath(token, `/spa/sessions/${session.id}/enroll`), { method: 'POST', body: { requestId: crypto.randomUUID(), guestCount: Number(counts[session.id] ?? 1), waitlist } }),
      (done) => (done.waitlisted ? t('spa.waitlisted') : t('spa.enrolled')),
    );
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-bold text-ink">{t('spa.classes')}</h2>
      <ul className="flex flex-col gap-2">
        {data.sessions.map((session) => {
          const service = data.services.find((item) => item.id === session.serviceId);
          const count = Number(counts[session.id] ?? 1);
          const fits = count <= session.free;
          return (
            <li key={session.id} className="rounded-panel border border-line bg-surface p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{service?.texts[language]?.name ?? '—'}</span>
                  <span className="block text-ink-soft">
                    {fmt.day(session.day)} · {session.time}–{session.endTime}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {session.roomName ? `${session.roomName} · ` : ''}
                    {fmt.money(session.priceTotal, data.currency)} · {session.free > 0 ? t('spa.seats', { count: session.free }) : t('spa.full')}
                  </span>
                </span>
                {session.enrolled && <Badge tone={STATUS_TONES[session.enrolled]}>{t(`spaStatus.${session.enrolled}`)}</Badge>}
              </div>
              {!session.enrolled && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Select
                    aria-label={t('spa.guestCount')}
                    compact
                    className="w-28"
                    value={String(count)}
                    onChange={(event) => setCounts((current) => ({ ...current, [session.id]: event.target.value }))}
                    options={Array.from({ length: SPA_MAX_ENROLL_GUESTS }, (_, index) => ({ value: String(index + 1), label: t('spa.persons', { count: index + 1 }) }))}
                  />
                  <Button type="button" size="sm" variant={fits ? 'primary' : 'outline'} disabled={disabled || blocked} onClick={() => enroll(session, !fits)}>
                    {fits ? t('spa.enroll') : t('spa.joinWaitlist')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
