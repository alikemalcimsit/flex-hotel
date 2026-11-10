import { createContext, useContext, useEffect } from 'react';
import { BrowserRouter, NavLink, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { Alert, Button, Icon, Spinner } from '@hotelos/ui';
import { portalPath, webchatScriptUrl } from './api.js';
import { LanguageProvider, errorText, useI18n } from './i18n.jsx';
import { PORTAL_LANGUAGES } from './limits.js';
import { CheckInPage } from './pages/CheckInPage.jsx';
import { FolioPage } from './pages/FolioPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { RequestsPage } from './pages/RequestsPage.jsx';
import { RoomServicePage } from './pages/RoomServicePage.jsx';
import { SurveyPage } from './pages/SurveyPage.jsx';
import { useLoad } from './useLoad.js';

/**
 * Portalın sayfaları: yol, menü adı, simge ve ne zaman görüneceği (portalın ana sayfa verisine göre). Yeni sayfa
 * (FlexAI 2.0: upsell, tesis rezervasyonu, hediye çeki, konaklama ortası nabız) buraya bir satırla eklenir.
 */
export const PORTAL_PAGES = Object.freeze([
  { key: 'home', path: '', label: 'nav.home', icon: 'bed', visible: () => true, Component: HomePage },
  { key: 'checkin', path: 'check-in', label: 'nav.checkin', icon: 'user', visible: (overview) => overview.features.checkin, Component: CheckInPage },
  { key: 'folio', path: 'folyo', label: 'nav.folio', icon: 'wallet', visible: (overview) => overview.features.folio, Component: FolioPage },
  { key: 'requests', path: 'istek', label: 'nav.requests', icon: 'bell', visible: (overview) => overview.features.requests, Component: RequestsPage },
]);

const PortalContext = createContext(null);
/** @returns {{ token: string, overview: any, reload: () => Promise<void> }} */
export const usePortal = () => useContext(PortalContext);

export function App() {
  return (
    <LanguageProvider>
      <BrowserRouter basename="/misafir">
        <Routes>
          <Route path="p/:token" element={<PortalShell />}>
            {PORTAL_PAGES.map(({ key, path, Component }) => (path ? <Route key={key} path={path} element={<Component />} /> : <Route key={key} index element={<Component />} />))}
          </Route>
          <Route path="oda-servisi/:token" element={<RoomServicePage />} />
          {/* Anket (modül 55): çıkış sonrası ve ara anket. */}
          <Route path="a/:token" element={<SurveyPage />} />
          <Route path="*" element={<FullPageMessage code="NOT_FOUND" />} />
        </Routes>
      </BrowserRouter>
    </LanguageProvider>
  );
}

/** Dil seçici (üst bar). */
export function LanguageSwitch() {
  const { language, choose, t } = useI18n();
  return (
    <label className="flex items-center gap-1 text-xs font-semibold text-ink-soft">
      <Icon name="globe" className="size-4" />
      <span className="sr-only">{t('app.language')}</span>
      <select value={language} onChange={(event) => choose(event.target.value)} className="rounded-item border border-line bg-surface px-2 py-1 text-xs">
        {PORTAL_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {{ tr: 'Türkçe', en: 'English', de: 'Deutsch', ru: 'Русский' }[code]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Bağlantı geçersiz / kapalı gibi tam sayfa ileti. */
export function FullPageMessage({ code, error, onRetry }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-5">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <Alert tone={code === 'NETWORK' || code === 'RATE_LIMIT' ? 'warning' : 'danger'} title={t('app.title')} action={onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t('common.retry')}</Button> : null}>
        {error ? errorText(t, error) : t(`err.${code}`)}
      </Alert>
    </main>
  );
}

/** Web sohbeti balonu (8): kanal açık ve portal adresi izinliyse bir kez yüklenir. @param {{ chatKey: string | null }} props */
function useChatWidget(chatKey) {
  useEffect(() => {
    if (!chatKey || document.querySelector('script[data-hotelos-portal-chat]')) return;
    const script = document.createElement('script');
    script.src = webchatScriptUrl();
    script.async = true;
    script.dataset.key = chatKey;
    script.dataset.hotelosPortalChat = '';
    document.body.appendChild(script);
  }, [chatKey]);
}

/** Portalın kabuğu: ana sayfa verisi, üst bar, alt menü. Veri dakikada bir tazelenir (onay durumu, oda numarası). */
function PortalShell() {
  const { token } = useParams();
  const { t, suggest } = useI18n();
  const overview = useLoad(portalPath(token), { intervalMs: 60_000 });
  const data = overview.data;
  useEffect(() => {
    if (data?.language) suggest(data.language);
  }, [data?.language, suggest]);
  useChatWidget(data?.features?.chatKey ?? null);
  useEffect(() => {
    if (data?.hotel?.name) document.title = data.hotel.name;
  }, [data?.hotel?.name]);

  if (overview.loading && !data) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <Spinner label={t('common.loading')} />
      </main>
    );
  }
  if (overview.error && !data) return <FullPageMessage code={overview.error.code} error={overview.error} onRetry={['NETWORK', 'RATE_LIMIT', 'UNKNOWN'].includes(overview.error.code) ? () => overview.reload() : null} />;

  const pages = PORTAL_PAGES.filter((page) => page.visible(data));
  return (
    <PortalContext.Provider value={{ token, overview: data, reload: () => overview.reload({ quiet: true }) }}>
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-5 py-3 backdrop-blur">
          <span className="truncate font-brand text-lg font-bold text-ink">{data.hotel.name}</span>
          <LanguageSwitch />
        </header>
        <main className="flex-1 px-5 py-5 pb-28">
          <Outlet />
        </main>
        {pages.length > 1 && (
          <nav aria-label={t('app.title')} className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-lg border-t border-line bg-surface/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <ul className="grid" style={{ gridTemplateColumns: `repeat(${pages.length}, minmax(0, 1fr))` }}>
              {pages.map((page) => (
                <li key={page.key}>
                  <NavLink
                    to={`/p/${token}${page.path ? `/${page.path}` : ''}`}
                    end={!page.path}
                    className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${isActive ? 'text-ink' : 'text-ink-muted'}`}
                  >
                    <Icon name={page.icon} className="size-5" />
                    <span className="max-w-full truncate px-1">{t(page.label)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </PortalContext.Provider>
  );
}
