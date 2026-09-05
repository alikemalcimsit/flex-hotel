import { Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@hotelos/ui';
import { useAuthStore } from '../store/auth.js';

/** Sol menü boş; modüller eklendikçe buraya link gelir. */
const MENU = [
  { label: 'Panel', to: '/' },
  // TODO: modül menüleri
];

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-gray-200 bg-white p-4">
        <div className="mb-6 text-xl font-bold text-blue-700">HotelOS</div>
        <nav className="flex flex-col gap-1">
          {MENU.map((item) => (
            <a key={item.to} href={item.to} className="rounded px-3 py-2 text-sm hover:bg-gray-100">
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <span className="text-sm text-gray-600">Demo Otel</span>
          <div className="flex items-center gap-3">
            <span className="text-sm">{user?.email}</span>
            <Button variant="secondary" onClick={handleLogout}>
              Çıkış
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
