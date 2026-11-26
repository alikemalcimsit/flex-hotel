import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../store/auth.js';
import { toastError } from '../store/toast.js';
import { DEFAULT_LOCALE, normalizeLocale, setCurrentLocale } from './current.js';
import { savePreferences } from './preferences.js';
import { translate } from './translate.js';

/**
 * Personel paneli çoklu dil altyapısı (modül 60) — bağımlılıksız.
 *
 * ── KULLANIM ────────────────────────────────────────────────────────────────────────────────────────────
 *   import { useT } from '../../i18n/index.jsx';
 *   const t = useT();
 *   t('cash.rates.title')                       → etkin dilde metin
 *   t('cash.rates.saved', { date })             → "{date} kurları kaydedildi" yer tutucusu doldurulur
 *   t(`nav.${item.to}`, item.label)             → anahtar yoksa verilen Türkçe yedek metin
 *   React dışında (yardımcı, toast): import { tNow } from '../i18n/translate.js'; tNow('common.today')
 *   Dil / seçici: const { locale, setLocale } = useI18n();
 *
 * ── ÇÖZÜM SIRASI ────────────────────────────────────────────────────────────────────────────────────────
 *   seçili dilin sözlüğü → Türkçe sözlük → verilen yedek metin → anahtarın kendisi. Eksik anahtar sessizdir.
 *   Dil: kullanıcının `locale`'i (GET /auth/me, girişte gelir) → bu cihazda seçilen (giriş ekranı) → tarayıcı → 'tr'.
 *   Değişince `PATCH /auth/me/preferences`, `<html lang>`, `lib/format.js` dili; uygulama ağacı yeniden kurulur
 *   (henüz `useT` kullanmayan biçimlendiriciler de yeni dile geçsin — sorgu önbelleği korunur).
 *
 * ── ANAHTAR KURALI ──────────────────────────────────────────────────────────────────────────────────────
 *   `<alan>.<ekran|bileşen>.<öğe>`; parçalar camelCase, düz (iç içe nesne yok), ör. `frontDesk.checkIn.submit`.
 *   - Alan = sözlük dosyasının adı: `tr/<alan>.js` ve `en/<alan>.js` (`common, nav, auth, layout, payments, cash,
 *     invoices`; sonra `frontDesk, reservations, roomPlan, folio` …). Her anahtar kendi alan adıyla başlar.
 *   - Ortak kısa metinler (`Kaydet`, `Vazgeç`, `Yükleniyor…`) `common.` altında; tekrar yazmayın.
 *   - Sözleşmedeki etiket tabloları (ör. `PAYMENT_METHOD_LABELS`): `<alan>.<tablo>.<KOD>` — Türkçesi tr dosyasında
 *     `fromLabels('payments.method.', PAYMENT_METHOD_LABELS)` ile türetilir, İngilizcesi elle yazılır.
 *   - Yer tutucu `{ad}`; iki dilde aynı yer tutucular (test denetler). Cümleyi parçalamayın, bütün cümle tek anahtar.
 *   - Menü istisnası: `nav.<yol>` / `nav.section.<id>` — Türkçesi `layout/navigation.js`'ten türetilir.
 *   - TR ve EN anahtar kümesi eşit olmalı: `src/i18n/dictionaries.test.js`.
 *   - Yeni alan dosyasını `dictionaries.js`'teki `AREAS`'a ekleyin.
 *
 * ── PARA ────────────────────────────────────────────────────────────────────────────────────────────────
 *   Tutar gösterimi `<MoneyText value={x} currency={c} />` (`components/MoneyText.jsx`): `formatMoney` + kullanıcının
 *   gösterim para birimi seçiliyse yanında küçük "≈ 48,97 EUR". Yalnız karşılık: `<ApproxMoney value currency />`.
 */

const STORAGE_KEY = 'hotelos.locale';

function readDeviceLocale() {
  try {
    return normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeDeviceLocale(locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Gizli sekme: seçim yalnız bu oturumda.
  }
}

function browserLocale() {
  return typeof navigator === 'undefined' ? null : normalizeLocale(navigator.language);
}

const fallbackT = (key, fallbackOrVars, maybeVars) => translate(DEFAULT_LOCALE, key, fallbackOrVars, maybeVars);
const I18nContext = createContext({ locale: DEFAULT_LOCALE, setLocale: async () => {}, t: fallbackT });

/** @param {{ children: React.ReactNode }} props */
export function I18nProvider({ children }) {
  const userLocale = useAuthStore((state) => state.user?.locale);
  const isSignedIn = useAuthStore((state) => Boolean(state.user));
  const [deviceLocale, setDeviceLocale] = useState(readDeviceLocale);
  const locale = normalizeLocale(userLocale) ?? deviceLocale ?? browserLocale() ?? DEFAULT_LOCALE;
  // Çocuklar çizilmeden önce: biçimlendiriciler (formatMoney, formatDate) bu turda yeni dili kullansın.
  setCurrentLocale(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    async (next) => {
      const value = normalizeLocale(next);
      if (!value) return;
      writeDeviceLocale(value);
      setDeviceLocale(value);
      if (!isSignedIn) return;
      try {
        await savePreferences({ locale: value });
      } catch (error) {
        toastError(translate(value, 'layout.prefs.saveFailed', { message: error?.message ?? '' }));
      }
    },
    [isSignedIn],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t: (key, fallbackOrVars, maybeVars) => translate(locale, key, fallbackOrVars, maybeVars) }),
    [locale, setLocale],
  );
  return (
    <I18nContext.Provider value={value}>
      <Fragment key={locale}>{children}</Fragment>
    </I18nContext.Provider>
  );
}

/** @returns {{ locale: string, setLocale: (locale: string) => Promise<void>, t: (key: string, fallbackOrVars?: string | object, vars?: object) => string }} */
export function useI18n() {
  return useContext(I18nContext);
}

/** @returns {(key: string, fallbackOrVars?: string | Record<string, unknown>, vars?: Record<string, unknown>) => string} */
export function useT() {
  return useContext(I18nContext).t;
}
