import { Input, Select } from '@hotelos/ui';
import { COUNTRY_OPTIONS, ID_TYPE_OPTIONS } from '../../lib/front-desk.js';

const NONE = '';

/** Boş kimlik (form başlangıcı). */
export const EMPTY_IDENTITY = Object.freeze({ idType: NONE, idNumber: '', nationality: NONE, birthDate: '' });

/**
 * Sunucudan gelen kimliği form değerine çevirir (boşlar '' olur).
 * @param {{ idType?: string | null, idNumber?: string | null, nationality?: string | null, birthDate?: string | null } | null} identity
 * @param {string} [fallbackNationality] misafir kartında uyruk varsa
 */
export function toIdentityForm(identity, fallbackNationality = NONE) {
  const nationality = identity?.nationality ?? fallbackNationality ?? NONE;
  return {
    // Türk vatandaşının belgesi çoğunlukla kimlik kartı; yabancınınki pasaport.
    idType: identity?.idType ?? (nationality ? (nationality === 'TR' ? 'NATIONAL_ID' : 'PASSPORT') : NONE),
    idNumber: identity?.idNumber ?? '',
    nationality,
    birthDate: identity?.birthDate ?? '',
  };
}

/** Form değeri → istek gövdesi (boşlar null). */
export function identityBody(form) {
  return {
    idType: form.idType || null,
    idNumber: form.idNumber.trim() || null,
    nationality: form.nationality || null,
    birthDate: form.birthDate || null,
  };
}

/**
 * Kimlik alanları: belge türü, numara, uyruk, doğum tarihi. KBS'ye giden
 * bilgi: TC kimlik no sağlamayla, pasaport biçimiyle denetlenir (sözleşmede).
 *
 * @param {{
 *   value: typeof EMPTY_IDENTITY,
 *   onChange: (next: typeof EMPTY_IDENTITY) => void,
 *   errors?: Record<string, string>,
 *   prefix: string,
 *   disabled?: boolean,
 *   optional?: boolean,
 * }} props `errors` anahtarları `${prefix}.idNumber` biçiminde (şema yolları)
 */
export function IdentityFields({ value, onChange, errors = {}, prefix, disabled = false, optional = false }) {
  const set = (field) => (event) => {
    const next = { ...value, [field]: event.target.value };
    // Uyruk seçilince belge türü boşsa tahmin edilir (değiştirilebilir).
    if (field === 'nationality' && !value.idType && next.nationality) {
      next.idType = next.nationality === 'TR' ? 'NATIONAL_ID' : 'PASSPORT';
    }
    onChange(next);
  };
  const error = (field) => errors[`${prefix}.${field}`];
  const tcHint = value.idType === 'NATIONAL_ID' && value.nationality === 'TR' ? '11 haneli TC kimlik numarası' : 'Belgedeki numara (5–20 harf/rakam)';

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select
        label={optional ? 'Uyruk (isteğe bağlı)' : 'Uyruk'}
        value={value.nationality}
        onChange={set('nationality')}
        options={[{ value: NONE, label: 'Seçin' }, ...COUNTRY_OPTIONS]}
        error={error('nationality')}
        disabled={disabled}
      />
      <Select
        label="Belge türü"
        value={value.idType}
        onChange={set('idType')}
        options={[{ value: NONE, label: 'Seçin' }, ...ID_TYPE_OPTIONS]}
        error={error('idType')}
        disabled={disabled}
      />
      <Input
        label="Belge numarası"
        value={value.idNumber}
        onChange={set('idNumber')}
        error={error('idNumber')}
        placeholder={tcHint}
        inputMode={value.idType === 'NATIONAL_ID' && value.nationality === 'TR' ? 'numeric' : 'text'}
        autoComplete="off"
        maxLength={30}
        disabled={disabled}
      />
      <Input
        label="Doğum tarihi (isteğe bağlı)"
        type="date"
        value={value.birthDate}
        onChange={set('birthDate')}
        error={error('birthDate')}
        disabled={disabled}
      />
    </div>
  );
}
