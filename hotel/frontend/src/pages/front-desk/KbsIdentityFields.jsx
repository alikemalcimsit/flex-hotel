import { PERSON_GENDERS, PERSON_GENDER_LABELS } from '@hotelos/hotel-contracts';
import { Input, Select } from '@hotelos/ui';

const GENDER_OPTIONS = [{ value: '', label: 'Seçin' }, ...PERSON_GENDERS.map((value) => ({ value, label: PERSON_GENDER_LABELS[value] }))];

/**
 * KBS ek alanları (modül 58): cinsiyet, baba adı, anne adı, doğum yeri — check-in'de misafir ve refakatçiler, misafir kartı
 * düzenlemesinde ortak. Doğum tarihi kimlik alanlarındadır (`IdentityFields`). Zorunlu olanlar yıldızlı; sunucu alan hataları
 * `${prefix}.gender` gibi anahtarlarla gelir.
 *
 * `collapsed` verilirse (KBS kapalıyken check-in) alanlar "isteğe bağlı" katlanır bölümde durur.
 *
 * @param {{
 *   value: { gender: string, fatherName: string, motherName: string, birthPlace: string },
 *   onChange: (next: { gender: string, fatherName: string, motherName: string, birthPlace: string }) => void,
 *   errors?: Record<string, string>,
 *   prefix: string,
 *   required?: string[],
 *   collapsed?: boolean,
 *   disabled?: boolean,
 * }} props
 */
export function KbsIdentityFields({ value, onChange, errors = {}, prefix, required = [], collapsed = false, disabled = false }) {
  const set = (field) => (event) => onChange({ ...value, [field]: event.target.value });
  const error = (field) => errors[`${prefix}.${field}`];
  const label = (text, field) => (required.includes(field) ? `${text} *` : text);
  const hasError = ['gender', 'fatherName', 'motherName', 'birthPlace'].some((field) => error(field));

  const fields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select label={label('Cinsiyet', 'gender')} value={value.gender} onChange={set('gender')} options={GENDER_OPTIONS} error={error('gender')} disabled={disabled} />
      <Input label={label('Doğum yeri', 'birthPlace')} value={value.birthPlace} onChange={set('birthPlace')} error={error('birthPlace')} maxLength={100} autoComplete="off" disabled={disabled} />
      <Input label={label('Baba adı', 'fatherName')} value={value.fatherName} onChange={set('fatherName')} error={error('fatherName')} maxLength={100} autoComplete="off" disabled={disabled} />
      <Input label={label('Anne adı', 'motherName')} value={value.motherName} onChange={set('motherName')} error={error('motherName')} maxLength={100} autoComplete="off" disabled={disabled} />
    </div>
  );

  if (!collapsed) return fields;
  return (
    <details className="rounded-item border border-dashed border-line px-3 py-2" open={hasError || undefined}>
      <summary className="cursor-pointer text-xs font-semibold text-ink-muted">KBS ek bilgileri (isteğe bağlı)</summary>
      <div className="mt-3">{fields}</div>
    </details>
  );
}
