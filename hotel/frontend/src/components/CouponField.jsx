import { useId, useState } from 'react';
import { couponCodeField } from '@hotelos/hotel-contracts';
import { Badge, Button, Icon } from '@hotelos/ui';
import { COUPON_STATUS_TONES, couponStatusText } from '../lib/promotions.js';

const STATUS_LABELS = Object.freeze({ APPLIED: 'Uygulanıyor', NOT_BETTER: 'Kullanılmayacak', NOT_APPLICABLE: 'Uymuyor', INVALID: 'Geçersiz' });

/**
 * Kupon alanı (modül 31): kod yazılıp "Uygula" denince fiyat önizlemesine
 * girer; girilen kupon çip olarak görünür, altında önizlemenin söylediği durum
 * (uygulanıyor / daha avantajlı promosyon var / bu konaklamaya uymuyor /
 * geçersiz) yazar. Biçim (harf, rakam, tire) yazarken denetlenir; geçerliliği
 * sunucu söyler.
 *
 * Enter formu göndermez, kuponu uygular.
 *
 * @param {{
 *   value: string | null,
 *   onChange: (code: string | null) => void,
 *   coupon?: { status: string, issue: { message: string } | null, promotion: { name: string, label: string } | null, remainingUses: number | null } | null,
 *   checking?: boolean,
 *   error?: string,
 *   disabled?: boolean,
 *   label?: string,
 * }} props
 */
export function CouponField({ value, onChange, coupon = null, checking = false, error, disabled = false, label = 'Kupon kodu' }) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [formatError, setFormatError] = useState('');

  function apply() {
    const parsed = couponCodeField.safeParse(text);
    if (!parsed.success) {
      setFormatError(parsed.error.issues[0]?.message ?? 'Kupon kodu geçersiz');
      return;
    }
    setFormatError('');
    setText('');
    onChange(parsed.data);
  }

  const message = error || formatError;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </label>
      {value ? (
        <div className="flex flex-col gap-1.5">
          <div className={`flex items-center justify-between gap-3 rounded-control border bg-surface px-4 py-2.5 ${message ? 'border-sec-strong' : 'border-line-strong'}`}>
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Icon name="percent" className="size-4 shrink-0 text-ink-muted" />
              <span className="truncate font-mono font-semibold text-ink">{value}</span>
              {checking ? (
                <span className="text-xs text-ink-muted">denetleniyor…</span>
              ) : (
                coupon && <Badge tone={COUPON_STATUS_TONES[coupon.status]}>{STATUS_LABELS[coupon.status]}</Badge>
              )}
            </span>
            {!disabled && (
              <button type="button" aria-label="Kuponu kaldır" onClick={() => onChange(null)} className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-black/[0.06] hover:text-ink">
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </div>
          {!checking && coupon && !message && (
            <p className={`text-xs ${coupon.status === 'APPLIED' ? 'text-success-ink' : coupon.status === 'NOT_BETTER' ? 'text-ink-muted' : 'font-semibold text-sec-strong'}`}>
              {couponStatusText(coupon)}
            </p>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder="Ör. YAZ2027"
            value={text}
            aria-invalid={message ? true : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setFormatError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (text.trim()) apply();
              }
            }}
            className={`min-w-0 flex-1 rounded-control border bg-surface px-4 py-2.5 font-mono text-sm uppercase text-ink outline-none transition-colors focus:border-ink disabled:opacity-60 ${message ? 'border-sec-strong' : 'border-line-strong'}`}
          />
          <Button variant="outline" onClick={apply} disabled={disabled || !text.trim()}>
            Uygula
          </Button>
        </div>
      )}
      {message && (
        <p role="alert" className="text-xs font-semibold text-sec-strong">
          {message}
        </p>
      )}
    </div>
  );
}
