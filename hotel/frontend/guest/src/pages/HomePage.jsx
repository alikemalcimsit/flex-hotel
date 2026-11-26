import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Badge, Icon } from '@hotelos/ui';
import { guestApi, portalPath } from '../api.js';
import { usePortal } from '../App.jsx';
import { errorText, useI18n } from '../i18n.jsx';

/**
 * Portalın ana sayfası: karşılama, rezervasyon özeti, online check-in durumu ve konaklamaya göre açılan kutular
 * (hesap, istek, oda servisi, sohbet, kartla ödeme; dijital anahtar "yakında").
 */
export function HomePage() {
  const { token, overview } = usePortal();
  const { t, fmt, language } = useI18n();
  const navigate = useNavigate();
  const [rsError, setRsError] = useState(null);
  const [rsBusy, setRsBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const { reservation, hotel, checkin, features } = overview;
  const nights = fmt.nights(reservation.checkIn, reservation.checkOut);

  const openRoomService = async () => {
    setRsBusy(true);
    setRsError(null);
    try {
      const { path } = await guestApi(portalPath(token, '/room-service'), { method: 'POST' });
      if (path) navigate(path.replace(/^\/misafir/, ''));
    } catch (error) {
      setRsError(errorText(t, error));
    } finally {
      setRsBusy(false);
    }
  };

  // Sanal POS (50): açık bakiye için ödeme linki açılır (ya da açık olan kullanılır), ödeme sayfasına gidilir.
  const payOnline = async () => {
    setPayBusy(true);
    setRsError(null);
    try {
      const { code } = await guestApi(portalPath(token, '/pay'), { method: 'POST', body: {} });
      if (code) navigate(`/o/${encodeURIComponent(code)}`);
    } catch (error) {
      setRsError(errorText(t, error));
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h1 className="font-brand text-2xl font-bold text-ink">{overview.guestName ? t('home.hello', { name: overview.guestName.split(' ')[0] }) : t('home.helloAnon')}</h1>
        <p className="mt-1 text-ink-soft">
          {reservation.status === 'CHECKED_IN' ? t('home.inStay') : reservation.status === 'CHECKED_OUT' ? t('home.after') : overview.welcome?.[language]}
        </p>
      </section>

      <section className="rounded-card border border-line bg-surface p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('home.reservation')}</p>
            <p className="mt-1 text-lg font-bold text-ink">{t('home.dates', { from: fmt.day(reservation.checkIn), to: fmt.day(reservation.checkOut) })}</p>
            <p className="text-sm text-ink-soft">
              {t('home.nights', { count: nights })} · {reservation.children ? t('home.party', { adults: reservation.adults, children: reservation.children }) : t('home.partyAdults', { adults: reservation.adults })}
            </p>
          </div>
          {reservation.roomNumber && <Badge tone="info">{t('home.room', { number: reservation.roomNumber })}</Badge>}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-muted">{t('home.code')}</dt>
            <dd className="font-mono font-semibold">{reservation.confirmationCode}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">{t('home.roomType')}</dt>
            <dd className="font-semibold">{reservation.roomTypeName ?? '—'}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-ink-muted">{t('home.times', { checkIn: hotel.checkInTime, checkOut: hotel.checkOutTime })}</p>
      </section>

      {features.checkin && <CheckinCard checkin={checkin} token={token} />}

      {overview.loyalty && <LoyaltyCard loyalty={overview.loyalty} currency={hotel.currency} />}

      <section className="grid grid-cols-2 gap-3">
        {features.folio && <Tile to={`/p/${token}/folyo`} icon="wallet" title={t('tile.folio')} hint={t('tile.folioHint')} />}
        {features.requests && <Tile to={`/p/${token}/istek`} icon="bell" title={t('tile.requests')} hint={t('tile.requestsHint')} />}
        {features.roomService && <Tile onClick={openRoomService} busy={rsBusy} icon="utensils" title={t('tile.roomService')} hint={t('tile.roomServiceHint')} />}
        {features.spa && <Tile to={`/p/${token}/spa`} icon="sparkles" title={t('tile.spa')} hint={t('tile.spaHint')} />}
        {features.survey && <Tile to={features.survey.path.replace(/^\/misafir/, '')} icon="star" title={t('tile.survey')} hint={t('tile.surveyHint')} />}
        {features.chatKey && <Tile icon="message" title={t('tile.chat')} hint={t('tile.chatHint')} />}
        <Tile icon="key" title={t('tile.digitalKey')} hint={t('common.soon')} disabled />
        {features.payOnline && <Tile onClick={payOnline} busy={payBusy} icon="creditCard" title={t('tile.payOnline')} hint={t('tile.payOnlineHint')} />}
      </section>
      {rsError && <Alert tone="warning">{rsError}</Alert>}

      {(hotel.phone || hotel.email) && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface-muted p-4 text-sm">
          <span className="font-semibold text-ink">{t('home.contact')}</span>
          <span className="flex gap-2">
            {hotel.phone && (
              <a href={`tel:${hotel.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 rounded-item border border-line bg-surface px-3 py-1.5 font-semibold">
                <Icon name="phone" className="size-4" /> {t('home.call')}
              </a>
            )}
            {hotel.email && (
              <a href={`mailto:${hotel.email}`} className="inline-flex items-center gap-1 rounded-item border border-line bg-surface px-3 py-1.5 font-semibold">
                <Icon name="mail" className="size-4" /> {t('home.mail')}
              </a>
            )}
          </span>
        </section>
      )}
    </div>
  );
}

/** Online check-in'in durumu ve eylemi. */
function CheckinCard({ checkin, token }) {
  const { t, fmt } = useI18n();
  const target = `/p/${token}/check-in`;
  const tone = { APPROVED: 'success', COMPLETED: 'success', REJECTED: 'warning', SUBMITTED: 'info' }[checkin.status] ?? 'neutral';
  let body;
  let action = null;
  if (checkin.status === 'REJECTED' && checkin.open) {
    body = (
      <>
        {t('checkinCard.REJECTED')} <strong>{checkin.rejectReason}</strong>
      </>
    );
    action = { label: t('checkinCard.fix'), primary: true };
  } else if (checkin.status) {
    body = t(`checkinCard.${checkin.status}`);
    action = { label: t('checkinCard.view'), primary: false };
  } else if (checkin.open) {
    body = t('checkinCard.open');
    action = { label: t('checkinCard.start'), primary: true };
  } else {
    body = t(`checkinCard.${checkin.reason}`, { date: fmt.day(checkin.opensOn) });
  }
  return (
    <section className={`rounded-card border p-5 ${tone === 'warning' ? 'border-warning-line bg-warning-soft' : tone === 'success' ? 'border-success-line bg-success-soft' : 'border-line bg-surface'}`}>
      <div className="flex items-center gap-2">
        <Icon name="user" className="size-5" />
        <h2 className="font-bold text-ink">{t('nav.checkin')}</h2>
      </div>
      <p className="mt-2 text-sm text-ink-soft">{body}</p>
      {action && (
        <Link to={target} className={`mt-4 inline-flex items-center gap-2 rounded-control px-4 py-2.5 text-sm font-semibold ${action.primary ? 'bg-ink text-white' : 'border border-line bg-surface text-ink'}`}>
          {action.label} <Icon name="arrowRight" className="size-4" />
        </Link>
      )}
    </section>
  );
}

/** Sadakat programı (modül 56): seviye, puan bakiyesi ve karşılığı, sonraki seviyeye kalan, avantajlar. */
function LoyaltyCard({ loyalty, currency }) {
  const { t, fmt } = useI18n();
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="star" className="size-5" />
          <div>
            <h2 className="font-bold text-ink">{loyalty.programName}</h2>
            <p className="text-xs text-ink-muted">{t('loyalty.member', { number: loyalty.number })}</p>
          </div>
        </div>
        <Badge tone="info">{loyalty.tier.name}</Badge>
      </div>
      <p className="mt-4 text-xs text-ink-muted">{t('loyalty.balance')}</p>
      <p className="text-2xl font-bold tabular-nums text-ink">{t('loyalty.points', { count: fmt.number(loyalty.balance) })}</p>
      <p className="text-sm text-ink-soft">{t('loyalty.worth', { amount: fmt.money(loyalty.balanceValue, currency) })}</p>
      <p className="mt-3 text-sm text-ink-soft">{loyalty.nextTier ? t('loyalty.toNext', { tier: loyalty.nextTier.name, count: fmt.number(loyalty.nextTier.toNext) }) : t('loyalty.top')}</p>
      {loyalty.tier.perks && (
        <p className="mt-3 rounded-item bg-surface-muted px-3 py-2 text-sm text-ink-soft">
          <span className="font-semibold text-ink">{t('loyalty.perks')}:</span> {loyalty.tier.perks}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-muted">{t('loyalty.hint')}</p>
    </section>
  );
}

/** Ana sayfa kutusu (bağlantı, düğme ya da pasif "yakında"). */
function Tile({ to, onClick, icon, title, hint, disabled = false, busy = false }) {
  const content = (
    <>
      <Icon name={icon} className="size-6" />
      <span className="mt-2 font-semibold text-ink">{title}</span>
      <span className="text-xs text-ink-muted">{hint}</span>
    </>
  );
  const className = `flex min-h-28 flex-col items-start rounded-panel border border-line bg-surface p-4 text-left shadow-soft ${disabled ? 'opacity-50' : 'hover:border-line-strong'}`;
  if (to && !disabled) return <Link to={to} className={className}>{content}</Link>;
  if (onClick && !disabled) {
    return (
      <button type="button" onClick={onClick} disabled={busy} aria-busy={busy || undefined} className={`${className} ${busy ? 'cursor-wait opacity-70' : ''}`}>
        {content}
      </button>
    );
  }
  return (
    <div className={className} aria-disabled={disabled || undefined}>
      {content}
    </div>
  );
}
