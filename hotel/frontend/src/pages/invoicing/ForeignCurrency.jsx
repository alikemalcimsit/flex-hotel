import { COMMON_CURRENCIES } from '@hotelos/hotel-contracts';
import { Select } from '@hotelos/ui';
import { useT } from '../../i18n/index.jsx';
import { formatDate, formatMoney } from '../../lib/format.js';
import { formatRate } from '../../lib/payments.js';

/**
 * Faturada döviz karşılığı (modül 60). Fatura otelin para biriminde kesilir; taslakta seçilen dövizde toplamın karşılığı
 * kesim günündeki kurla hesaplanıp faturaya not olarak yazılır. Kesimde o dövizin kuru yoksa sunucu 409
 * `FOREIGN_RATE_MISSING` döner.
 */

/**
 * Taslak formundaki seçici: boş = karşılık yok.
 * @param {{ value: string, onChange: (value: string) => void, hotelCurrency?: string, disabled?: boolean, error?: string }} props
 */
export function ForeignCurrencySelect({ value, onChange, hotelCurrency, disabled = false, error }) {
  const t = useT();
  const codes = [...new Set([...COMMON_CURRENCIES, ...(value ? [value] : [])])].filter((code) => code !== hotelCurrency);
  return (
    <div className="flex flex-col gap-1">
      <Select
        id="invoice-foreign-currency"
        label={t('invoices.foreign.label')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={[{ value: '', label: t('invoices.foreign.none') }, ...codes.map((code) => ({ value: code, label: code }))]}
        error={error}
        disabled={disabled}
        className="max-w-xs"
      />
      <p className="text-xs text-ink-muted">{t('invoices.foreign.hint')}</p>
    </div>
  );
}

/**
 * Toplamlar kartının altında karşılık satırı: kesilmişte tutar + kur + gün, taslakta "kesimde hesaplanır".
 * @param {{ foreign: { currency: string, rate: string | null, total: string | null, rateDate: string | null } | null, hotelCurrency: string }} props
 */
export function ForeignEquivalent({ foreign, hotelCurrency }) {
  const t = useT();
  if (!foreign?.currency) return null;
  if (!foreign.total || !foreign.rate) {
    return <p className="mt-3 text-xs text-ink-muted">{t('invoices.foreign.pending', { currency: foreign.currency })}</p>;
  }
  return (
    <p className="mt-3 border-t border-line pt-3 text-sm">
      <span className="text-ink-muted">{t('invoices.foreign.equivalent')} </span>
      <strong className="tabular-nums">{formatMoney(foreign.total, foreign.currency)}</strong>
      <span className="block text-xs text-ink-muted">
        {t('invoices.foreign.rateLine', { currency: foreign.currency, rate: formatRate(foreign.rate), hotelCurrency, date: formatDate(foreign.rateDate) })}
      </span>
    </p>
  );
}

/**
 * Kesim hatasının metni: kur eksikse açıklayıcı cümle, değilse sunucunun mesajı.
 * @param {(key: string, vars?: object) => string} t @param {{ code?: string, message?: string }} error
 * @param {{ foreign?: { currency: string } | null }} invoice
 */
export function issueErrorText(t, error, invoice) {
  if (error?.code === 'FOREIGN_RATE_MISSING') return t('invoices.foreign.rateMissing', { currency: invoice?.foreign?.currency ?? '' });
  return error?.message ?? '';
}
