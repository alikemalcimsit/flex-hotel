import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Icon, Spinner } from '@hotelos/ui';
import { FullPageMessage, LanguageSwitch } from '../App.jsx';
import { guestApi, payPath } from '../api.js';
import { errorText, useI18n } from '../i18n.jsx';
import { useLoad } from '../useLoad.js';

/** Sağlayıcıdan dönüşte sunucunun eklediği `sonuc` değerleri ve uyarı tonları. */
const RESULT_TONES = Object.freeze({ odendi: 'success', basarisiz: 'danger', yarida: 'warning', bekliyor: 'info', hata: 'danger' });
/** Bu başlatma hatalarında durum değişmiştir: özet yeniden çekilir. */
const RELOAD_CODES = Object.freeze(['LINK_PAID', 'LINK_CLOSED', 'LINK_EXPIRED', 'LINK_PROCESSING', 'GATEWAY_DISABLED']);
/** Kapalı durumların açıklaması ve tonu. */
const CLOSED_TONES = Object.freeze({ PROCESSING: 'info', EXPIRED: 'warning', CANCELLED: 'warning', FAILED: 'danger' });

/**
 * Misafirin ödeme sayfası (modül 50), `/misafir/o/<kod>`. Oturumsuz; kimlik bağlantının kodudur. Ödeme bekliyorsa
 * "Kartla öde" sağlayıcının sayfasına yönlendirir (kart otelin sunucusuna gelmez); dönüşte `sonuc`a göre mesaj ve özet
 * yeniden çekilir. Ödendiyse kartın son dört hanesi, kapandıysa açıklaması ve otelin telefonu.
 */
export function PayPage() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const result = params.get('sonuc');
  const { t, fmt, language } = useI18n();
  const summary = useLoad(payPath(code));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const data = summary.data;
  useEffect(() => {
    if (data?.hotel?.name) document.title = data.hotel.name;
  }, [data?.hotel?.name]);

  if (summary.loading && !data) return <Spinner label={t('common.loading')} className="py-16" />;
  if (summary.error && !data) return <FullPageMessage error={summary.error} onRetry={['NETWORK', 'RATE_LIMIT'].includes(summary.error.code) ? () => summary.reload() : undefined} />;

  const { hotel, link, guest } = data;
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const { redirectUrl } = await guestApi(`${payPath(code)}/start`, { method: 'POST', body: { locale: language } });
      window.location.href = redirectUrl;
    } catch (failure) {
      setError(failure);
      setStarting(false);
      if (RELOAD_CODES.includes(failure?.code)) await summary.reload({ quiet: true });
    }
  };
  const showResult = Boolean(result && RESULT_TONES[result]) && link.status !== 'PAID';

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-5 px-4 py-5">
      <header className="flex items-center justify-between gap-3">
        <span className="truncate font-brand text-lg font-bold text-ink">{hotel.name}</span>
        <LanguageSwitch />
      </header>
      {data.testMode && <Alert tone="warning">{t('pay.testMode')}</Alert>}
      {showResult && <Alert tone={RESULT_TONES[result]}>{t(`pay.result.${result}`)}</Alert>}

      <section className="rounded-card border border-line bg-surface p-5 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('pay.amount')}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{fmt.money(link.amount, link.currency)}</p>
        {link.description && <p className="mt-1 text-sm text-ink-soft">{link.description}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-muted">{t('pay.guest')}</dt>
            <dd className="font-semibold">{guest.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">{t('pay.code')}</dt>
            <dd className="font-mono font-semibold">{guest.confirmationCode}</dd>
          </div>
          <div className="col-span-2 text-ink-soft">{t('pay.dates', { from: fmt.day(guest.checkIn), to: fmt.day(guest.checkOut) })}</div>
        </dl>
      </section>

      <PayState data={data} starting={starting} onStart={start} onReload={() => summary.reload({ quiet: true })} />
      {error && <Alert tone={error.code === 'LINK_PAID' ? 'success' : error.code === 'LINK_PROCESSING' ? 'info' : 'danger'}>{errorText(t, error)}</Alert>}

      {hotel.phone && (
        <a href={`tel:${hotel.phone.replace(/\s/g, '')}`} className="inline-flex items-center justify-center gap-2 rounded-panel border border-line bg-surface-muted p-4 text-sm font-semibold text-ink">
          <Icon name="phone" className="size-4" /> {t('pay.help')} · {hotel.phone}
        </a>
      )}
    </main>
  );
}

/** Duruma göre eylem ya da açıklama. @param {{ data: any, starting: boolean, onStart: () => void, onReload: () => void }} props */
function PayState({ data, starting, onStart, onReload }) {
  const { t, fmt } = useI18n();
  const { link } = data;
  if (link.status === 'PAID') {
    return (
      <section className="flex flex-col items-center gap-3 rounded-panel border border-success-line bg-success-soft p-6 text-center">
        <Icon name="checkCircle" className="size-12 text-success" />
        <h1 className="font-brand text-2xl font-bold text-ink">{link.card?.last4 ? t('pay.paidCard', { last4: link.card.last4 }) : t('pay.paid')}</h1>
        {link.paidAt && <p className="text-ink-soft">{t('pay.paidAt', { date: fmt.dateTime(link.paidAt) })}</p>}
      </section>
    );
  }
  if (link.status !== 'OPEN') {
    return (
      <Alert tone={CLOSED_TONES[link.status] ?? 'warning'} action={link.status === 'PROCESSING' ? <Button type="button" size="sm" variant="outline" onClick={onReload}>{t('pay.refresh')}</Button> : null}>
        {t(`pay.${link.status}`)}
      </Alert>
    );
  }
  if (!data.canPay) return <Alert tone="warning">{t('pay.closed')}</Alert>;
  return (
    <section className="flex flex-col gap-3">
      {link.lastError && <Alert tone="warning">{t('pay.lastError', { message: link.lastError })}</Alert>}
      <Button type="button" icon="creditCard" onClick={onStart} disabled={starting} className="w-full py-3 text-base">
        {starting ? t('pay.starting') : t('pay.button')}
      </Button>
      <p className="flex items-start gap-2 text-xs text-ink-muted">
        <Icon name="lock" className="mt-0.5 size-4 shrink-0" /> {t('pay.secure')}
      </p>
      <p className="text-xs text-ink-muted">{t('pay.expires', { date: fmt.dateTime(link.expiresAt) })}</p>
    </section>
  );
}
