import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_LOCALES, APP_LOCALE_LABELS } from '@hotelos/hotel-contracts';
import { Button, Icon, Input } from '@hotelos/ui';
import { Logo } from '../components/Logo.jsx';
import { useI18n } from '../i18n/index.jsx';
import { savePreferences } from '../i18n/preferences.js';
import { apiPost } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

/** Tanıtım panelinde sayılan başlıklar — yalnızca bugün panelde gerçekten olan bölümler. */
const HIGHLIGHTS = [
  { icon: 'bed', key: 'rooms' },
  { icon: 'calendar', key: 'availability' },
  { icon: 'key', key: 'assignment' },
];

/**
 * Dil değişince uygulama ağacı yeniden kurulur (bileşen durumu sıfırlanır); "bu ekranda dil seçildi" bilgisi bu
 * yüzden modül düzeyinde tutulur.
 */
const localePick = { isPicked: false, mark() { this.isPicked = true; } };

/**
 * Giriş ekranında dil seçimi. Seçilirse girişte kullanıcının tercihine de yazılır; seçilmezse kullanıcının kayıtlı dili
 * geçerli olur.
 * @param {{ onPick: () => void }} props
 */
function LanguageSwitch({ onPick }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t('layout.prefs.language')} className="flex justify-end gap-1 text-xs font-bold">
      {APP_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={locale === code}
          onClick={() => {
            onPick();
            setLocale(code);
          }}
          className={`rounded-item px-2.5 py-1 transition-colors duration-150 ${locale === code ? 'bg-ink text-white' : 'text-ink-muted hover:bg-black/[0.05] hover:text-ink'}`}
        >
          {APP_LOCALE_LABELS[code]}
        </button>
      ))}
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;
    setError('');
    setIsSubmitting(true);
    try {
      const session = await apiPost('/auth/login', { email: email.trim().toLowerCase(), password });
      setSession(session);
      // Best-effort: kaydedilemezse kullanıcının kayıtlı dili geçerli kalır (savePreferences geri alır).
      if (localePick.isPicked && session.user && session.user.locale !== locale) savePreferences({ locale }).catch(() => {});
      navigate('/');
    } catch (submitError) {
      setError(submitError.message ?? t('auth.login.failed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-ink lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-sec/20 blur-3xl"
        />
        <Logo className="relative text-[2rem]" />

        <div className="relative max-w-md">
          <h1 className="text-[2.4rem] font-bold leading-[1.1] tracking-tight">
            {t('auth.login.headline')} <span className="text-sec">{t('auth.login.headlineAccent')}</span>
          </h1>
          <ul className="mt-10 flex flex-col gap-6">
            {HIGHLIGHTS.map((item) => (
              <li key={item.key} className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-control border border-sidebar-line bg-white/[0.05] text-sec">
                  <Icon name={item.icon} className="size-5" />
                </span>
                <span>
                  <span className="block font-bold">{t(`auth.login.highlight.${item.key}.title`)}</span>
                  <span className="mt-0.5 block text-sm text-sidebar-muted">{t(`auth.login.highlight.${item.key}.text`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-sidebar-muted">{t('auth.login.footer')}</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <LanguageSwitch onPick={() => localePick.mark()} />
          <Logo className="mb-10 mt-4 block text-[1.9rem] lg:hidden" />

          <div className="rounded-card bg-surface p-7 shadow-card sm:p-9">
            <h2 className="text-[1.6rem] font-bold leading-tight text-ink">{t('auth.login.title')}</h2>
            <p className="mt-1.5 text-sm text-ink-muted">{t('auth.login.subtitle')}</p>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
              <Input
                label={t('auth.login.email')}
                name="email"
                type="email"
                autoComplete="username"
                placeholder={t('auth.login.emailPlaceholder')}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                required
              />
              <Input
                label={t('auth.login.password')}
                name="password"
                type={isPasswordVisible ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                error={error}
                required
                trailing={
                  <button
                    type="button"
                    onClick={() => setIsPasswordVisible((visible) => !visible)}
                    aria-label={isPasswordVisible ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
                    aria-pressed={isPasswordVisible}
                    className="grid size-9 place-items-center rounded-item text-ink-muted transition-colors duration-200 hover:bg-black/[0.05] hover:text-ink"
                  >
                    <Icon name={isPasswordVisible ? 'eyeOff' : 'eye'} className="size-[18px]" />
                  </button>
                }
              />
              <Button
                type="submit"
                icon="arrowRight"
                disabled={isSubmitting}
                className="mt-2 w-full flex-row-reverse"
              >
                {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
