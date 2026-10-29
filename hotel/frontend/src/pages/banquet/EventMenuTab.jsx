import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_EVENT_MENUS,
  MAX_MENU_REASON_LENGTH,
  MENU_COURSE_MODE_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  STOCK_ITEM_GROUP_LABELS,
  TAX_APPLIES_TO,
  reopenEventMenuSchema,
  saveEventMenuSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { banquetKeys, dayText, wallRange, wallText } from '../../lib/banquet.js';
import { TAX_APPLIES_TO_LABELS, formatMoney } from '../../lib/format.js';
import { useFnbLive } from '../../lib/kitchen.js';
import { allergenText, foodCostTone, pctText, policyPctText, quantityText } from '../../lib/kitchenFormat.js';
import { eventMenuFormOf, eventMenuFromCatalog, eventMenuPayloadOf } from '../../lib/menuForm.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { REQUEST_STATUS_TONES } from '../../lib/purchasingFormat.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { CoursesEditor } from './CoursesEditor.jsx';
import { PurchaseRequestDialog } from './PurchaseRequestDialog.jsx';

const STALE_TEXT = 'Dosya bu arada başkası tarafından değiştirildi; ekran yenilendi, tekrar deneyin.';
const CLOSED_FOR_MENU = Object.freeze(['COMPLETED', 'CANCELLED', 'LOST']);

/**
 * Kesin olmayan dosyada ihtiyacın neden "olası" sayıldığı (talep yalnız kesin dosyadan açılır).
 * @param {string} status
 */
function unplannedText(status) {
  if (status === 'COMPLETED') return 'Etkinlik gerçekleşti: ihtiyaç bilgi amaçlı, satın alma talebi açılmaz.';
  if (status === 'CANCELLED' || status === 'LOST') return 'Dosya kapandı: ihtiyaç bilgi amaçlı, satın alma talebi açılmaz.';
  return 'Etkinlik kesin değil: malzeme ihtiyacı "olası" sayılır, satın alma talebine kesinleşince çevrilir.';
}

/**
 * Etkinlik dosyasının Menü sekmesi (modül 43): oturumların menüleri (katalogdan kopya, etkinlikte
 * uyarlama), porsiyon planı (fazla hazırlık payıyla), alerjenler, maliyet ve gıda maliyeti
 * (reçete görme izniyle), mutfağa kesinleştirme / gerekçeyle yeniden açma, etkinliğin malzeme
 * ihtiyacı ve satın alma talebine çevirme, açılmış talepler.
 *
 * @param {{ event: any }} props
 */
