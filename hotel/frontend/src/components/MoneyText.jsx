import { useT } from '../i18n/index.jsx';
import { formatApprox } from '../lib/displayMoney.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { formatRate } from '../lib/payments.js';
import { useDisplayCurrency } from '../lib/useDisplayCurrency.js';

/**
 * Yalnız yaklaşık karşılık: "≈ 48,97 EUR" (küçük, soluk). Gösterim para birimi seçili değilse, kur yoksa ya da tutar
 * otelin para biriminde değilse hiçbir şey çizmez. Tutarı kendisi biçimleyen yerlerde (eksi işareti, üstü çizili) kullanın.
 *
 * @param {{ value: string | number | null | undefined, currency?: string, className?: string }} props
 */
export function ApproxMoney({ value, currency, className = '' }) {
  const t = useT();
  const display = useDisplayCurrency();
  const approx = formatApprox(value, currency, display);
  if (!approx) return null;
  const title = t('common.approxTitle', { currency: display.currency, rate: formatRate(display.rate), hotelCurrency: display.hotelCurrency, date: formatDate(display.date) });
  return (
    <span title={title} className={`whitespace-nowrap text-xs font-normal text-ink-muted ${className}`}>
      {t('common.approxAmount', { amount: approx })}
    </span>
  );
}

/**
 * Tutar gösterimi (modül 60): `formatMoney` + kullanıcının gösterim para birimi seçiliyse yanında "≈ 48,97 EUR".
 * `block` verilirse karşılık alt satırda (dar tablo hücreleri).
 *
 * @param {{ value: string | number | null | undefined, currency?: string, block?: boolean, className?: string }} props
 */
export function MoneyText({ value, currency = '', block = false, className = '' }) {
  return (
    <span className={className}>
      {formatMoney(value, currency)}
      <ApproxMoney value={value} currency={currency} className={block ? 'block' : 'ml-1.5'} />
    </span>
  );
}
