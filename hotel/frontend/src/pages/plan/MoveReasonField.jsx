import { MAX_MOVE_REASON_LENGTH } from '@hotelos/hotel-contracts';
import { Input } from '@hotelos/ui';
import { useT } from '../../i18n/index.jsx';

/**
 * Oda değişikliği sebebi — hızlı seçenekler + serbest metin.
 *
 * Sebep isteğe bağlı ama gece kapanışında ve şikâyet incelemesinde ilk sorulan
 * şey "neden taşındı": arıza mı, misafir talebi mi, upgrade mi. Resepsiyonist
 * yazmakla uğraşmasın diye sık sebepler tek dokunuşla seçilir.
 */

/** Sözlük anahtarları (`roomPlan.moveReason.*`); seçilen metin etkin dilde sebep olarak yazılır. */
export const MOVE_REASON_SUGGESTION_KEYS = Object.freeze([
  'roomPlan.moveReason.fault',
  'roomPlan.moveReason.guestRequest',
  'roomPlan.moveReason.upgrade',
  'roomPlan.moveReason.noise',
  'roomPlan.moveReason.nearby',
]);

/**
 * @param {{ value: string, onChange: (value: string) => void, disabled?: boolean }} props
 */
export function MoveReasonField({ value, onChange, disabled = false }) {
  const t = useT();
  const suggestions = MOVE_REASON_SUGGESTION_KEYS.map((key) => t(key));
  return (
    <div className="flex flex-col gap-2">
      <Input
        label={t('roomPlan.moveReason.label')}
        name="moveReason"
        value={value}
        maxLength={MAX_MOVE_REASON_LENGTH}
        placeholder={t('roomPlan.moveReason.placeholder')}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('roomPlan.moveReason.quickAria')}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            aria-pressed={value === suggestion}
            onClick={() => onChange(value === suggestion ? '' : suggestion)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec disabled:opacity-50 ${
              value === suggestion
                ? 'border-ink bg-ink text-white'
                : 'border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink'
            }`}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
