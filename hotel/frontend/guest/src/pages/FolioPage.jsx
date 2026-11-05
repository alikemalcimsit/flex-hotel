import { Alert, Button, Spinner } from '@hotelos/ui';
import { portalPath } from '../api.js';
import { usePortal } from '../App.jsx';
import { errorText, useI18n } from '../i18n.jsx';
import { useLoad } from '../useLoad.js';

/** Ödeme satırının etiketi (tutar sunucudan işaretli gelir: iade ve iptal eksi). */
const PAYMENT_LABELS = Object.freeze({ PAYMENT: 'folio.payment', REFUND: 'folio.refund', REVERSAL: 'folio.reversal' });

/**
 * Misafirin hesabı (folyo): harcamalar (iptal edilenler hariç), ödemeler, bakiye. Birden çok hesap ayrı kartlarda.
 * Şirket / acente hesabına giden pencereler gösterilmez; yalnız var oldukları söylenir.
 */
export function FolioPage() {
  const { token } = usePortal();
  const { t, fmt } = useI18n();
  const folio = useLoad(portalPath(token, '/folio'), { intervalMs: 120_000 });
  if (folio.loading && !folio.data) return <Spinner label={t('common.loading')} className="py-10" />;
  if (folio.error && !folio.data) {
    return (
      <Alert tone={folio.error.code === 'FOLIO_NOT_YET' ? 'info' : 'danger'} action={folio.error.code === 'FOLIO_NOT_YET' ? null : <Button type="button" size="sm" variant="outline" onClick={() => folio.reload()}>{t('common.retry')}</Button>}>
        {folio.error.code === 'FOLIO_NOT_YET' ? t('folio.notYet') : errorText(t, folio.error)}
      </Alert>
    );
  }
  const { folios, otherPayerAccounts } = folio.data;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-brand text-2xl font-bold text-ink">{t('folio.title')}</h1>
      {folios.length === 0 && <p className="text-ink-muted">{t('folio.empty')}</p>}
      {otherPayerAccounts > 0 && <Alert tone="info">{t('folio.otherPayers')}</Alert>}
      {folios.map((account) => (
        <section key={account.window} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          {folios.length > 1 && (
            <h2 className="font-bold text-ink">{t('folio.account', { number: account.window })}</h2>
          )}
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('folio.charges')}</h3>
            {account.items.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('folio.empty')}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {account.items.map((item, index) => (
                  <li key={index} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate">{item.quantity > 1 ? `${item.quantity} × ` : ''}{item.description}</span>
                      <span className="text-xs text-ink-muted">{fmt.shortDay(item.date)}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{fmt.money(item.total, account.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            {account.truncated && <p className="mt-1 text-xs text-ink-muted">{t('folio.truncated')}</p>}
          </div>
          {account.payments.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('folio.payments')}</h3>
              <ul className="divide-y divide-line text-sm">
                {account.payments.map((payment, index) => (
                  <li key={index} className="flex justify-between gap-3 py-2">
                    <span>
                      {t(PAYMENT_LABELS[payment.kind] ?? 'folio.payment')} <span className="text-xs text-ink-muted">{fmt.dateTime(payment.date)}</span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      {fmt.money(payment.folioAmount, account.currency)}
                      {payment.currency !== account.currency && <span className="block text-xs text-ink-muted">{fmt.money(payment.amount, payment.currency)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="font-semibold">{t('folio.balance')}</span>
            <span className="text-lg font-bold tabular-nums">{fmt.money(account.balance, account.currency)}</span>
          </div>
        </section>
      ))}
    </div>
  );
}
