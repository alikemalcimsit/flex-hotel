import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input } from '@hotelos/ui';
import { useAuthStore } from '../store/auth.js';

// TODO: modül 2'de gerçek /auth/login API'sine bağlanacak
const FAKE_USERS = {
  'admin@hotel.local': { password: 'admin123', name: 'Admin', role: 'ADMIN' },
  'resepsiyon@hotel.local': { password: '123456', name: 'Resepsiyon', role: 'FRONT_DESK' },
};

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="flex min-h-screen items-center justify-center">
      <Card title="HotelOS Giriş" className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="E-posta" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input
            label="Şifre"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
            required
          />
          <Button type="submit">Giriş yap</Button>
        </form>
      </Card>
    </div>
  );
}
