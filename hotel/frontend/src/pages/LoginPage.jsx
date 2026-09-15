import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, Input } from '@hotelos/ui';
import { Logo } from '../components/Logo.jsx';
import { useAuthStore } from '../store/auth.js';

// TODO: modül 2'de gerçek /auth/login API'sine bağlanacak
const FAKE_USERS = {
  'admin@hotel.local': { password: 'admin123', name: 'Admin', role: 'ADMIN' },
  'resepsiyon@hotel.local': { password: '123456', name: 'Resepsiyon', role: 'FRONT_DESK' },
};

/** Tanıtım panelinde sayılan başlıklar — yalnızca bugün panelde gerçekten olan bölümler. */
const HIGHLIGHTS = [
  { icon: 'bed', title: 'Oda envanteri', text: 'Doluluk, kat hizmeti ve arıza kayıtları tek listede.' },
  { icon: 'calendar', title: 'Müsaitlik takvimi', text: 'Oda tipi bazında gün gün boş oda görünümü.' },
  { icon: 'key', title: 'Oda atama', text: 'Bekleyen rezervasyonlara önerili veya otomatik atama.' },
];

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  function handleSubmit(event) {
    event.preventDefault();
    const found = FAKE_USERS[email.trim().toLowerCase()];
    if (!found || found.password !== password) {
      setError('E-posta veya şifre hatalı');
      return;
    }
    login({ email: email.trim().toLowerCase(), name: found.name, role: found.role });
    navigate('/');
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
            Otel operasyonunuz <span className="text-sec">tek panelde.</span>
          </h1>
          <ul className="mt-10 flex flex-col gap-6">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-control border border-sidebar-line bg-white/[0.05] text-sec">
                  <Icon name={item.icon} className="size-5" />
                </span>
                <span>
                  <span className="block font-bold">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-sidebar-muted">{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-sidebar-muted">FlexAI · FlexHotel yönetim paneli</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <Logo className="mb-10 block text-[1.9rem] lg:hidden" />

          <div className="rounded-card bg-surface p-7 shadow-card sm:p-9">
            <h2 className="text-[1.6rem] font-bold leading-tight text-ink">Giriş yap</h2>
            <p className="mt-1.5 text-sm text-ink-muted">Devam etmek için hesabınızla oturum açın.</p>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
              <Input
                label="E-posta"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="ornek@otel.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                required
              />
              <Input
                label="Şifre"
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
                    aria-label={isPasswordVisible ? 'Şifreyi gizle' : 'Şifreyi göster'}
                    aria-pressed={isPasswordVisible}
                    className="grid size-9 place-items-center rounded-item text-ink-muted transition-colors duration-200 hover:bg-black/[0.05] hover:text-ink"
                  >
                    <Icon name={isPasswordVisible ? 'eyeOff' : 'eye'} className="size-[18px]" />
                  </button>
                }
              />
              <Button type="submit" icon="arrowRight" className="mt-2 w-full flex-row-reverse">
                Giriş yap
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
