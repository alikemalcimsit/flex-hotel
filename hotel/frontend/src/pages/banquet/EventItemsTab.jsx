import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_ITEM_CATEGORIES,
  EVENT_ITEM_CATEGORY_LABELS,
  EVENT_ITEM_UNITS,
  EVENT_ITEM_UNIT_LABELS,
  MAX_EVENT_ITEMS,
  TAX_APPLIES_TO,
  saveEventItemsSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Icon } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { banquetKeys } from '../../lib/banquet.js';
import { changeItemRow, itemErrorsByRow, itemRowOf, itemsPayloadOf, linePreview, newItemRow, previewTotal } from '../../lib/banquetForm.js';
import { TAX_APPLIES_TO_LABELS, formatMoney } from '../../lib/format.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { validateWith } from '../../lib/validate.js';

/** Ekipman seçicinin bir seferde getirdiği en fazla kayıt (otelin ekipman sınırı 500; çoğu otelde bu kadarı yeter). */
const EQUIPMENT_PAGE = 200;

const CELL = 'w-full rounded-item border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-ink disabled:opacity-60';
const cellClass = (error) => `${CELL} ${error ? 'border-sec-strong' : 'border-line-strong'}`;

/**
 * Fiyat kalemleri (modül 37): kategori, açıklama, oturum, ekipman, kişi başı, miktar,
 * birim, birim fiyat (vergi dahil), indirim ve vergi kategorisi. Tablo bütün olarak
 * kaydedilir (sürümlü). Satırın tutarı ekranda kuruş hassasiyetiyle önizlenir; kesin
 * tutar ve vergi kayıtta sunucuda hesaplanır. Kesin etkinlikte ekipman stoğu
 * kayıtta denetlenir.
 *
 * @param {{ event: any, canManage: boolean }} props
 */
