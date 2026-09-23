import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@hotelos/ui';
import { useAuthStore } from './store/auth.js';
import { AppLayout } from './layout/AppLayout.jsx';
import { ToastHost } from './components/ToastHost.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { PERMISSIONS, useCan } from './lib/permissions.js';

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
const UsersTab = lazy(() => import('./pages/settings/UsersTab.jsx').then((m) => ({ default: m.UsersTab })));
const RolePermissionsTab = lazy(() =>
  import('./pages/settings/RolePermissionsTab.jsx').then((m) => ({ default: m.RolePermissionsTab })),
);
const MessagesPage = lazy(() => import('./pages/messages/MessagesPage.jsx').then((m) => ({ default: m.MessagesPage })));
const NotificationsPage = lazy(() =>
  import('./pages/notifications/NotificationsPage.jsx').then((m) => ({ default: m.NotificationsPage })),
);
const NotificationHistoryTab = lazy(() =>
  import('./pages/notifications/HistoryTab.jsx').then((m) => ({ default: m.HistoryTab })),
);
const NotificationTemplatesTab = lazy(() =>
  import('./pages/notifications/TemplatesTab.jsx').then((m) => ({ default: m.TemplatesTab })),
);
const NotificationChannelsTab = lazy(() =>
  import('./pages/notifications/ChannelsTab.jsx').then((m) => ({ default: m.ChannelsTab })),
);
const GuestRequestsPage = lazy(() =>
  import('./pages/requests/GuestRequestsPage.jsx').then((m) => ({ default: m.GuestRequestsPage })),
);
const ReservationsPage = lazy(() =>
  import('./pages/reservations/ReservationsPage.jsx').then((m) => ({ default: m.ReservationsPage })),
);
const ReservationListTab = lazy(() =>
  import('./pages/reservations/ReservationListTab.jsx').then((m) => ({ default: m.ReservationListTab })),
);
const NewReservationTab = lazy(() =>
  import('./pages/reservations/NewReservationTab.jsx').then((m) => ({ default: m.NewReservationTab })),
);
const WaitlistTab = lazy(() => import('./pages/reservations/WaitlistTab.jsx').then((m) => ({ default: m.WaitlistTab })));
const ReservationDetailPage = lazy(() =>
  import('./pages/reservations/ReservationDetailPage.jsx').then((m) => ({ default: m.ReservationDetailPage })),
);
const ApprovalsPage = lazy(() => import('./pages/approvals/ApprovalsPage.jsx').then((m) => ({ default: m.ApprovalsPage })));
const ApprovalsPendingTab = lazy(() => import('./pages/approvals/PendingTab.jsx').then((m) => ({ default: m.PendingTab })));
const ApprovalsHistoryTab = lazy(() => import('./pages/approvals/HistoryTab.jsx').then((m) => ({ default: m.HistoryTab })));

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

/**
 * İzni olmayan kullanıcı sayfayı açarsa ana sayfaya döner (menüde de
 * görünmez). Aynı ⚠️ geçerli: asıl kontrol sunucuda.
 */
function RequirePermission({ permission, children }) {
  const can = useCan();
  return can(permission) ? children : <Navigate to="/" replace />;
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
            <Route
              path="rezervasyonlar"
              element={
                <RequirePermission permission={PERMISSIONS.RESERVATIONS_VIEW}>
                  <ReservationsPage />
                </RequirePermission>
              }
            >
              <Route index element={<Navigate to="/rezervasyonlar/liste" replace />} />
              <Route path="liste" element={<ReservationListTab />} />
              <Route
                path="yeni"
                element={
                  <RequirePermission permission={PERMISSIONS.RESERVATIONS_MANAGE}>
                    <NewReservationTab />
                  </RequirePermission>
                }
              />
              <Route path="bekleme-listesi" element={<WaitlistTab />} />
              <Route path=":reservationId" element={<ReservationDetailPage />} />
            </Route>
            <Route path="oda-plani" element={<RoomPlanPage />} />
            {/* Konuşma adreste: yenileyince açık kalır, bağlantı paylaşılabilir. */}
            <Route
              path="mesajlar/:conversationId?"
              element={
                <RequirePermission permission={PERMISSIONS.MESSAGES_VIEW}>
                  <MessagesPage />
                </RequirePermission>
              }
            />
            <Route
              path="istekler"
              element={
                <RequirePermission permission={PERMISSIONS.REQUESTS_VIEW}>
                  <GuestRequestsPage />
                </RequirePermission>
              }
            />
            <Route path="odalar" element={<RoomsPage />}>
              <Route index element={<Navigate to="/odalar/liste" replace />} />
              <Route path="liste" element={<RoomListTab />} />
              <Route path="musaitlik" element={<AvailabilityTab />} />
              <Route path="atama" element={<AssignmentTab />} />
            </Route>
            <Route
              path="onaylar"
              element={
                <RequirePermission permission={PERMISSIONS.APPROVALS_VIEW}>
                  <ApprovalsPage />
                </RequirePermission>
              }
            >
              <Route index element={<Navigate to="/onaylar/bekleyen" replace />} />
              <Route path="bekleyen" element={<ApprovalsPendingTab />} />
              <Route path="gecmis" element={<ApprovalsHistoryTab />} />
            </Route>
            <Route
              path="bildirimler"
              element={
                <RequirePermission permission={PERMISSIONS.NOTIFICATIONS_VIEW}>
                  <NotificationsPage />
                </RequirePermission>
              }
            >
              <Route index element={<Navigate to="/bildirimler/gecmis" replace />} />
              <Route path="gecmis" element={<NotificationHistoryTab />} />
              <Route
                path="sablonlar"
                element={
                  <RequirePermission permission={PERMISSIONS.NOTIFICATIONS_MANAGE}>
                    <NotificationTemplatesTab />
                  </RequirePermission>
                }
              />
              <Route
                path="kanallar"
                element={
                  <RequirePermission permission={PERMISSIONS.NOTIFICATIONS_MANAGE}>
                    <NotificationChannelsTab />
                  </RequirePermission>
                }
              />
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
              <Route
                path="kullanicilar"
                element={
                  <RequirePermission permission={PERMISSIONS.USERS_VIEW}>
                    <UsersTab />
                  </RequirePermission>
                }
              />
              <Route
                path="roller"
                element={
                  <RequirePermission permission={PERMISSIONS.ROLES_MANAGE}>
                    <RolePermissionsTab />
                  </RequirePermission>
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  );
}