export function EventMenuTab({ event }) {
  const can = useCan();
  const queryClient = useQueryClient();
  useFnbLive();
  const query = useQuery({ queryKey: banquetKeys.fnb(event.id), queryFn: () => api(`/banquet/events/${event.id}/fnb`) });
  const [dialog, setDialog] = useState(null);

  const action = useMutation({
    mutationFn: ({ method, path, body }) => api(`/banquet/events/${event.id}/menus${path}`, { method, body: JSON.stringify(body) }),
    onSuccess: (result, { success }) => {
      queryClient.setQueryData(banquetKeys.fnb(event.id), result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      setDialog(null);
      toastSuccess(success);
    },
    onError: (error) => {
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
    },
  });

  if (query.isPending || query.isError) return <QueryFallback query={query} errorTitle="Menüler yüklenemedi" />;
  const fnb = query.data;
  const canManage = can(PERMISSIONS.BANQUET_MANAGE) && !CLOSED_FOR_MENU.includes(event.status);
  const canRequest = can(PERMISSIONS.PURCHASING_REQUEST) && fnb.planned;
  const version = fnb.event.updatedAt;
  const run = (method, path, body, success) => action.mutate({ method, path, body: { expectedUpdatedAt: version, ...body }, success });
  const busy = action.isPending;
  const shortfalls = fnb.needs.filter((row) => Number(row.shortfall) > 0);

  return (
    <div className="flex flex-col gap-4">
      <MenuSummary event={event} fnb={fnb} canManage={canManage} onAdd={() => setDialog({ kind: 'edit', menu: null })} />

      {fnb.menus.length === 0 ? (
        <Card>
          <EmptyState
            icon="utensils"
            title="Menü yok"
            description={event.sessions.length ? 'Yemekli oturuma set menü seçin ya da menüyü yemek yemek kurun; kişi başı fiyat kalemi menüden gelir.' : 'Önce Program sekmesinden oturum ekleyin; menü bir oturumun öğünüdür.'}
          />
        </Card>
      ) : (
        fnb.menus.map((menu) => (
          <MenuCard
            key={menu.id}
            menu={menu}
            currency={event.currency}
            canManage={canManage}
            canFinalize={canManage && event.status === 'DEFINITE'}
            busy={busy}
            onEdit={() => setDialog({ kind: 'edit', menu })}
            onDelete={() => setDialog({ kind: 'delete', menu })}
            onFinalize={() => setDialog({ kind: 'finalize', menu })}
            onReopen={() => setDialog({ kind: 'reopen', menu })}
          />
        ))
      )}

      {fnb.menus.length > 0 && (
        <NeedsCard
          fnb={fnb}
          currency={event.currency}
          canRequest={canRequest && shortfalls.length > 0}
          onRequest={() => setDialog({ kind: 'request' })}
        />
      )}
      {fnb.requests.length > 0 && <RequestsCard requests={fnb.requests} />}

      {dialog?.kind === 'edit' && <EventMenuDialog event={event} fnb={fnb} menu={dialog.menu} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          open
          title="Menüyü kaldır"
          message={`"${dialog.menu.name}" ve fiyat kalemi dosyadan kaldırılacak.`}
          confirmLabel="Kaldır"
          isPending={busy}
          onConfirm={() => run('DELETE', `/${dialog.menu.id}`, {}, 'Menü kaldırıldı')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'finalize' && (
        <ConfirmDialog
          open
          title="Mutfağa kesinleştir"
          message={`"${dialog.menu.name}" kesinleşince değiştirilemez (gerekçeyle yeniden açılır). Mutfak üretim planı ve satın alma bu menüyle yapılır; mutfağa haber gider. ${dialog.menu.guests} kişi, hazırlık ${dialog.menu.productionGuests}.`}
          confirmLabel="Kesinleştir"
          confirmVariant="primary"
          confirmIcon="lock"
          isPending={busy}
          onConfirm={() => run('POST', `/${dialog.menu.id}/finalize`, {}, 'Menü mutfağa kesinleşti')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'reopen' && <ReopenDialog menu={dialog.menu} busy={busy} onConfirm={(reason) => run('POST', `/${dialog.menu.id}/reopen`, { reason }, 'Menü yeniden açıldı; mutfağa haber gitti')} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'request' && <PurchaseRequestDialog scope={{ eventId: event.id }} rows={shortfalls} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** @param {{ event: any, fnb: any, canManage: boolean, onAdd: () => void }} props */
function MenuSummary({ event, fnb, canManage, onAdd }) {
  const { today } = useHotelToday();
  const overdue = fnb.finalizeDueDay && fnb.finalizeDueDay <= today;
  return (
    <Card
      title="Menü ve mutfak"
      description={`Kişi başı kalemler ${fnb.event.billablePax.toLocaleString('tr-TR')} kişiyle (${fnb.event.guaranteedPax ? 'garanti' : 'tahmini'}); mutfak ${policyPctText(fnb.overproductionPct)} fazla hazırlar.`}
      actions={
        canManage && (
          <Button type="button" icon="plus" onClick={onAdd} disabled={!event.sessions.length || fnb.menus.length >= MAX_EVENT_MENUS}>
            Menü ekle
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {fnb.finalizeDueDay && (
          <Alert tone={overdue ? 'warning' : 'info'} title={overdue ? 'Menü kesinleştirme günü geldi' : 'Menü kesinleştirme'}>
            Kesinleşmemiş menü var; en geç {dayText(fnb.finalizeDueDay)} tarihinde mutfağa kesinleştirin (üretim planı ve satın alma kesin menüyle yapılır).
          </Alert>
        )}
        {!fnb.planned && fnb.menus.length > 0 && <Alert tone="info">{unplannedText(fnb.event.status)}</Alert>}
        {fnb.totals && fnb.menus.length > 0 && (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Menü geliri (KDV hariç)</dt>
              <dd className="font-semibold tabular-nums">{formatMoney(fnb.totals.netRevenue, event.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Gıda maliyeti</dt>
              <dd className="font-semibold tabular-nums">{formatMoney(fnb.totals.cost, event.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Gıda maliyeti %</dt>
              <dd>
                <Badge tone={foodCostTone(fnb.totals.foodCostPct)}>{pctText(fnb.totals.foodCostPct)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Menüler</dt>
              <dd className="font-semibold">
                {fnb.menus.length} · {fnb.menus.filter((menu) => menu.finalizedAt).length} kesin
              </dd>
            </div>
          </dl>
        )}
      </div>
    </Card>
  );
}

/**
 * @param {{ menu: any, currency: string, canManage: boolean, canFinalize: boolean, busy: boolean, onEdit: () => void, onDelete: () => void, onFinalize: () => void, onReopen: () => void }} props
 */
function MenuCard({ menu, currency, canManage, canFinalize, busy, onEdit, onDelete, onFinalize, onReopen }) {
  const finalized = Boolean(menu.finalizedAt);
  return (
    <Card
      title={`${menu.name} · ${menu.session.title}`}
      description={`${wallText(menu.serveLocal)} servis · ${menu.session.venueName} · ${menu.guests.toLocaleString('tr-TR')} kişi${menu.guestsFixed ? ' (bu öğüne özel)' : ''} · hazırlık ${menu.productionGuests.toLocaleString('tr-TR')}`}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone={finalized ? 'success' : 'warning'}>{finalized ? 'Mutfağa kesin' : 'Taslak'}</Badge>
          {canManage && !finalized && (
            <>
              <Button type="button" size="sm" variant="outline" icon="pencil" onClick={onEdit} disabled={busy}>
                Düzenle
              </Button>
              <Button type="button" size="sm" variant="ghost" icon="trash" onClick={onDelete} disabled={busy}>
                Kaldır
              </Button>
            </>
          )}
          {canFinalize && !finalized && (
            <Button type="button" size="sm" icon="lock" onClick={onFinalize} disabled={busy || menu.issues.length > 0}>
              Mutfağa kesinleştir
            </Button>
          )}
          {canManage && finalized && (
            <Button type="button" size="sm" variant="outline" icon="rotateCcw" onClick={onReopen} disabled={busy}>
              Yeniden aç
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {menu.issues.length > 0 && (
          <Alert tone="warning" title="Menüde sorun var">
            {menu.issues.join(' · ')}
          </Alert>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
          <span>
            Kişi başı <strong className="text-ink">{formatMoney(menu.pricePerPerson, currency)}</strong>
            {Number(menu.discountPct) > 0 ? ` (%${menu.discountPct} indirim)` : ''}
          </span>
          {menu.item && (
            <span>
              Kalem <strong className="text-ink">{formatMoney(menu.item.total, currency)}</strong>
            </span>
          )}
          {menu.sourceMenu && <span>Katalog: {menu.sourceMenu.name}</span>}
          {finalized && <span>Kesinleştiren {menu.finalizedBy}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-2">Kurs · yemek</th>
                <th className="py-2 pr-2 text-right">Servis</th>
                <th className="py-2 pr-2 text-right">Hazırlanacak</th>
                {menu.cost && <th className="py-2 pr-2 text-right">Porsiyon maliyeti</th>}
                <th className="py-2">Alerjen</th>
              </tr>
            </thead>
            <tbody>
              {menu.courses.map((course) =>
                course.dishes.map((dish, index) => (
                  <tr key={dish.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2">
                      {index === 0 && (
                        <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
                          {course.name} · {MENU_COURSE_MODE_LABELS[course.mode]}
                        </span>
                      )}
                      <span className="font-semibold text-ink">{dish.label ?? dish.recipe.name}</span>
                      {dish.label && <span className="ml-1 text-xs text-ink-muted">({dish.recipe.name})</span>}
                      {!dish.recipe.isActive && <span className="ml-1 text-xs font-semibold text-warning-ink">reçete pasif</span>}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{dish.servedGuests.toLocaleString('tr-TR')} kişi</td>
                    <td className="py-2 pr-2 text-right font-semibold tabular-nums">{dish.portions.toLocaleString('tr-TR')} porsiyon</td>
                    {menu.cost && <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(dish.costPerPortion, currency)}</td>}
                    <td className="py-2 text-xs text-ink-soft">{allergenText(dish.allergens)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-ink-soft">
            Alerjen: <strong className="text-ink">{allergenText(menu.allergens)}</strong>
          </span>
          {menu.cost && (
            <>
              <span className="text-ink-soft">
                Maliyet <strong className="text-ink">{formatMoney(menu.cost.total, currency)}</strong> (kişi başı {formatMoney(menu.cost.perGuest, currency)})
              </span>
              <Badge tone={foodCostTone(menu.cost.foodCostPct)}>Gıda maliyeti {pctText(menu.cost.foodCostPct)}</Badge>
              {menu.cost.missing > 0 && <span className="text-xs font-semibold text-warning-ink">{menu.cost.missing} malzemenin birim maliyeti yok</span>}
            </>
          )}
        </div>
        {menu.notes && <p className="rounded-item bg-surface-muted px-3 py-2 text-sm text-ink-soft">Mutfak notu: {menu.notes}</p>}
      </div>
    </Card>
  );
}

/** @param {{ fnb: any, currency: string, canRequest: boolean, onRequest: () => void }} props */
function NeedsCard({ fnb, currency, canRequest, onRequest }) {
  const groups = new Map();
  for (const row of fnb.needs) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  return (
    <Card
      title="Malzeme ihtiyacı"
      description={fnb.planned ? 'Bütün menüler, fazla hazırlık dahil; eksik = ihtiyaç − açık taleplerde istenen.' : unplannedText(fnb.event.status)}
      actions={
        canRequest && (
          <Button type="button" icon="send" onClick={onRequest}>
            Eksikleri talebe çevir
          </Button>
        )
      }
    >
      {fnb.needs.length === 0 ? (
        <p className="text-sm text-ink-muted">Menülerdeki reçetelerin malzemesi yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-2">Malzeme</th>
                <th className="py-2 pr-2 text-right">İhtiyaç</th>
                {fnb.planned && <th className="py-2 pr-2 text-right">Talep edildi</th>}
                {fnb.planned && <th className="py-2 pr-2 text-right">Eksik</th>}
                <th className="py-2 pr-2">Mutfakta olmalı</th>
                {fnb.totals && <th className="py-2 text-right">Tahmini maliyet</th>}
              </tr>
            </thead>
            {[...groups].map(([group, rows]) => (
              <tbody key={group}>
                <tr>
                  <th colSpan={6} className="pb-1 pt-3 text-left text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
                    {STOCK_ITEM_GROUP_LABELS[group]}
                  </th>
                </tr>
                {rows.map((row) => (
                  <tr key={row.stockItemId} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-2">
                      <span className="font-semibold text-ink">{row.name}</span>
                      {!row.isActive && <span className="ml-1 text-xs text-warning-ink">pasif</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{quantityText(row.needed, row.unit)}</td>
                    {fnb.planned && <td className="py-1.5 pr-2 text-right tabular-nums text-ink-soft">{quantityText(row.requested, row.unit)}</td>}
                    {fnb.planned && (
                      <td className={`py-1.5 pr-2 text-right font-semibold tabular-nums ${Number(row.shortfall) > 0 ? 'text-warning-ink' : 'text-success-ink'}`}>
                        {Number(row.shortfall) > 0 ? quantityText(row.shortfall, row.unit) : 'yok'}
                      </td>
                    )}
                    <td className="py-1.5 pr-2 text-ink-soft">{dayText(row.needDay)}</td>
                    {fnb.totals && <td className="py-1.5 text-right tabular-nums">{formatMoney(row.possibleCost, currency)}</td>}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Card>
  );
}

/** @param {{ requests: any[] }} props */
function RequestsCard({ requests }) {
  return (
    <Card title="Satın alma talepleri" description="Bu etkinlik için açılmış talepler (son 20).">
      <ul className="flex flex-col divide-y divide-line text-sm">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <Link to={`/satin-alma/talepler/${request.id}`} className="font-mono font-semibold text-ink hover:underline">
              {request.number}
            </Link>
            <span className="text-ink-soft">
              {request.lines} satır · ihtiyaç {dayText(request.neededBy)} · {request.requestedBy}
            </span>
            <Badge tone={REQUEST_STATUS_TONES[request.status]}>{PURCHASE_REQUEST_STATUS_LABELS[request.status]}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** @param {{ menu: any, busy: boolean, onConfirm: (reason: string) => void, onClose: () => void }} props */
function ReopenDialog({ menu, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(reopenEventMenuSchema, { expectedUpdatedAt: new Date().toISOString(), reason });
    if (!checked.ok) return setError(checked.errors.reason ?? 'Gerekçe geçersiz');
    setError(null);
    onConfirm(reason.trim());
  }
  return (
    <Modal
      open
      size="sm"
      title="Kesin menüyü yeniden aç"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="menu-reopen-form" icon="rotateCcw" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Yeniden aç'}
          </Button>
        </>
      }
    >
      <form id="menu-reopen-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">"{menu.name}" düzenlenebilir olur; mutfağa gerekçeyle haber gider. Talep edilmiş malzeme varsa eksik / fazla yeniden kontrol edilmeli.</p>
        <Textarea label="Gerekçe" name="menu-reopen-reason" rows={3} maxLength={MAX_MENU_REASON_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} error={error ?? undefined} required disabled={busy} />
      </form>
    </Modal>
  );
}

/**
 * Etkinlik menüsü ekle / düzenle: oturum, katalogdan kopya (yalnız eklerken), ad, servis günü ve
 * saati, öğünün kendi kişisi (boş: etkinliğin kişisi), fiyat, indirim, vergi, mutfak notu, kurslar.
 * @param {{ event: any, fnb: any, menu: any | null, onClose: () => void }} props
 */
function EventMenuDialog({ event, fnb, menu, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => (menu ? eventMenuFormOf(menu) : eventMenuFromCatalog(event.sessions[0], null)));
  const [errors, setErrors] = useState({});
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const set = (key) => (changeEvent) => setForm((current) => ({ ...current, [key]: changeEvent.target.value }));

  const save = useMutation({
    mutationFn: (body) => (menu ? api(`/banquet/events/${event.id}/menus/${menu.id}`, { method: 'PUT', body: JSON.stringify(body) }) : apiPost(`/banquet/events/${event.id}/menus`, body)),
    onSuccess: (result) => {
      queryClient.setQueryData(banquetKeys.fnb(event.id), result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess(menu ? 'Menü kaydedildi' : 'Menü eklendi; fiyat kalemi dosyaya yazıldı');
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
    },
  });

  async function pickCatalog(entry) {
    setLoadingCatalog(true);
    try {
      const catalog = await queryClient.fetchQuery({ queryKey: banquetKeys.menu(entry.id), queryFn: () => api(`/banquet/menus/${entry.id}`) });
      const session = event.sessions.find((candidate) => candidate.id === form.sessionId) ?? event.sessions[0];
      setForm((current) => ({ ...eventMenuFromCatalog(session, catalog), serveAt: current.serveAt, sessionId: current.sessionId, guests: current.guests, notes: current.notes }));
      if (catalog.minGuests && fnb.event.billablePax < catalog.minGuests) toastError(`${catalog.name} en az ${catalog.minGuests} kişi için; etkinlik ${fnb.event.billablePax} kişi`);
    } catch (error) {
      toastError(error.message);
    } finally {
      setLoadingCatalog(false);
    }
  }

  function changeSession(sessionId) {
    const session = event.sessions.find((candidate) => candidate.id === sessionId);
    setForm((current) => ({ ...current, sessionId, serveAt: session ? session.startLocal : current.serveAt }));
  }

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = eventMenuPayloadOf(form, fnb.event.updatedAt);
    const checked = validateWith(saveEventMenuSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      toastError('Menüde düzeltilmesi gereken alanlar var');
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending || loadingCatalog;
  const session = event.sessions.find((candidate) => candidate.id === form.sessionId);
  const guests = Number(String(form.guests).trim()) || fnb.event.billablePax;
  return (
    <Modal
      open
      size="xl"
      title={menu ? `${menu.name} · düzenle` : 'Menü ekle'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="event-menu-form" icon="check" disabled={busy}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="event-menu-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        {!menu && (
          <div className="flex flex-col gap-2">
            <SearchPicker
              label="Set menüden başla (isteğe bağlı)"
              placeholder="Katalogdaki set menüyü ara"
              queryOf={(search) => ({ queryKey: banquetKeys.menus({ search, active: 'true', picker: true }), queryFn: () => api(withQuery('/banquet/menus', { search: search || undefined, active: 'true', page: 1, pageSize: 30 })) })}
              itemsOf={(data) => data?.items ?? []}
              renderItem={(entry) => (
                <span>
                  <span className="font-semibold">{entry.name}</span>{' '}
                  <span className="text-xs text-ink-muted">
                    · {formatMoney(entry.pricePerPerson, event.currency)} kişi başı · {entry.courseCount} kurs{entry.minGuests ? ` · en az ${entry.minGuests} kişi` : ''}
                  </span>
                </span>
              )}
              onPick={pickCatalog}
              emptyText="Satışta set menü yok"
              disabled={busy}
            />
            {loadingCatalog && <Spinner label="Set menü getiriliyor…" className="justify-start" />}
            {form.sourceMenuId && <p className="text-xs text-ink-muted">Katalogdan kopyalandı; burada yapılan değişiklik kataloğu etkilemez.</p>}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Select
            label="Oturum"
            name="event-menu-session"
            options={event.sessions.map((entry) => ({ value: entry.id, label: `${entry.title} · ${wallRange(entry.startLocal, entry.endLocal)}` }))}
            value={form.sessionId}
            onChange={(changeEvent) => changeSession(changeEvent.target.value)}
            error={errors.sessionId}
            disabled={busy}
            className="md:col-span-2"
          />
          <Input
            label="Servis günü"
            name="event-menu-day"
            type="date"
            value={form.serveAt.slice(0, 10)}
            onChange={(changeEvent) => setForm((current) => ({ ...current, serveAt: `${changeEvent.target.value}T${current.serveAt.slice(11, 16)}` }))}
            error={errors.serveAt}
            disabled={busy}
          />
          <Input
            label="Servis saati"
            name="event-menu-time"
            type="time"
            value={form.serveAt.slice(11, 16)}
            onChange={(changeEvent) => setForm((current) => ({ ...current, serveAt: `${current.serveAt.slice(0, 10)}T${changeEvent.target.value}` }))}
            disabled={busy}
          />
          <Input label="Menü adı" name="event-menu-name" value={form.name} onChange={set('name')} error={errors.name} required disabled={busy} className="md:col-span-2" />
          <div className="flex flex-col gap-1">
            <Input label="Kişi (bu öğüne özel)" name="event-menu-guests" type="number" min={1} placeholder={String(fnb.event.billablePax)} value={form.guests} onChange={set('guests')} error={errors.guests} disabled={busy} />
            <p className="text-xs text-ink-muted">Boş: etkinliğin kişisi ({fnb.event.billablePax}); garanti değişince izler.</p>
          </div>
          <Input label={`Kişi başı fiyat (${event.currency}, vergi dahil)`} name="event-menu-price" inputMode="decimal" value={form.pricePerPerson} onChange={set('pricePerPerson')} error={errors.pricePerPerson} required disabled={busy} />
          <Input label="İndirim %" name="event-menu-discount" inputMode="decimal" value={form.discountPct} onChange={set('discountPct')} error={errors.discountPct} disabled={busy} />
          <Select label="Vergi kategorisi" name="event-menu-tax" options={TAX_APPLIES_TO.map((value) => ({ value, label: TAX_APPLIES_TO_LABELS[value] }))} value={form.taxCategory} onChange={set('taxCategory')} error={errors.taxCategory} disabled={busy} />
          <Textarea label="Mutfak notu" name="event-menu-notes" rows={2} placeholder="12 vejetaryen, 3 glutensiz; servis tabakta…" value={form.notes} onChange={set('notes')} error={errors.notes} disabled={busy} className="md:col-span-2" />
        </div>
        {session && <p className="text-xs text-ink-muted">Servis saati oturumun içinde olmalı: {wallRange(session.startLocal, session.endLocal)}.</p>}
        <CoursesEditor courses={form.courses} onChange={(courses) => setForm((current) => ({ ...current, courses }))} withCounts guests={guests} errors={errors} disabled={busy} currency={event.currency} />
      </form>
    </Modal>
  );
}
