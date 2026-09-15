import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@hotelos/ui';
import { useAuthStore } from './store/auth.js';
import { AppLayout } from './layout/AppLayout.jsx';
import { ToastHost } from './components/ToastHost.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { HomePage } from './pages/HomePage.jsx';

/**
 * Bölüm sayfaları istendiğinde yüklenir.
 *
 * Resepsiyonist gün boyunca oda planında durur; ayarlar ekranlarının kodunu
 * (form doğrulama, tablo bileşenleri) ilk açılışta indirmesinin anlamı yok.
 * Otel bilgisayarları ve şube internet bağlantıları hızlı değil — ilk açılışı
 * küçük tutmak burada gerçek bir fark.
 */
const RoomPlanPage = lazy(() => import('./pages/plan/RoomPlanPage.jsx').then((m) => ({ default: m.RoomPlanPage })));
const RoomsPage = lazy(() => import('./pages/rooms/RoomsPage.jsx').then((m) => ({ default: m.RoomsPage })));
const RoomListTab = lazy(() => import('./pages/rooms/RoomListTab.jsx').then((m) => ({ default: m.RoomListTab })));
const AvailabilityTab = lazy(() =>
  import('./pages/rooms/AvailabilityTab.jsx').then((m) => ({ default: m.AvailabilityTab })),
);
const AssignmentTab = lazy(() => import('./pages/rooms/AssignmentTab.jsx').then((m) => ({ default: m.AssignmentTab })));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage.jsx').then((m) => ({ default: m.SettingsPage })));
const HotelInfoTab = lazy(() => import('./pages/settings/HotelInfoTab.jsx').then((m) => ({ default: m.HotelInfoTab })));
const RoomTypesTab = lazy(() => import('./pages/settings/RoomTypesTab.jsx').then((m) => ({ default: m.RoomTypesTab })));
const TaxesTab = lazy(() => import('./pages/settings/TaxesTab.jsx').then((m) => ({ default: m.TaxesTab })));
const SeasonsTab = lazy(() => import('./pages/settings/SeasonsTab.jsx').then((m) => ({ default: m.SeasonsTab })));
const GeneralTab = lazy(() => import('./pages/settings/GeneralTab.jsx').then((m) => ({ default: m.GeneralTab })));

/** Giriş yapılmamışsa login'e yönlendirir. */
function RequireAuth({ children }) {
  const user = useAuthStore((s) => s.user);
  return user ? children : <Navigate to="/login" replace />;
}

/**
 * ⚠️ Rol kontrolü şu an yalnızca arayüz seviyesinde ve sahte oturuma dayanıyor
 * (modül 2 / RBAC bekleniyor). Sunucu tarafında karşılığı henüz yok — bu bir
 * güvenlik sınırı değil, yanlış menüye girmeyi önleyen kolaylık.
 */
function RequireRole({ role, children }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <>
      {/* Sayfa parçası inerken kısa bir bekleme göstergesi; yerel ağda göz
          kırpması kadar sürer ama boş ekran bırakmaz. */}
      <Suspense fallback={<Spinner label="Sayfa yükleniyor…" className="py-20" />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="oda-plani" element={<RoomPlanPage />} />
            <Route path="odalar" element={<RoomsPage />}>
              <Route index element={<Navigate to="/odalar/liste" replace />} />
              <Route path="liste" element={<RoomListTab />} />
              <Route path="musaitlik" element={<AvailabilityTab />} />
              <Route path="atama" element={<AssignmentTab />} />
            </Route>
            <Route
              path="ayarlar"
              element={
                <RequireRole role="ADMIN">
                  <SettingsPage />
                </RequireRole>
              }
            >
              <Route index element={<Navigate to="/ayarlar/otel" replace />} />
              <Route path="otel" element={<HotelInfoTab />} />
              <Route path="oda-tipleri" element={<RoomTypesTab />} />
              <Route path="vergiler" element={<TaxesTab />} />
              <Route path="sezonlar" element={<SeasonsTab />} />
              <Route path="genel" element={<GeneralTab />} />
            </Route>
            {/* TODO: modül sayfaları buraya */}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  );
}
