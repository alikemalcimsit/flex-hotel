import { useState } from 'react';
import { APP_LOCALES, APP_LOCALE_LABELS, COMMON_CURRENCIES } from '@hotelos/hotel-contracts';
import { Select } from '@hotelos/ui';
import { useI18n } from '../i18n/index.jsx';
import { savePreferences } from '../i18n/preferences.js';
import { useAuthStore } from '../store/auth.js';
import { toastError } from '../store/toast.js';

/**
 * Kullanıcı menüsündeki tercihler (modül 60): arayüz dili ve gösterim para birimi. İkisi de kullanıcıya kayıtlı
 * (`PATCH /auth/me/preferences`); başka bilgisayarda girince de geçerli. Dil adları kendi dilinde yazılır.
 */
export function UserPreferences() {
  const { locale, setLocale, t } = useI18n();
  const displayCurrency = useAuthStore((state) => state.user?.displayCurrency ?? '');
  const [isSaving, setIsSaving] = useState(false);

  async function changeCurrency(value) {
    setIsSaving(true);
    try {
      await savePreferences({ displayCurrency: value || null });
    } catch (error) {
      toastError(t('layout.prefs.saveFailed', { message: error?.message ?? '' }));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-b border-line px-5 py-3">
      <Select
        compact
        id="user-pref-locale"
        label={t('layout.prefs.language')}
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
        options={APP_LOCALES.map((code) => ({ value: code, label: APP_LOCALE_LABELS[code] }))}
      />
      <div className="flex flex-col gap-1">
        <Select
          compact
          id="user-pref-currency"
          label={t('layout.prefs.displayCurrency')}
          value={displayCurrency}
          disabled={isSaving}
          onChange={(event) => changeCurrency(event.target.value)}
          options={[{ value: '', label: t('layout.prefs.displayCurrencyNone') }, ...COMMON_CURRENCIES.map((code) => ({ value: code, label: code }))]}
        />
        <p className="text-xs text-ink-muted">{t('layout.prefs.displayCurrencyHint')}</p>
      </div>
    </div>
  );
}
