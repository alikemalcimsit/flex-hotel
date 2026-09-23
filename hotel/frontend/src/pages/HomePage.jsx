import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Icon } from '@hotelos/ui';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { useHotelSettings } from '../lib/useHotel.js';
import { visibleSections } from '../layout/navigation.js';
import { useAuthStore } from '../store/auth.js';

/**
 * Sistem durumu kartlarının tazelenmesi. Canlı bağlantı durumu socket'ten
 * anında gelir; sunucu/veritabanı kontrolü seyrek yeter (her açık panel sorar).
 */
const HEALTH_POLL_MS = 30_000;

/**
 * Panel ana sayfası.
 *
 * Doluluk, gelir gibi göstergeler buraya modül 13 (Dashboard) ile gelecek;
 * o veriler henüz yok, uydurma sayı konmadı. Bugün gösterilen her şey
 * gerçek: sunucu sağlığı, veritabanı, canlı bağlantı, önbellek istatistiği ve
 * kullanıcının rolüne açık bölümler.
 */

/** Hızlı erişim kartlarının alt yazısı; menüde olmayan bilgi. */
const SHORTCUT_HINTS = {
  '/odalar/liste': 'Doluluk, kat hizmeti, arıza kayıtları',
  '/odalar/musaitlik': 'Oda tipi bazında boş oda takvimi',
  '/odalar/atama': 'Bekleyen rezervasyonlara oda ata',
  '/ayarlar/otel': 'Ad, iletişim, giriş/çıkış saatleri',
  '/ayarlar/oda-tipleri': 'Kapasite ve taban fiyatlar',
  '/ayarlar/vergiler': 'KDV ve diğer vergiler',
  '/ayarlar/sezonlar': 'Sezon tarihleri ve fiyat çarpanı',
  '/ayarlar/genel': 'Pansiyon ve iptal politikası',
};

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api('/health'),
    retry: false,
    refetchInterval: HEALTH_POLL_MS,
  });
  const hotelQuery = useHotelSettings();
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

  const cache = health.data?.cache;
  const statuses = [
    {
      key: 'backend',
      icon: 'server',
      label: 'Sunucu',
      ...(health.isPending
        ? { tone: 'neutral', text: 'Kontrol ediliyor' }
        : health.isError
          ? { tone: 'danger', text: 'Yanıt yok' }
          : { tone: 'success', text: 'Çalışıyor' }),
      detail: health.isError ? health.error.message : 'API ve sağlık kontrolü',
    },
    {
      key: 'db',
      icon: 'database',
      label: 'Veritabanı',
      ...(!health.data
        ? { tone: 'neutral', text: 'Bilinmiyor' }
        : health.data.db === 'ok'
          ? { tone: 'success', text: 'Bağlı' }
          : { tone: 'danger', text: 'Bağlantı yok' }),
      detail: 'PostgreSQL',
    },
    {
      key: 'socket',
      icon: 'zap',
      label: 'Canlı bağlantı',
      ...(socketConnected ? { tone: 'success', text: 'Bağlı' } : { tone: 'danger', text: 'Kopuk' }),
      detail: 'Anlık güncellemeler (Socket.IO)',
    },
    {
      key: 'cache',
      icon: 'layers',
      label: 'Önbellek',
      ...(cache
        ? { tone: 'info', text: `%${Math.round(cache.hitRate * 100)} isabet` }
        : { tone: 'neutral', text: 'Bilinmiyor' }),
      detail: cache ? `${cache.entries} kayıt · ${cache.hits} isabet · ${cache.misses} ıska` : 'Sunucu yanıtı bekleniyor',
    },
  ];

  const shortcutGroups = visibleSections(user?.role, permissions)
    .flatMap((section) => section.items)
    .filter((item) => item.children?.length);

  const today = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(),
  );

  return (
    <div className="flex flex-col gap-7">
      <section className="relative overflow-hidden rounded-card bg-ink px-7 py-8 text-white shadow-card sm:px-9 sm:py-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-sec/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm font-semibold capitalize text-white/60">{today}</p>
            <h1 className="mt-2 text-[1.9rem] font-bold leading-tight sm:text-[2.2rem]">
              Hoş geldiniz{user?.name ? `, ${user.name}` : ''}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {hotelQuery.data?.name ? `${hotelQuery.data.name} paneli. ` : ''}
              Sistem durumu aşağıda; bölümlere hızlı erişim kartlarından geçebilirsiniz.
            </p>
          </div>
          <Link
            to="/odalar/musaitlik"
            className="inline-flex items-center gap-2 rounded-control bg-white px-5 py-2.5 text-sm font-bold text-ink transition-colors duration-200 hover:bg-white/90"
          >
            <Icon name="calendar" className="size-4" />
            Müsaitliğe bak
          </Link>
        </div>
      </section>

      <section aria-labelledby="system-status-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="system-status-title" className="text-lg font-bold text-ink">
            Sistem durumu
          </h2>
          {health.dataUpdatedAt > 0 && (
            <p className="text-xs font-semibold text-ink-muted">
              Son kontrol {new Date(health.dataUpdatedAt).toLocaleTimeString('tr-TR')} · {HEALTH_POLL_MS / 1000} sn’de bir
            </p>
          )}
        </div>
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {statuses.map((status) => (
            <li key={status.key} className="flex flex-col rounded-card bg-surface p-6 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-11 place-items-center rounded-control bg-black/[0.05] text-ink">
                  <Icon name={status.icon} className="size-5" />
                </span>
                <Badge tone={status.tone}>{status.text}</Badge>
              </div>
              <p className="mt-5 text-base font-bold text-ink">{status.label}</p>
              <p className="mt-1 break-words text-xs text-ink-muted">{status.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {shortcutGroups.map((group) => (
        <section key={group.to} aria-labelledby={`shortcuts-${group.icon}`}>
          <h2 id={`shortcuts-${group.icon}`} className="mb-4 text-lg font-bold text-ink">
            {group.label}
          </h2>
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {group.children.map((child) => (
              <li key={child.to}>
                <Link
                  to={child.to}
                  className="group flex h-full items-center gap-4 rounded-card bg-surface p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-float"
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-control bg-ink text-white transition-colors duration-200 group-hover:bg-sec-strong">
                    <Icon name={child.icon} className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{child.label}</span>
                    {SHORTCUT_HINTS[child.to] && (
                      <span className="mt-0.5 block text-xs text-ink-muted">{SHORTCUT_HINTS[child.to]}</span>
                    )}
                  </span>
                  <Icon
                    name="arrowRight"
                    className="size-4 shrink-0 text-ink-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
