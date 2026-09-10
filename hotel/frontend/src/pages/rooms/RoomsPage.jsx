import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/odalar/liste', label: 'Oda listesi' },
  { to: '/odalar/musaitlik', label: 'Müsaitlik' },
  { to: '/odalar/atama', label: 'Oda atama' },
];

/** Oda envanteri bölümünün kabuğu; sekmeler alt route'lara karşılık gelir. */
export function RoomsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Odalar</h1>
        <p className="mt-1 text-sm text-gray-600">
          Oda envanteri, müsaitlik takvimi ve rezervasyonlara oda atama.
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