export function EventItemsTab({ event, canManage }) {
  const queryClient = useQueryClient();
  const editable = canManage && !['CANCELLED', 'LOST'].includes(event.status);
  const saved = useMemo(() => event.items.map(itemRowOf), [event.items]);
  const [rows, setRows] = useState(saved);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});

  // Başkasının kaydı canlı gelince, düzenlenmemiş tablo tazelenir; düzenleniyorsa kullanıcının satırları korunur.
  useEffect(() => {
    if (!dirty) setRows(saved);
  }, [saved, dirty]);

  const equipment = useQuery({
    queryKey: banquetKeys.equipment({ active: 'true', pageSize: EQUIPMENT_PAGE }),
    queryFn: () => api(withQuery('/banquet/equipment', { active: 'true', page: 1, pageSize: EQUIPMENT_PAGE })),
    enabled: editable,
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (body) => api(`/banquet/events/${event.id}/items`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (result) => {
      queryClient.setQueryData(banquetKeys.event(event.id), result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      setDirty(false);
      setErrors({});
      toastSuccess(`Kalemler kaydedildi · toplam ${formatMoney(result.grandTotal, result.currency)}`);
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(itemErrorsByRow(error.fields, rows));
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: banquetKeys.event(event.id) });
      toastError(error.message);
    },
  });

  const update = (key, field, value) => {
    setRows((current) => current.map((row) => (row.key === key ? changeItemRow(row, field, value) : row)));
    setDirty(true);
  };
  const add = (category) => {
    setRows((current) => [...current, newItemRow(category)]);
    setDirty(true);
  };
  const remove = (key) => {
    setRows((current) => current.filter((row) => row.key !== key));
    setDirty(true);
  };
  const discard = () => {
    setRows(saved);
    setDirty(false);
    setErrors({});
  };

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = itemsPayloadOf(rows, event.updatedAt);
    const checked = validateWith(saveEventItemsSchema, body);
    if (!checked.ok) {
      setErrors(itemErrorsByRow(checked.errors, rows));
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  if (!editable) return <ReadOnlyItems event={event} />;

  const previews = rows.map((row) => linePreview(row, event.billablePax));
  const equipmentOptions = equipment.data?.items ?? [];
  const busy = save.isPending;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Card
        title="Fiyat kalemleri"
        description={`Fiyatlar vergi dahildir. Kişi başı kalem ${event.billablePax.toLocaleString('tr-TR')} kişiyle (${event.guaranteedPax ? 'garanti' : 'tahmini'}) hesaplanır.`}
      >
        {errors._ && (
          <Alert tone="danger" title="Kaydedilemedi" className="mb-3">
            {Object.values(errors._).join(' · ')}
          </Alert>
        )}
        {rows.length === 0 ? (
          <EmptyState icon="list" title="Kalem yok" description="Menü, salon kirası, ekipman, dekor gibi kalemleri ekleyin; kesinleştirme kalem ister." />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[76rem] text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.06em] text-ink-muted">
                <tr>
                  <th scope="col" className="w-36 px-1.5 py-2 font-bold">Tür</th>
                  <th scope="col" className="min-w-56 px-1.5 py-2 font-bold">Açıklama</th>
                  <th scope="col" className="w-40 px-1.5 py-2 font-bold">Oturum / ekipman</th>
                  <th scope="col" className="w-16 px-1.5 py-2 text-center font-bold">Kişi başı</th>
                  <th scope="col" className="w-20 px-1.5 py-2 font-bold">Miktar</th>
                  <th scope="col" className="w-24 px-1.5 py-2 font-bold">Birim</th>
                  <th scope="col" className="w-28 px-1.5 py-2 font-bold">Birim fiyat</th>
                  <th scope="col" className="w-16 px-1.5 py-2 font-bold">İnd. %</th>
                  <th scope="col" className="w-28 px-1.5 py-2 font-bold">Vergi</th>
                  <th scope="col" className="w-28 px-1.5 py-2 text-right font-bold">Tutar</th>
                  <th scope="col" className="w-10 px-1.5 py-2"><span className="sr-only">Kaldır</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row, index) => {
                  const rowErrors = errors[row.key] ?? {};
                  const label = (field) => `${index + 1}. kalem ${field}`;
                  const selected = event.items.find((item) => item.equipmentId && item.equipmentId === row.equipmentId)?.equipment;
                  return (
                    <tr key={row.key} className="align-top">
                      <td className="px-1.5 py-2">
                        <select aria-label={label('türü')} className={cellClass(rowErrors.category)} value={row.category} onChange={(changeEvent) => update(row.key, 'category', changeEvent.target.value)} disabled={busy}>
                          {EVENT_ITEM_CATEGORIES.map((value) => (
                            <option key={value} value={value}>
                              {EVENT_ITEM_CATEGORY_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1.5 py-2">
                        <input aria-label={label('açıklaması')} className={cellClass(rowErrors.description)} value={row.description} maxLength={200} onChange={(changeEvent) => update(row.key, 'description', changeEvent.target.value)} disabled={busy} />
                        {rowErrors.description && <p className="mt-0.5 text-xs text-sec-strong">{rowErrors.description}</p>}
                      </td>
                      <td className="px-1.5 py-2">
                        <select aria-label={label('oturumu')} className={cellClass(rowErrors.sessionId)} value={row.sessionId} onChange={(changeEvent) => update(row.key, 'sessionId', changeEvent.target.value)} disabled={busy}>
                          <option value="">{row.category === 'EQUIPMENT' ? 'Oturum seçin' : 'Bütün etkinlik'}</option>
                          {event.sessions.map((session) => (
                            <option key={session.id} value={session.id}>
                              {session.title}
                            </option>
                          ))}
                        </select>
                        {rowErrors.sessionId && <p className="mt-0.5 text-xs text-sec-strong">{rowErrors.sessionId}</p>}
                        {row.category === 'EQUIPMENT' && (
                          <>
                            <select aria-label={label('ekipmanı')} className={`mt-1 ${cellClass(rowErrors.equipmentId)}`} value={row.equipmentId} onChange={(changeEvent) => update(row.key, 'equipmentId', changeEvent.target.value)} disabled={busy || equipment.isPending}>
                              <option value="">{equipment.isPending ? 'Yükleniyor…' : 'Ekipman seçin'}</option>
                              {selected && !equipmentOptions.some((entry) => entry.id === row.equipmentId) && <option value={row.equipmentId}>{selected.name} (pasif)</option>}
                              {equipmentOptions.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.name} · stok {entry.stockQuantity}
                                </option>
                              ))}
                            </select>
                            {rowErrors.equipmentId && <p className="mt-0.5 text-xs text-sec-strong">{rowErrors.equipmentId}</p>}
                            {equipment.isError && <p className="mt-0.5 text-xs text-sec-strong">Ekipman listesi alınamadı</p>}
                          </>
                        )}
                      </td>
                      <td className="px-1.5 py-2 text-center">
                        <input type="checkbox" aria-label={label('kişi başı mı')} className="mt-2 size-4" checked={row.perPerson} onChange={(changeEvent) => update(row.key, 'perPerson', changeEvent.target.checked)} disabled={busy || row.category === 'EQUIPMENT'} />
                      </td>
                      <td className="px-1.5 py-2">
                        {row.perPerson ? (
                          <span className="block px-2 py-1.5 tabular-nums text-ink-muted" title="Faturalanacak kişi">
                            {event.billablePax}
                          </span>
                        ) : (
                          <input aria-label={label('miktarı')} inputMode="decimal" className={cellClass(rowErrors.quantity)} value={row.quantity} onChange={(changeEvent) => update(row.key, 'quantity', changeEvent.target.value)} disabled={busy} />
                        )}
                        {rowErrors.quantity && <p className="mt-0.5 text-xs text-sec-strong">{rowErrors.quantity}</p>}
                      </td>
                      <td className="px-1.5 py-2">
                        <select aria-label={label('birimi')} className={cellClass(rowErrors.unit)} value={row.unit} onChange={(changeEvent) => update(row.key, 'unit', changeEvent.target.value)} disabled={busy || row.perPerson}>
                          {EVENT_ITEM_UNITS.map((value) => (
                            <option key={value} value={value}>
                              {EVENT_ITEM_UNIT_LABELS[value]}
                            </option>
                          ))}
                        </select>
                        {rowErrors.unit && <p className="mt-0.5 text-xs text-sec-strong">{rowErrors.unit}</p>}
                      </td>
                      <td className="px-1.5 py-2">
                        <input aria-label={label('birim fiyatı')} inputMode="decimal" className={cellClass(rowErrors.unitPrice)} value={row.unitPrice} onChange={(changeEvent) => update(row.key, 'unitPrice', changeEvent.target.value)} disabled={busy} />
                        {rowErrors.unitPrice && <p className="mt-0.5 text-xs text-sec-strong">{rowErrors.unitPrice}</p>}
                      </td>
                      <td className="px-1.5 py-2">
                        <input aria-label={label('indirimi')} inputMode="decimal" className={cellClass(rowErrors.discountPct)} value={row.discountPct} onChange={(changeEvent) => update(row.key, 'discountPct', changeEvent.target.value)} disabled={busy} />
                        {rowErrors.discountPct && <p className="mt-0.5 text-xs text-sec-strong">{rowErrors.discountPct}</p>}
                      </td>
                      <td className="px-1.5 py-2">
                        <select aria-label={label('vergi kategorisi')} className={cellClass(rowErrors.taxCategory)} value={row.taxCategory} onChange={(changeEvent) => update(row.key, 'taxCategory', changeEvent.target.value)} disabled={busy}>
                          {TAX_APPLIES_TO.map((value) => (
                            <option key={value} value={value}>
                              {TAX_APPLIES_TO_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-2 pt-3.5 text-right font-semibold tabular-nums">{previews[index] === null ? '—' : formatMoney(previews[index])}</td>
                      <td className="px-1.5 py-2">
                        <button type="button" aria-label={`${index + 1}. kalemi kaldır`} onClick={() => remove(row.key)} disabled={busy} className="mt-1 grid size-7 place-items-center rounded-item text-ink-muted hover:bg-black/[0.05] hover:text-sec-strong">
                          <Icon name="trash" className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Kalem ekle:</span>
          {EVENT_ITEM_CATEGORIES.map((category) => (
            <Button key={category} type="button" size="sm" variant="outline" icon="plus" onClick={() => add(category)} disabled={busy || rows.length >= MAX_EVENT_ITEMS}>
              {EVENT_ITEM_CATEGORY_LABELS[category]}
            </Button>
          ))}
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-surface px-6 py-4 shadow-card">
        <p className="text-sm text-ink-soft">
          {dirty ? (
            <>
              Önizleme: <strong className="tabular-nums">{formatMoney(previewTotal(previews), event.currency)}</strong> · kaydedilince vergiyle kesinleşir
            </>
          ) : (
            <>
              Kayıtlı toplam: <strong className="tabular-nums">{formatMoney(event.grandTotal, event.currency)}</strong> (vergi {formatMoney(event.taxTotal, event.currency)})
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={discard} disabled={busy || !dirty}>
            Değişiklikleri at
          </Button>
          <Button type="submit" icon="check" disabled={busy || !dirty}>
            {busy ? 'Kaydediliyor…' : 'Kalemleri kaydet'}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Kapanmış dosya ya da yetkisiz kişi: kayıtlı kalemler, sunucunun tutarlarıyla. @param {{ event: any }} props */
function ReadOnlyItems({ event }) {
  const money = (value) => formatMoney(value, event.currency);
  return (
    <Card title="Fiyat kalemleri">
      {event.items.length === 0 ? (
        <EmptyState icon="list" title="Kalem yok" description="Bu dosyada fiyat kalemi girilmemiş." />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">Kalem</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Miktar</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Birim fiyat</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Vergi</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Tutar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {event.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <span className="block font-semibold">{item.description}</span>
                    <span className="block text-xs text-ink-muted">
                      {EVENT_ITEM_CATEGORY_LABELS[item.category]}
                      {item.equipment ? ` · ${item.equipment.name}` : ''}
                      {Number(item.discountPct) > 0 ? ` · %${item.discountPct} indirim` : ''}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {Number(item.billedQuantity).toLocaleString('tr-TR')} {EVENT_ITEM_UNIT_LABELS[item.unit]}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(item.unitPrice)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-muted">{money(item.taxAmount)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{money(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line">
              <tr>
                <th scope="row" colSpan={3} className="px-3 py-2 text-left">
                  Toplam
                </th>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{money(event.taxTotal)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{money(event.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
