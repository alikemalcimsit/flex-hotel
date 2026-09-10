import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/ayarlar/otel', label: 'Otel bilgileri' },
  { to: '/ayarlar/oda-tipleri', label: 'Oda tipleri' },
  { to: '/ayarlar/vergiler', label: 'Vergiler' },
  { to: '/ayarlar/sezonlar', label: 'Sezonlar' },
  { to: '/ayarlar/genel', label: 'Genel parametreler' },
];

/** Ayarlar bölümünün kabuğu; sekmeler alt route'lara karşılık gelir. */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Ayarlar</h1>
        <p className="mt-1 text-sm text-gray-600">
          Otelin tanımları. Rezervasyon, müsaitlik ve fiyat hesabı bu sayfadaki değerleri kullanır.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
