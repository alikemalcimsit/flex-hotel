import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/auth.js';
import { AppLayout } from './layout/AppLayout.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { HomePage } from './pages/HomePage.jsx';

/** Giriş yapılmamışsa login'e yönlendirir. */
function RequireAuth({ children }) {
  const user = useAuthStore((s) => s.user);
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
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
        {/* TODO: modül sayfaları buraya */}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
