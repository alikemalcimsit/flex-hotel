import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@hotelos/ui';
import { useAuthStore } from './store/auth.js';
import { AppLayout } from './layout/AppLayout.jsx';
import { ToastHost } from './components/ToastHost.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { useManualTaskScope } from './lib/actors.js';
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
const ActivityPage = lazy(() => import('./pages/activity/ActivityPage.jsx').then((m) => ({ default: m.ActivityPage })));
const LiveFeedTab = lazy(() => import('./pages/activity/LiveFeedTab.jsx').then((m) => ({ default: m.LiveFeedTab })));
const EventsTab = lazy(() => import('./pages/activity/EventsTab.jsx').then((m) => ({ default: m.EventsTab })));
const AuditTab = lazy(() => import('./pages/activity/AuditTab.jsx').then((m) => ({ default: m.AuditTab })));
const ChainPage = lazy(() => import('./pages/activity/ChainPage.jsx').then((m) => ({ default: m.ChainPage })));
const RecordChainsPage = lazy(() =>
  import('./pages/activity/RecordChainsPage.jsx').then((m) => ({ default: m.RecordChainsPage })),
);
const ActorsPage = lazy(() => import('./pages/actors/ActorsPage.jsx').then((m) => ({ default: m.ActorsPage })));
const ActorDetailPage = lazy(() => import('./pages/actors/ActorDetailPage.jsx').then((m) => ({ default: m.ActorDetailPage })));
const ManualTasksPage = lazy(() => import('./pages/tasks/ManualTasksPage.jsx').then((m) => ({ default: m.ManualTasksPage })));
const AiAssistantTab = lazy(() => import('./pages/settings/AiAssistantTab.jsx').then((m) => ({ default: m.AiAssistantTab })));
const MessagingChannelsTab = lazy(() =>
  import('./pages/settings/MessagingChannelsTab.jsx').then((m) => ({ default: m.MessagingChannelsTab })),
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
const FoliosPage = lazy(() => import('./pages/folios/FoliosPage.jsx').then((m) => ({ default: m.FoliosPage })));
const StayFolioPage = lazy(() => import('./pages/folios/StayFolioPage.jsx').then((m) => ({ default: m.StayFolioPage })));
const CashPage = lazy(() => import('./pages/cash/CashPage.jsx').then((m) => ({ default: m.CashPage })));
const CashIndex = lazy(() => import('./pages/cash/CashPage.jsx').then((m) => ({ default: m.CashIndex })));
const CashDayTab = lazy(() => import('./pages/cash/CashDayTab.jsx').then((m) => ({ default: m.CashDayTab })));
const ExchangeRatesTab = lazy(() => import('./pages/cash/ExchangeRatesTab.jsx').then((m) => ({ default: m.ExchangeRatesTab })));
const ExtrasPage = lazy(() => import('./pages/extras/ExtrasPage.jsx').then((m) => ({ default: m.ExtrasPage })));
const ExtrasIndex = lazy(() => import('./pages/extras/ExtrasPage.jsx').then((m) => ({ default: m.ExtrasIndex })));
const LostItemsPage = lazy(() => import('./pages/lost-items/LostItemsPage.jsx').then((m) => ({ default: m.LostItemsPage })));
const LostItemDetailPage = lazy(() => import('./pages/lost-items/LostItemDetailPage.jsx').then((m) => ({ default: m.LostItemDetailPage })));
const RevenueReportPage = lazy(() => import('./pages/reports/RevenueReportPage.jsx').then((m) => ({ default: m.RevenueReportPage })));
const BudgetPage = lazy(() => import('./pages/budget/BudgetPage.jsx').then((m) => ({ default: m.BudgetPage })));
const AgenciesPage = lazy(() => import('./pages/agencies/AgenciesPage.jsx').then((m) => ({ default: m.AgenciesPage })));
const AgencyPage = lazy(() => import('./pages/agencies/AgencyPage.jsx').then((m) => ({ default: m.AgencyPage })));
const AgencyOverviewTab = lazy(() => import('./pages/agencies/AgencyOverviewTab.jsx').then((m) => ({ default: m.AgencyOverviewTab })));
const AgencyContractsTab = lazy(() => import('./pages/agencies/AgencyContractsTab.jsx').then((m) => ({ default: m.AgencyContractsTab })));
const AgencyAccountTab = lazy(() => import('./pages/agencies/AgencyAccountTab.jsx').then((m) => ({ default: m.AgencyAccountTab })));
const AgencyBonusTab = lazy(() => import('./pages/agencies/AgencyBonusTab.jsx').then((m) => ({ default: m.AgencyBonusTab })));
const AgencyBonusLayout = lazy(() => import('./pages/agency-bonus/AgencyBonusLayout.jsx').then((m) => ({ default: m.AgencyBonusLayout })));
const BonusRulesTab = lazy(() => import('./pages/agency-bonus/BonusRulesTab.jsx').then((m) => ({ default: m.BonusRulesTab })));
const BonusSettlementsTab = lazy(() => import('./pages/agency-bonus/BonusSettlementsTab.jsx').then((m) => ({ default: m.BonusSettlementsTab })));
const NewBonusRulePage = lazy(() => import('./pages/agency-bonus/BonusRuleFormPage.jsx').then((m) => ({ default: m.NewBonusRulePage })));
const EditBonusRulePage = lazy(() => import('./pages/agency-bonus/BonusRuleFormPage.jsx').then((m) => ({ default: m.EditBonusRulePage })));
const BonusRulePage = lazy(() => import('./pages/agency-bonus/BonusRulePage.jsx').then((m) => ({ default: m.BonusRulePage })));
const BonusSettlementPage = lazy(() => import('./pages/agency-bonus/BonusSettlementPage.jsx').then((m) => ({ default: m.BonusSettlementPage })));
const BanquetLayout = lazy(() => import('./pages/banquet/BanquetLayout.jsx').then((m) => ({ default: m.BanquetLayout })));
const BanquetEventsTab = lazy(() => import('./pages/banquet/EventsTab.jsx').then((m) => ({ default: m.EventsTab })));
const BanquetCalendarTab = lazy(() => import('./pages/banquet/CalendarTab.jsx').then((m) => ({ default: m.CalendarTab })));
const BanquetSetupTab = lazy(() => import('./pages/banquet/SetupTab.jsx').then((m) => ({ default: m.SetupTab })));
const NewEventPage = lazy(() => import('./pages/banquet/EventFormPage.jsx').then((m) => ({ default: m.NewEventPage })));
const BanquetEventPage = lazy(() => import('./pages/banquet/EventPage.jsx').then((m) => ({ default: m.EventPage })));
const EventPaymentRedirect = lazy(() => import('./pages/banquet/EventPaymentRedirect.jsx').then((m) => ({ default: m.EventPaymentRedirect })));
const PromotionsLayout = lazy(() => import('./pages/promotions/PromotionsLayout.jsx').then((m) => ({ default: m.PromotionsLayout })));
const PromotionListTab = lazy(() => import('./pages/promotions/PromotionListTab.jsx').then((m) => ({ default: m.PromotionListTab })));
const PromotionReportTab = lazy(() => import('./pages/promotions/PromotionReportTab.jsx').then((m) => ({ default: m.PromotionReportTab })));
const NewPromotionPage = lazy(() => import('./pages/promotions/NewPromotionPage.jsx').then((m) => ({ default: m.NewPromotionPage })));
const PromotionPage = lazy(() => import('./pages/promotions/PromotionPage.jsx').then((m) => ({ default: m.PromotionPage })));
const PromotionRulesTab = lazy(() => import('./pages/promotions/PromotionRulesTab.jsx').then((m) => ({ default: m.PromotionRulesTab })));
const PromotionCouponsTab = lazy(() => import('./pages/promotions/PromotionCouponsTab.jsx').then((m) => ({ default: m.PromotionCouponsTab })));
const PromotionUsageTab = lazy(() => import('./pages/promotions/PromotionUsageTab.jsx').then((m) => ({ default: m.PromotionUsageTab })));
const ChannelListPage = lazy(() => import('./pages/channels/ChannelListPage.jsx').then((m) => ({ default: m.ChannelListPage })));
const ChannelPage = lazy(() => import('./pages/channels/ChannelPage.jsx').then((m) => ({ default: m.ChannelPage })));
const ChannelSettingsTab = lazy(() => import('./pages/channels/ChannelSettingsTab.jsx').then((m) => ({ default: m.ChannelSettingsTab })));
const ChannelMappingTab = lazy(() => import('./pages/channels/ChannelMappingTab.jsx').then((m) => ({ default: m.ChannelMappingTab })));
const ChannelStopSaleTab = lazy(() => import('./pages/channels/ChannelStopSaleTab.jsx').then((m) => ({ default: m.ChannelStopSaleTab })));
const ChannelLogTab = lazy(() => import('./pages/channels/ChannelLogTab.jsx').then((m) => ({ default: m.ChannelLogTab })));
const ChannelBookingsTab = lazy(() => import('./pages/channels/ChannelBookingsTab.jsx').then((m) => ({ default: m.ChannelBookingsTab })));
const ContractPage = lazy(() => import('./pages/agencies/ContractPage.jsx').then((m) => ({ default: m.ContractPage })));
const ExpenseActualsPage = lazy(() => import('./pages/budget/ExpenseActualsPage.jsx').then((m) => ({ default: m.ExpenseActualsPage })));
const VariancePage = lazy(() => import('./pages/budget/VariancePage.jsx').then((m) => ({ default: m.VariancePage })));
const MinibarEntryTab = lazy(() => import('./pages/extras/MinibarEntryTab.jsx').then((m) => ({ default: m.MinibarEntryTab })));
const MinibarRecordsTab = lazy(() => import('./pages/extras/MinibarRecordsTab.jsx').then((m) => ({ default: m.MinibarRecordsTab })));
const LaundryTab = lazy(() => import('./pages/extras/LaundryTab.jsx').then((m) => ({ default: m.LaundryTab })));
const ExtrasReportTab = lazy(() => import('./pages/extras/ExtrasReportTab.jsx').then((m) => ({ default: m.ExtrasReportTab })));
const PriceListsTab = lazy(() => import('./pages/extras/PriceListsTab.jsx').then((m) => ({ default: m.PriceListsTab })));
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
const FrontDeskPage = lazy(() => import('./pages/front-desk/FrontDeskPage.jsx').then((m) => ({ default: m.FrontDeskPage })));
const ArrivalsTab = lazy(() => import('./pages/front-desk/ArrivalsTab.jsx').then((m) => ({ default: m.ArrivalsTab })));
const DeparturesTab = lazy(() => import('./pages/front-desk/DeparturesTab.jsx').then((m) => ({ default: m.DeparturesTab })));
const InHouseTab = lazy(() => import('./pages/front-desk/InHouseTab.jsx').then((m) => ({ default: m.InHouseTab })));
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

/** İzinlerden biri yeterli (ör. kasa bölümü: kasayı gören ya da kuru giren). */
function RequireAnyPermission({ permissions, children }) {
  const can = useCan();
  return permissions.some((permission) => can(permission)) ? children : <Navigate to="/" replace />;
}

/** Manuel görevler: işin modülüne yetkili olan kendi görevlerini görür (modül 12). */
function RequireTaskScope({ children }) {
  return useManualTaskScope().empty ? <Navigate to="/" replace /> : children;
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
              path="gorevler"
              element={
                <RequireTaskScope>
                  <ManualTasksPage />
                </RequireTaskScope>
              }
            />
            <Route
              path="aktorler"
              element={
                <RequirePermission permission={PERMISSIONS.ACTORS_VIEW}>
                  <ActorsPage />
                </RequirePermission>
              }
            />
            <Route
              path="aktorler/:name"
              element={
                <RequirePermission permission={PERMISSIONS.ACTORS_VIEW}>
                  <ActorDetailPage />
                </RequirePermission>
              }
            />
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
            <Route
              path="on-buro"
              element={
                <RequirePermission permission={PERMISSIONS.STAYS_VIEW}>
                  <FrontDeskPage />
                </RequirePermission>
              }
            >
              <Route index element={<Navigate to="/on-buro/gelecekler" replace />} />
              <Route path="gelecekler" element={<ArrivalsTab />} />
              <Route path="gidecekler" element={<DeparturesTab />} />
              <Route path="konaklayanlar" element={<InHouseTab />} />
            </Route>
            <Route path="oda-plani" element={<RoomPlanPage />} />
            <Route
              path="folyolar"
              element={
                <RequirePermission permission={PERMISSIONS.FOLIO_VIEW}>
                  <FoliosPage />
                </RequirePermission>
              }
            />
            <Route
              path="folyolar/:reservationId"
              element={
                <RequirePermission permission={PERMISSIONS.FOLIO_VIEW}>
                  <StayFolioPage />
                </RequirePermission>
              }
            />
            <Route
              path="kasa"
              element={
                <RequireAnyPermission permissions={[PERMISSIONS.CASH_VIEW, PERMISSIONS.EXCHANGE_RATES_MANAGE]}>
                  <CashPage />
                </RequireAnyPermission>
              }
            >
              <Route index element={<CashIndex />} />
              <Route
                path="gun"
                element={
                  <RequirePermission permission={PERMISSIONS.CASH_VIEW}>
                    <CashDayTab />
                  </RequirePermission>
                }
              />
              <Route path="kurlar" element={<ExchangeRatesTab />} />
            </Route>
            <Route
              path="ek-hizmetler"
              element={
                <RequireAnyPermission
                  permissions={[PERMISSIONS.EXTRAS_VIEW, PERMISSIONS.MINIBAR_POST, PERMISSIONS.LAUNDRY_POST, PERMISSIONS.EXTRAS_MANAGE]}
                >
                  <ExtrasPage />
                </RequireAnyPermission>
              }
            >
              <Route index element={<ExtrasIndex />} />
              <Route
                path="minibar"
                element={
                  <RequirePermission permission={PERMISSIONS.MINIBAR_POST}>
                    <MinibarEntryTab />
                  </RequirePermission>
                }
              />
              <Route
                path="minibar-kayitlari"
                element={
                  <RequirePermission permission={PERMISSIONS.EXTRAS_VIEW}>
                    <MinibarRecordsTab />
                  </RequirePermission>
                }
              />
              <Route
                path="camasir"
                element={
                  <RequirePermission permission={PERMISSIONS.EXTRAS_VIEW}>
                    <LaundryTab />
                  </RequirePermission>
                }
              />
              <Route
                path="rapor"
                element={
                  <RequirePermission permission={PERMISSIONS.EXTRAS_VIEW}>
                    <ExtrasReportTab />
                  </RequirePermission>
                }
              />
              <Route
                path="fiyatlar"
                element={
                  <RequirePermission permission={PERMISSIONS.EXTRAS_MANAGE}>
                    <PriceListsTab />
                  </RequirePermission>
                }
              />
            </Route>
            <Route
              path="kayip-esya"
              element={
                <RequirePermission permission={PERMISSIONS.LOST_ITEMS_VIEW}>
                  <LostItemsPage />
                </RequirePermission>
              }
            />
            <Route
              path="raporlar/gelir"
              element={
                <RequirePermission permission={PERMISSIONS.REPORTS_VIEW}>
                  <RevenueReportPage />
                </RequirePermission>
              }
            />
            <Route path="butce" element={<Navigate to="/butce/plan" replace />} />
            <Route
              path="butce/plan"
              element={
                <RequirePermission permission={PERMISSIONS.BUDGET_VIEW}>
                  <BudgetPage />
                </RequirePermission>
              }
            />
            <Route
              path="butce/gerceklesen"
              element={
                <RequirePermission permission={PERMISSIONS.BUDGET_VIEW}>
                  <ExpenseActualsPage />
                </RequirePermission>
              }
            />
            <Route
              path="butce/sapma"
              element={
                <RequirePermission permission={PERMISSIONS.BUDGET_VIEW}>
                  <VariancePage />
                </RequirePermission>
              }
            />
            {/* Acente ve kontrat (modül 29): kontrat adresi, acente sekmelerinden önce (statik parça önce eşleşir). */}
            <Route
              path="acenteler"
              element={
                <RequirePermission permission={PERMISSIONS.AGENCIES_VIEW}>
                  <AgenciesPage />
                </RequirePermission>
              }
            />
            <Route
              path="acenteler/kontrat/:contractId"
              element={
                <RequirePermission permission={PERMISSIONS.AGENCIES_VIEW}>
                  <ContractPage />
                </RequirePermission>
              }
            />
            <Route
              path="acenteler/:agencyId"
              element={
                <RequirePermission permission={PERMISSIONS.AGENCIES_VIEW}>
                  <AgencyPage />
                </RequirePermission>
              }
            >
              <Route index element={<AgencyOverviewTab />} />
              <Route path="kontratlar" element={<AgencyContractsTab />} />
              <Route path="cari" element={<AgencyAccountTab />} />
              <Route
                path="prim"
                element={
                  <RequirePermission permission={PERMISSIONS.AGENCY_BONUS_VIEW}>
                    <AgencyBonusTab />
                  </RequirePermission>
                }
              />
            </Route>
            {/* Acente bonusu (modül 35): "yeni", "kural" ve "hak-edis/:id" sekme kabuğunun dışında. */}
            <Route
              path="acente-primleri"
              element={
                <RequirePermission permission={PERMISSIONS.AGENCY_BONUS_VIEW}>
                  <AgencyBonusLayout />
                </RequirePermission>
              }
            >
              <Route index element={<BonusRulesTab />} />
              <Route path="hak-edis" element={<BonusSettlementsTab />} />
            </Route>
            <Route
              path="acente-primleri/yeni"
              element={
                <RequirePermission permission={PERMISSIONS.AGENCY_BONUS_MANAGE}>
                  <NewBonusRulePage />
                </RequirePermission>
              }
            />
            <Route
              path="acente-primleri/kural/:ruleId"
              element={
                <RequirePermission permission={PERMISSIONS.AGENCY_BONUS_VIEW}>
                  <BonusRulePage />
                </RequirePermission>
              }
            />
            <Route
              path="acente-primleri/kural/:ruleId/duzenle"
              element={
                <RequirePermission permission={PERMISSIONS.AGENCY_BONUS_MANAGE}>
                  <EditBonusRulePage />
                </RequirePermission>
              }
            />
            <Route
              path="acente-primleri/hak-edis/:bonusId"
              element={
                <RequirePermission permission={PERMISSIONS.AGENCY_BONUS_VIEW}>
                  <BonusSettlementPage />
                </RequirePermission>
              }
            />
            {/* Banket / etkinlik (modül 37): "yeni" ve "odeme/:id" statik parçaları kimlikli yoldan önce eşleşir. */}
            <Route
              path="etkinlikler"
              element={
                <RequirePermission permission={PERMISSIONS.BANQUET_VIEW}>
                  <BanquetLayout />
                </RequirePermission>
              }
            >
              <Route index element={<BanquetEventsTab />} />
              <Route path="takvim" element={<BanquetCalendarTab />} />
              <Route path="tanimlar" element={<BanquetSetupTab />} />
            </Route>
            <Route
              path="etkinlikler/yeni"
              element={
                <RequirePermission permission={PERMISSIONS.BANQUET_MANAGE}>
                  <NewEventPage />
                </RequirePermission>
              }
            />
            <Route
              path="etkinlikler/odeme/:paymentId"
              element={
                <RequirePermission permission={PERMISSIONS.BANQUET_VIEW}>
                  <EventPaymentRedirect />
                </RequirePermission>
              }
            />
            <Route
              path="etkinlikler/:eventId"
              element={
                <RequirePermission permission={PERMISSIONS.BANQUET_VIEW}>
                  <BanquetEventPage />
                </RequirePermission>
              }
            />
            {/* Promosyon ve kupon (modül 31): "yeni" ve "rapor" statik parçaları kimlikli yoldan önce eşleşir. */}
            <Route
              path="promosyonlar"
              element={
                <RequirePermission permission={PERMISSIONS.PROMOTIONS_VIEW}>
                  <PromotionsLayout />
                </RequirePermission>
              }
            >
              <Route index element={<PromotionListTab />} />
              <Route path="rapor" element={<PromotionReportTab />} />
            </Route>
            <Route
              path="promosyonlar/yeni"
              element={
                <RequirePermission permission={PERMISSIONS.PROMOTIONS_MANAGE}>
                  <NewPromotionPage />
                </RequirePermission>
              }
            />
            <Route
              path="promosyonlar/:promotionId"
              element={
                <RequirePermission permission={PERMISSIONS.PROMOTIONS_VIEW}>
                  <PromotionPage />
                </RequirePermission>
              }
            >
              <Route index element={<PromotionRulesTab />} />
              <Route path="kuponlar" element={<PromotionCouponsTab />} />
              <Route path="kullanim" element={<PromotionUsageTab />} />
            </Route>
            {/* Kanal yönetimi (modül 33). */}
            <Route
              path="kanallar"
              element={
                <RequirePermission permission={PERMISSIONS.CHANNEL_MANAGER_VIEW}>
                  <ChannelListPage />
                </RequirePermission>
              }
            />
            <Route
              path="kanallar/:channelId"
              element={
                <RequirePermission permission={PERMISSIONS.CHANNEL_MANAGER_VIEW}>
                  <ChannelPage />
                </RequirePermission>
              }
            >
              <Route index element={<ChannelSettingsTab />} />
              <Route path="eslestirme" element={<ChannelMappingTab />} />
              <Route path="stop-sale" element={<ChannelStopSaleTab />} />
              <Route path="log" element={<ChannelLogTab />} />
              <Route path="rezervasyonlar" element={<ChannelBookingsTab />} />
            </Route>
            <Route
              path="kayip-esya/:id"
              element={
                <RequirePermission permission={PERMISSIONS.LOST_ITEMS_VIEW}>
                  <LostItemDetailPage />
                </RequirePermission>
              }
            />
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
              path="aktivite"
              element={
                <RequirePermission permission={PERMISSIONS.ACTIVITY_VIEW}>
                  <ActivityPage />
                </RequirePermission>
              }
            >
              <Route index element={<Navigate to="/aktivite/akis" replace />} />
              <Route path="akis" element={<LiveFeedTab />} />
              <Route path="olaylar" element={<EventsTab />} />
              <Route
                path="denetim"
                element={
                  <RequirePermission permission={PERMISSIONS.AUDIT_VIEW}>
                    <AuditTab />
                  </RequirePermission>
                }
              />
            </Route>
            <Route
              path="aktivite/zincir/:correlationId"
              element={
                <RequirePermission permission={PERMISSIONS.ACTIVITY_VIEW}>
                  <ChainPage />
                </RequirePermission>
              }
            />
            <Route
              path="aktivite/kayit/:entity/:entityId"
              element={
                <RequirePermission permission={PERMISSIONS.ACTIVITY_VIEW}>
                  <RecordChainsPage />
                </RequirePermission>
              }
            />
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
              <Route
                path="ai"
                element={
                  <RequirePermission permission={PERMISSIONS.SETTINGS_VIEW}>
                    <AiAssistantTab />
                  </RequirePermission>
                }
              />
              <Route
                path="mesaj-kanallari"
                element={
                  <RequirePermission permission={PERMISSIONS.SETTINGS_VIEW}>
                    <MessagingChannelsTab />
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
