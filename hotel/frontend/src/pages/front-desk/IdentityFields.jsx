import { useMemo } from 'react';
import { COUNTRY_CODES, ID_DOCUMENT_TYPES } from '@hotelos/hotel-contracts';
import { Input, Select } from '@hotelos/ui';
import { useI18n, useT } from '../../i18n/index.jsx';
import { COUNTRY_OPTIONS } from '../../lib/front-desk.js';

const NONE = '';

/**
 * Uyruk seçenekleri etkin dilde (Türkçede `lib/front-desk.js`'teki hazır liste); Türkiye başta.
 * @param {string} locale
 */
function countryOptions(locale) {
  if (locale === 'tr') return COUNTRY_OPTIONS;
  let names = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    return COUNTRY_OPTIONS;
  }
  const label = (code) => {
    try {
      return `${names.of(code) ?? code} (${code})`;
    } catch {
      return `${code} (${code})`;
    }
  };
  const rest = COUNTRY_CODES.filter((code) => code !== 'TR')
    .map((code) => ({ value: code, label: label(code) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  return [{ value: 'TR', label: label('TR') }, ...rest];
}

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
 *   birthDateRequired?: boolean,
 * }} props `errors` anahtarları `${prefix}.idNumber` biçiminde (şema yolları); `birthDateRequired`: KBS ayarı doğum
 *   tarihini zorunlu kılıyor (modül 58)
 */
export function IdentityFields({ value, onChange, errors = {}, prefix, disabled = false, optional = false, birthDateRequired = false }) {
  const t = useT();
  const { locale } = useI18n();
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const idTypes = ID_DOCUMENT_TYPES.map((type) => ({ value: type, label: t(`frontDesk.idType.${type}`) }));
  const choose = { value: NONE, label: t('frontDesk.identity.choose') };
  const set = (field) => (event) => {
    const next = { ...value, [field]: event.target.value };
    // Uyruk seçilince belge türü boşsa tahmin edilir (değiştirilebilir).
    if (field === 'nationality' && !value.idType && next.nationality) {
      next.idType = next.nationality === 'TR' ? 'NATIONAL_ID' : 'PASSPORT';
    }
    onChange(next);
  };
  const error = (field) => errors[`${prefix}.${field}`];
  const tcHint = value.idType === 'NATIONAL_ID' && value.nationality === 'TR' ? t('frontDesk.identity.nationalIdHint') : t('frontDesk.identity.documentNumberHint');

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select
        label={optional ? t('frontDesk.identity.nationalityOptional') : t('frontDesk.identity.nationality')}
        value={value.nationality}
        onChange={set('nationality')}
        options={[choose, ...countries]}
        error={error('nationality')}
        disabled={disabled}
      />
      <Select
        label={t('frontDesk.identity.idType')}
        value={value.idType}
        onChange={set('idType')}
        options={[choose, ...idTypes]}
        error={error('idType')}
        disabled={disabled}
      />
      <Input
        label={t('frontDesk.identity.idNumber')}
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
        label={birthDateRequired ? t('frontDesk.identity.birthDateRequired') : t('frontDesk.identity.birthDateOptional')}
        type="date"
        value={value.birthDate}
        onChange={set('birthDate')}
        error={error('birthDate')}
        disabled={disabled}
      />
    </div>
  );
}
