import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/auth.js';
import { AppLayout } from './layout/AppLayout.jsx';
import { ToastHost } from './components/ToastHost.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { SettingsPage } from './pages/settings/SettingsPage.jsx';
import { HotelInfoTab } from './pages/settings/HotelInfoTab.jsx';
import { RoomTypesTab } from './pages/settings/RoomTypesTab.jsx';
import { TaxesTab } from './pages/settings/TaxesTab.jsx';
import { SeasonsTab } from './pages/settings/SeasonsTab.jsx';
import { GeneralTab } from './pages/settings/GeneralTab.jsx';

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
      <ToastHost />
    </>
  );
}
