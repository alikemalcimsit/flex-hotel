import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Icon, Input, Spinner, Textarea } from '@hotelos/ui';
import { guestApi, roomServicePath } from '../api.js';
import { FullPageMessage, LanguageSwitch } from '../App.jsx';
import { errorText, useI18n } from '../i18n.jsx';
import { MAX_ORDER_LINES } from '../limits.js';
import { useLoad } from '../useLoad.js';

const OPEN_STATUSES = new Set(['REQUESTED', 'SCHEDULED', 'RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY']);
const STATUS_TONES = Object.freeze({ REQUESTED: 'warning', SCHEDULED: 'info', RECEIVED: 'info', PREPARING: 'info', READY: 'info', ON_THE_WAY: 'info', DELIVERED: 'success', CANCELLED: 'neutral', REJECTED: 'danger' });

/**
 * Oda servisi QR menüsü (sipariş kuralları modül 41'de; bu sayfa misafirin gördüğü). Bağlantı odaya bağlıdır: oda
 * değişir ya da konaklama biterse geçersizdir. Sipariş mutfağın kabulünü bekler; misafir kabulden önce iptal edebilir.
 * Siparişlerin durumu 20 saniyede bir tazelenir.
 */
export function RoomServicePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t, fmt } = useI18n();
  const menu = useLoad(roomServicePath(token));
  const orders = useLoad(roomServicePath(token, '/orders'), { intervalMs: 20_000 });
  const [outletId, setOutletId] = useState(null);
  const [cart, setCart] = useState(() => new Map());
  const [when, setWhen] = useState('now');
  const [deliverAt, setDeliverAt] = useState('');
  const [covers, setCovers] = useState('1');
  const [note, setNote] = useState('');
  const [requestId, setRequestId] = useState(() => globalThis.crypto.randomUUID());
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const data = menu.data;
  useEffect(() => {
    if (data?.outlets?.length && !outletId) setOutletId(data.outlets[0].id);
    if (data?.hotelName) document.title = data.hotelName;
  }, [data, outletId]);
  const outlet = data?.outlets?.find((row) => row.id === outletId) ?? null;
  const items = useMemo(() => new Map((outlet?.categories ?? []).flatMap((category) => category.items).map((item) => [item.id, item])), [outlet]);
  const lines = [...cart.entries()].filter(([id]) => items.has(id));
  const itemsTotal = lines.reduce((sum, [id, quantity]) => sum + Number(items.get(id).price) * quantity, 0);
  const openOrders = (orders.data?.orders ?? data?.orders ?? []).filter((order) => OPEN_STATUSES.has(order.status)).length;

  if (menu.loading && !data) return <main className="grid min-h-dvh place-items-center"><Spinner label={t('common.loading')} /></main>;
  if (menu.error && !data) return <FullPageMessage code={menu.error.code} error={menu.error} onRetry={['NETWORK', 'RATE_LIMIT', 'UNKNOWN'].includes(menu.error.code) ? () => menu.reload() : null} />;

  const change = (id, delta) =>
    setCart((current) => {
      const next = new Map(current);
      const quantity = (next.get(id) ?? 0) + delta;
      if (quantity <= 0) next.delete(id);
      else next.set(id, Math.min(quantity, 20));
      return next;
    });

  const submit = async () => {
    if (!lines.length || lines.length > MAX_ORDER_LINES) return;
    if (when === 'later' && !deliverAt) {
      setStatus({ tone: 'warning', text: t('error.required') });
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      const result = await guestApi(roomServicePath(token, '/orders'), {
        method: 'POST',
        body: { requestId, outletId, lines: lines.map(([menuItemId, quantity]) => ({ menuItemId, quantity })), note: note.trim() || null, covers: Number(covers) || 1, deliverAt: when === 'later' ? deliverAt : null },
      });
      orders.setData({ orders: result.orders });
      setCart(new Map());
      setNote('');
      setRequestId(globalThis.crypto.randomUUID());
      setStatus({ tone: 'success', text: t('rs.ordered') });
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (error) {
      setStatus({ tone: 'danger', text: errorText(t, error) });
    } finally {
      setSending(false);
    }
  };

  const cancel = async (orderId) => {
    try {
      const result = await guestApi(roomServicePath(token, `/orders/${orderId}/cancel`), { method: 'POST' });
      orders.setData({ orders: result.orders });
    } catch (error) {
      setStatus({ tone: 'danger', text: errorText(t, error) });
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-5 py-3 backdrop-blur">
        <span className="flex min-w-0 items-center gap-2">
          {window.history.length > 1 && (
            <button type="button" onClick={() => navigate(-1)} className="rounded-item p-1" aria-label={t('common.back')}>
              <Icon name="arrowLeft" className="size-5" />
            </button>
          )}
          <span className="min-w-0">
            <span className="block truncate font-brand text-lg font-bold">{t('rs.title')}</span>
            <span className="block text-xs text-ink-muted">
              {data.hotelName} · {t('rs.room', { number: data.roomNumber })}
            </span>
          </span>
        </span>
        <LanguageSwitch />
      </header>
      <main className="flex flex-1 flex-col gap-5 px-5 py-5">
        {!data.orderingEnabled && <Alert tone="warning">{t('rs.closed')}</Alert>}
        {data.outlets.length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {data.outlets.map((row) => (
              <Button key={row.id} type="button" size="sm" variant={row.id === outletId ? 'primary' : 'outline'} onClick={() => { setOutletId(row.id); setCart(new Map()); }}>
                {row.name}
              </Button>
            ))}
          </div>
        )}
        {outlet?.categories.map((category) => (
          <section key={category.id}>
            <h2 className="mb-2 font-bold text-ink">{category.name}</h2>
            <ul className="flex flex-col gap-2">
              {category.items.map((item) => {
                const quantity = cart.get(item.id) ?? 0;
                return (
                  <li key={item.id} className={`flex items-center justify-between gap-3 rounded-panel border border-line bg-surface p-3 ${item.soldOut ? 'opacity-50' : ''}`}>
                    <span className="min-w-0">
                      <span className="block font-semibold">{item.name}</span>
                      {item.description && <span className="block text-xs text-ink-muted">{item.description}</span>}
                      <span className="text-sm tabular-nums">{fmt.money(item.price, data.currency)}</span>
                    </span>
                    {item.soldOut ? (
                      <Badge>{t('rs.soldOut')}</Badge>
                    ) : quantity ? (
                      <span className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => change(item.id, -1)} aria-label="−">−</Button>
                        <span className="w-5 text-center font-semibold tabular-nums">{quantity}</span>
                        <Button type="button" size="sm" variant="outline" onClick={() => change(item.id, 1)} aria-label="+">+</Button>
                      </span>
                    ) : (
                      <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => change(item.id, 1)} disabled={!data.orderingEnabled}>
                        {t('rs.add')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {data.orderingEnabled && (
          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <h2 className="font-bold text-ink">{t('rs.cart')}</h2>
            {lines.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('rs.empty')}</p>
            ) : (
              <ul className="text-sm">
                {lines.map(([id, quantity]) => (
                  <li key={id} className="flex justify-between py-1">
                    <span>{quantity} × {items.get(id).name}</span>
                    <span className="tabular-nums">{fmt.money(Number(items.get(id).price) * quantity, data.currency)}</span>
                  </li>
                ))}
                {Number(data.trayCharge) > 0 && (
                  <li className="flex justify-between py-1 text-ink-soft">
                    <span>{t('rs.tray')}</span>
                    <span className="tabular-nums">{fmt.money(data.trayCharge, data.currency)}</span>
                  </li>
                )}
                <li className="mt-1 flex justify-between border-t border-line pt-2 font-bold">
                  <span>{t('rs.total')}</span>
                  <span className="tabular-nums">{fmt.money(itemsTotal + Number(data.trayCharge || 0), data.currency)}</span>
                </li>
              </ul>
            )}
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-1 text-sm font-semibold">{t('rs.when')}</legend>
              <Button type="button" size="sm" variant={when === 'now' ? 'primary' : 'outline'} onClick={() => setWhen('now')}>
                {t('rs.now', { minutes: data.deliveryTargetMinutes })}
              </Button>
              <Button type="button" size="sm" variant={when === 'later' ? 'primary' : 'outline'} onClick={() => setWhen('later')}>
                {t('rs.later')}
              </Button>
            </fieldset>
            {when === 'later' && <Input label={t('rs.at')} type="datetime-local" value={deliverAt} onChange={(event) => setDeliverAt(event.target.value)} />}
            <Input label={t('rs.covers')} inputMode="numeric" value={covers} onChange={(event) => setCovers(event.target.value.replace(/\D/g, '').slice(0, 2))} />
            <Textarea label={`${t('rs.note')} (${t('common.optional')})`} rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
            {openOrders >= data.maxActiveOrders && <Alert tone="info">{t('rs.limit', { count: data.maxActiveOrders })}</Alert>}
            {status && <Alert tone={status.tone}>{status.text}</Alert>}
            <Button type="button" icon="send" onClick={submit} disabled={sending || !lines.length || openOrders >= data.maxActiveOrders}>
              {sending ? t('rs.ordering') : t('rs.order')}
            </Button>
          </section>
        )}

        {(orders.data?.orders ?? data.orders).length > 0 && (
          <section>
            <h2 className="mb-2 font-bold text-ink">{t('rs.orders')}</h2>
            <ul className="flex flex-col gap-2">
              {(orders.data?.orders ?? data.orders).map((order) => (
                <li key={order.id} className="rounded-panel border border-line bg-surface p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{order.number}</span>
                    <Badge tone={STATUS_TONES[order.status]}>{t(`rsStatus.${order.status}`)}</Badge>
                  </div>
                  <p className="mt-1 text-ink-soft">{order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-ink-muted">
                    <span>{fmt.dateTime(order.deliverAt ?? order.createdAt)}</span>
                    {order.byGuest && order.status === 'REQUESTED' && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => cancel(order.id)}>
                        {t('rs.cancelOrder')}
                      </Button>
                    )}
                  </div>
                  {order.rejectReason && <p className="mt-1 text-xs text-danger-ink">{order.rejectReason}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
