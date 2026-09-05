import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@hotelos/ui';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api('/health'), retry: false, refetchInterval: 10_000 });
  const [socketConnected, setSocketConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const backendText = health.isLoading ? 'kontrol ediliyor' : health.isError ? 'hata' : health.data?.db === 'ok' ? 'ok' : 'ok (veritabanı yok)';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">HotelOS</h1>
      <Card title="Sistem durumu" className="max-w-md">
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            Backend: <b className={health.isError ? 'text-red-600' : 'text-green-700'}>{backendText}</b>
          </li>
          <li>
            Socket: <b className={socketConnected ? 'text-green-700' : 'text-red-600'}>{socketConnected ? 'bağlı' : 'kopuk'}</b>
          </li>
        </ul>
      </Card>
    </div>
  );
}
