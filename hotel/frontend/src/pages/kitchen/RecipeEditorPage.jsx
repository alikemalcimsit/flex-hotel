import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KITCHEN_UNIT_LABELS,
  MAX_RECIPE_LEAD_MINUTES,
  MAX_RECIPE_LINES,
  POS_STATIONS,
  POS_STATION_LABELS,
  PREP_YIELD_UNITS,
  RECIPE_KINDS,
  RECIPE_KIND_HINTS,
  RECIPE_KIND_LABELS,
  STOCK_ITEM_GROUP_LABELS,
  compatibleUnits,
  createRecipeSchema,
  leadText,
  recipePreviewSchema,
  updateRecipeSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Icon, Input, Select, Textarea } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { recipeKeys, useRecipesLive } from '../../lib/kitchen.js';
import { allergenText, foodCostTone, pctText, quantityText } from '../../lib/kitchenFormat.js';
import { moveItem } from '../../lib/menuForm.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Önizleme isteği yazım bitince gider. */
const PREVIEW_DEBOUNCE_MS = 450;
const CELL = 'w-full rounded-item border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-ink disabled:opacity-60';
const cellClass = (error) => `${CELL} ${error ? 'border-sec-strong' : 'border-line-strong'}`;

let lineSequence = 0;
const lineKey = () => {
  lineSequence += 1;
  return `l${lineSequence}`;
};

/** @param {any} line kayıtlı satır */
const lineOf = (line) => ({
  key: lineKey(),
  stockItemId: line.stockItemId,
  subRecipeId: line.subRecipeId,
  sourceKind: line.source.kind,
  sourceName: line.source.name,
  sourceUnit: line.source.unit,
  sourceActive: line.source.isActive,
  quantity: line.quantity,
  unit: line.unit,
  wastePct: line.wastePct,
  note: line.note ?? '',
});

const EMPTY_FORM = Object.freeze({ code: '', name: '', kind: 'DISH', station: 'HOT', menuItem: null, yieldQuantity: '10', yieldUnit: 'PORTION', leadMinutes: '0', method: '', isActive: true, lines: [] });

/** @param {any} recipe */
const formOf = (recipe) =>
  recipe
    ? {
        code: recipe.code ?? '',
        name: recipe.name,
        kind: recipe.kind,
        station: recipe.station,
        menuItem: recipe.menuItem ? { id: recipe.menuItem.id, name: recipe.menuItem.name, price: recipe.menuItem.price } : null,
        yieldQuantity: recipe.yieldQuantity,
        yieldUnit: recipe.yieldUnit,
        leadMinutes: String(recipe.leadMinutes),
        method: recipe.method ?? '',
        isActive: recipe.isActive,
        lines: recipe.lines.map(lineOf),
      }
    : { ...EMPTY_FORM, lines: [] };

/** @param {any} form */
const linesPayloadOf = (form) =>
  form.lines.map((line) => ({
    stockItemId: line.stockItemId ?? null,
    subRecipeId: line.subRecipeId ?? null,
    quantity: String(line.quantity).trim(),
    unit: line.unit,
    wastePct: String(line.wastePct).trim() || '0',
    note: line.note.trim() || null,
  }));

/**
 * Reçete ekranı (yeni / düzenle): verim, istasyon, servisten önce hazırlık süresi, menü ürünü bağı,
 * satırlar (malzeme ya da ara reçete; net miktar, birim, fire). Düzenlerken maliyet sunucuda
 * önizlenir (kaydetmeden); döngü, birim uyumu ve derinlik kayıtta sunucuda denetlenir. Yalnız
 * görme izni olan kayıtlı maliyetleri salt okunur görür.
 */
export function RecipeEditorPage() {
  const { recipeId } = useParams();
  const isNew = !recipeId;
  const query = useQuery({ queryKey: recipeKeys.detail(recipeId), queryFn: () => api(`/recipes/${recipeId}`), enabled: !isNew });
  useRecipesLive();

  if (!isNew && (query.isPending || query.isError)) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <QueryFallback query={query} errorTitle="Reçete yüklenemedi" />
      </div>
    );
  }
  return <RecipeEditor key={recipeId ?? 'new'} recipe={isNew ? null : query.data} />;
}

function BackLink() {
  return (
    <Link to="/mutfak" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
      <Icon name="arrowLeft" className="size-4" /> Reçeteler
    </Link>
  );
}

/** @param {{ recipe: any | null }} props */
function RecipeEditor({ recipe }) {
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: hotel } = useHotelContext();
  const currency = hotel?.currency;
  const canManage = can(PERMISSIONS.RECIPES_MANAGE);
  const [form, setForm] = useState(() => formOf(recipe));
  const [errors, setErrors] = useState({});
  const [dirty, setDirty] = useState(false);

  // Başkasının kaydı canlı gelince düzenlenmemiş form tazelenir; düzenleniyorsa kullanıcının satırları korunur
  // (kayıtta sürüm damgası "başkası değiştirdi" der).
  useEffect(() => {
    if (!dirty) setForm(formOf(recipe));
  }, [recipe, dirty]);

  const patch = (changes) => {
    setForm((current) => ({ ...current, ...changes }));
    setDirty(true);
  };
  const patchLine = (key, changes) => patch({ lines: form.lines.map((line) => (line.key === key ? { ...line, ...changes } : line)) });

  function changeKind(kind) {
    // Yemek porsiyon, ara ürün kg / L / adet verir; menü bağı yalnız yemekte.
    patch({ kind, yieldUnit: kind === 'DISH' ? 'PORTION' : 'KG', menuItem: kind === 'DISH' ? form.menuItem : null });
  }

  function addStock(item) {
    patch({ lines: [...form.lines, { key: lineKey(), stockItemId: item.id, subRecipeId: null, sourceKind: 'STOCK', sourceName: item.name, sourceUnit: item.unit, sourceActive: true, quantity: '', unit: item.unit, wastePct: '0', note: '' }] });
  }
  function addRecipe(sub) {
    patch({ lines: [...form.lines, { key: lineKey(), stockItemId: null, subRecipeId: sub.id, sourceKind: 'RECIPE', sourceName: sub.name, sourceUnit: sub.yieldUnit, sourceActive: true, quantity: '', unit: sub.yieldUnit, wastePct: '0', note: '' }] });
  }

  /* ── Maliyet önizlemesi (yazım bitince, geçerli satırlarla) ── */
  const previewBody = useMemo(
    () => ({ recipeId: recipe?.id ?? null, kind: form.kind, yieldQuantity: String(form.yieldQuantity).trim(), yieldUnit: form.yieldUnit, lines: linesPayloadOf(form) }),
    [recipe?.id, form],
  );
  const [debouncedBody, setDebouncedBody] = useState(previewBody);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBody(previewBody), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [previewBody]);
  const previewValid = dirty && canManage && form.lines.length > 0 && validateWith(recipePreviewSchema, debouncedBody).ok;
  const preview = useQuery({
    queryKey: [...recipeKeys.all, 'preview', debouncedBody],
    queryFn: () => apiPost('/recipes/preview', debouncedBody),
    enabled: previewValid,
    staleTime: 10_000,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (body) => (recipe ? api(`/recipes/${recipe.id}`, { method: 'PUT', body: JSON.stringify(body) }) : apiPost('/recipes', body)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.all });
      queryClient.setQueryData(recipeKeys.detail(result.id), result);
      toastSuccess(recipe ? 'Reçete kaydedildi' : 'Reçete eklendi');
      setDirty(false);
      if (!recipe) navigate(`/mutfak/receteler/${result.id}`, { replace: true });
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe?.id) });
      toastError(error.code === 'STALE_WRITE' ? 'Reçete bu arada başkası tarafından değiştirildi; ekran yenilendi.' : error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = {
      ...(recipe ? { expectedUpdatedAt: recipe.updatedAt, isActive: form.isActive } : {}),
      code: form.code.trim() || null,
      name: form.name.trim(),
      kind: form.kind,
      station: form.station,
      menuItemId: form.kind === 'DISH' ? form.menuItem?.id ?? null : null,
      yieldQuantity: String(form.yieldQuantity).trim(),
      yieldUnit: form.yieldUnit,
      leadMinutes: String(form.leadMinutes).trim() || '0',
      method: form.method.trim() || null,
      lines: linesPayloadOf(form),
    };
    const checked = validateWith(recipe ? updateRecipeSchema : createRecipeSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      toastError('Formda düzeltilmesi gereken alanlar var');
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  const disabled = !canManage || busy;
  const yieldOptions = (form.kind === 'DISH' ? ['PORTION'] : PREP_YIELD_UNITS).map((unit) => ({ value: unit, label: KITCHEN_UNIT_LABELS[unit] }));
  const usedIds = new Set(form.lines.map((line) => line.stockItemId ?? line.subRecipeId));
  const savedLines = !dirty && recipe ? recipe.lines : null;
  const previewLines = preview.data?.lines;
  const costOf = (index) => (previewValid ? previewLines?.[index] : savedLines?.[index]);
  const totals = previewValid && preview.data ? preview.data : !dirty && recipe ? { ...recipe.cost, allergens: recipe.allergens } : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <BackLink />
      <PageHeader
        title={recipe ? recipe.name : 'Yeni reçete'}
        description={recipe ? `${RECIPE_KIND_LABELS[recipe.kind]} · ${POS_STATION_LABELS[recipe.station]} · ${quantityText(recipe.yieldQuantity, recipe.yieldUnit)} verir` : 'Yemek porsiyon verir; ara ürün (sos, fond, hamur) kg / L / adet verir ve başka reçetede kullanılır.'}
        actions={
          canManage && (
            <div className="flex gap-2">
              {dirty && recipe && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setForm(formOf(recipe));
                    setErrors({});
                    setDirty(false);
                  }}
                  disabled={busy}
                >
                  Değişiklikleri at
                </Button>
              )}
              <Button type="submit" icon="check" disabled={busy || (recipe && !dirty)}>
                {busy ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
            </div>
          )
        }
      />
      {!canManage && <Alert tone="info">Reçeteyi görüyorsunuz; düzenlemek reçete yönetme yetkisi ister.</Alert>}

      <Card title="Reçete">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input label="Ad" name="recipe-name" value={form.name} onChange={(event) => patch({ name: event.target.value })} error={errors.name} required disabled={disabled} className="md:col-span-2" />
          <Input label="Kod (isteğe bağlı)" name="recipe-code" value={form.code} onChange={(event) => patch({ code: event.target.value })} error={errors.code} disabled={disabled} />
          <div className="flex flex-col gap-1">
            <Select label="Tür" name="recipe-kind-field" options={RECIPE_KINDS.map((kind) => ({ value: kind, label: RECIPE_KIND_LABELS[kind] }))} value={form.kind} onChange={(event) => changeKind(event.target.value)} error={errors.kind} disabled={disabled} />
            <p className="text-xs text-ink-muted">{RECIPE_KIND_HINTS[form.kind]}</p>
          </div>
          <Select label="İstasyon" name="recipe-station-field" options={POS_STATIONS.map((station) => ({ value: station, label: POS_STATION_LABELS[station] }))} value={form.station} onChange={(event) => patch({ station: event.target.value })} error={errors.station} disabled={disabled} />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input label="Verim" name="recipe-yield" inputMode="decimal" value={form.yieldQuantity} onChange={(event) => patch({ yieldQuantity: event.target.value })} error={errors.yieldQuantity} required disabled={disabled} />
            <Select label="Birim" name="recipe-yield-unit" options={yieldOptions} value={form.yieldUnit} onChange={(event) => patch({ yieldUnit: event.target.value })} error={errors.yieldUnit} disabled={disabled} />
          </div>
          <div className="flex flex-col gap-1">
            <Input
              label="Servisten önce başlanır (dakika)"
              name="recipe-lead"
              type="number"
              min={0}
              max={MAX_RECIPE_LEAD_MINUTES}
              value={form.leadMinutes}
              onChange={(event) => patch({ leadMinutes: event.target.value })}
              error={errors.leadMinutes}
              disabled={disabled}
            />
            <p className="text-xs text-ink-muted">
              {leadText(Number(form.leadMinutes) || 0)}. {form.kind === 'PREP' ? 'Ara üründe: onu kullanan reçetenin başlangıcından önce.' : 'Üretim planı servis saatinden geriye sayar.'}
            </p>
          </div>
          {form.kind === 'DISH' && (
            <div className="md:col-span-2">
              {form.menuItem ? (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Restoran menüsündeki ürünü</span>
                  <div className="flex items-center justify-between gap-3 rounded-control border border-line-strong bg-surface px-4 py-2.5 text-sm">
                    <span className="font-semibold text-ink">
                      {form.menuItem.name} <span className="font-normal text-ink-muted">· {formatMoney(form.menuItem.price, currency)}</span>
                    </span>
                    {!disabled && (
                      <button type="button" aria-label="Menü bağını kaldır" onClick={() => patch({ menuItem: null })} className="grid size-6 place-items-center rounded-full text-ink-muted hover:bg-black/[0.06] hover:text-ink">
                        <Icon name="close" className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                canManage && (
                  <SearchPicker
                    label="Restoran menüsündeki ürünü (isteğe bağlı: kâr marjı için)"
                    placeholder="Menü ürünü ara"
                    queryOf={(search) => ({ queryKey: recipeKeys.menuItems({ search, recipeId: recipe?.id }), queryFn: () => api(withQuery('/recipes/menu-items', { search: search || undefined, recipeId: recipe?.id })) })}
                    renderItem={(item) => (
                      <span>
                        <span className="font-semibold">{item.name}</span> <span className="text-xs text-ink-muted">· {item.category} · {formatMoney(item.price, currency)}</span>
                      </span>
                    )}
                    onPick={(item) => patch({ menuItem: { id: item.id, name: item.name, price: item.price } })}
                    emptyText="Reçetesi olmayan aktif ürün bulunamadı"
                    error={errors.menuItemId}
                    disabled={disabled}
                  />
                )
              )}
            </div>
          )}
          {recipe && canManage && (
            <Checkbox
              label="Kullanımda"
              hint="Pasif reçete yeni satıra / menüye seçilmez; kayıtlı menülerde hesaba girer."
              checked={form.isActive}
              onChange={(event) => patch({ isActive: event.target.checked })}
              disabled={disabled}
              className="md:col-span-3"
            />
          )}
        </div>
      </Card>

      <Card
        title="Malzemeler ve ara ürünler"
        description="Net miktar: tabağa / tencereye giren. Fire (ayıklama, pişirme kaybı) brüt alımı artırır: brüt = net ÷ (1 − fire)."
      >
        {errors.lines && <Alert tone="danger" className="mb-3">{errors.lines}</Alert>}
        {form.lines.length === 0 ? (
          <EmptyState icon="package" title="Satır yok" description="Malzeme ya da ara reçete ekleyin; maliyet ve alerjenler satırlardan hesaplanır." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="py-2 pr-2">Kaynak</th>
                  <th className="w-28 py-2 pr-2">Net miktar</th>
                  <th className="w-24 py-2 pr-2">Birim</th>
                  <th className="w-20 py-2 pr-2">Fire %</th>
                  <th className="w-28 py-2 pr-2 text-right">Brüt</th>
                  <th className="w-28 py-2 pr-2 text-right">Maliyet</th>
                  <th className="py-2 pr-2">Not</th>
                  {canManage && <th className="w-24 py-2" />}
                </tr>
              </thead>
              <tbody>
                {form.lines.map((line, index) => {
                  const cost = costOf(index);
                  return (
                    <tr key={line.key} className="border-b border-line align-top last:border-0">
                      <td className="py-2 pr-2">
                        <span className="flex items-center gap-2">
                          <Badge tone={line.sourceKind === 'STOCK' ? 'neutral' : 'violet'} dot={false}>
                            {line.sourceKind === 'STOCK' ? 'Malzeme' : 'Ara reçete'}
                          </Badge>
                          <span className="font-semibold text-ink">{line.sourceName}</span>
                        </span>
                        {!line.sourceActive && <span className="mt-1 block text-xs font-semibold text-warning-ink">pasif (kayıtlı satır kalır)</span>}
                        {(errors[`lines.${index}.stockItemId`] || errors[`lines.${index}.subRecipeId`]) && (
                          <span className="mt-1 block text-xs font-semibold text-sec-strong">{errors[`lines.${index}.stockItemId`] ?? errors[`lines.${index}.subRecipeId`]}</span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <input aria-label="Net miktar" inputMode="decimal" value={line.quantity} onChange={(event) => patchLine(line.key, { quantity: event.target.value })} disabled={disabled} className={cellClass(errors[`lines.${index}.quantity`])} />
                        {errors[`lines.${index}.quantity`] && <span className="mt-1 block text-xs text-sec-strong">{errors[`lines.${index}.quantity`]}</span>}
                      </td>
                      <td className="py-2 pr-2">
                        <select aria-label="Birim" value={line.unit} onChange={(event) => patchLine(line.key, { unit: event.target.value })} disabled={disabled} className={cellClass(errors[`lines.${index}.unit`])}>
                          {compatibleUnits(line.sourceUnit).map((unit) => (
                            <option key={unit} value={unit}>
                              {KITCHEN_UNIT_LABELS[unit]}
                            </option>
                          ))}
                        </select>
                        {errors[`lines.${index}.unit`] && <span className="mt-1 block text-xs text-sec-strong">{errors[`lines.${index}.unit`]}</span>}
                      </td>
                      <td className="py-2 pr-2">
                        <input aria-label="Fire yüzdesi" inputMode="decimal" value={line.wastePct} onChange={(event) => patchLine(line.key, { wastePct: event.target.value })} disabled={disabled} className={cellClass(errors[`lines.${index}.wastePct`])} />
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-ink-soft">{cost ? quantityText(cost.gross, cost.sourceUnit ?? line.sourceUnit) : '—'}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{cost ? formatMoney(cost.cost, currency) : '—'}</td>
                      <td className="py-2 pr-2">
                        <input aria-label="Not" value={line.note} placeholder="ince doğranmış…" onChange={(event) => patchLine(line.key, { note: event.target.value })} disabled={disabled} className={cellClass(errors[`lines.${index}.note`])} />
                      </td>
                      {canManage && (
                        <td className="py-2">
                          <div className="flex justify-end gap-1">
                            <Button type="button" size="sm" variant="ghost" icon="chevronDown" className="rotate-180" aria-label="Yukarı" onClick={() => patch({ lines: moveItem(form.lines, index, -1) })} disabled={busy || index === 0} />
                            <Button type="button" size="sm" variant="ghost" icon="chevronDown" aria-label="Aşağı" onClick={() => patch({ lines: moveItem(form.lines, index, 1) })} disabled={busy || index === form.lines.length - 1} />
                            <Button type="button" size="sm" variant="ghost" icon="trash" aria-label="Satırı kaldır" onClick={() => patch({ lines: form.lines.filter((entry) => entry.key !== line.key) })} disabled={busy} />
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {canManage && form.lines.length < MAX_RECIPE_LINES && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <SearchPicker
              label="Malzeme ekle"
              placeholder="Malzeme ara (ad / kod)"
              queryOf={(search) => ({ queryKey: recipeKeys.stock({ search, active: 'true', picker: true }), queryFn: () => api(withQuery('/recipes/stock-items', { search: search || undefined, active: 'true', page: 1, pageSize: 30 })) })}
              itemsOf={(data) => data?.items ?? []}
              renderItem={(item) => (
                <span>
                  <span className="font-semibold">{item.name}</span>{' '}
                  <span className="text-xs text-ink-muted">
                    · {STOCK_ITEM_GROUP_LABELS[item.group]} · {formatMoney(item.unitCost, currency)} / {KITCHEN_UNIT_LABELS[item.unit]}
                  </span>
                </span>
              )}
              isDisabled={(item) => (usedIds.has(item.id) ? 'satırlarda var' : null)}
              onPick={addStock}
              emptyText="Aktif malzeme bulunamadı"
              disabled={busy}
            />
            <SearchPicker
              label="Ara reçete ekle"
              placeholder="Sos, fond, hamur… ara"
              queryOf={(search) => ({ queryKey: recipeKeys.picker({ search, exclude: recipe?.id }), queryFn: () => api(withQuery('/recipes/picker', { search: search || undefined, exclude: recipe?.id })) })}
              renderItem={(item) => (
                <span>
                  <span className="font-semibold">{item.name}</span>{' '}
                  <span className="text-xs text-ink-muted">
                    · {RECIPE_KIND_LABELS[item.kind]} · {quantityText(item.yieldQuantity, item.yieldUnit)}
                    {item.costPerUnit ? ` · ${formatMoney(item.costPerUnit, currency)} / ${KITCHEN_UNIT_LABELS[item.yieldUnit]}` : ''}
                  </span>
                </span>
              )}
              isDisabled={(item) => (usedIds.has(item.id) ? 'satırlarda var' : null)}
              onPick={addRecipe}
              emptyText="Aktif reçete bulunamadı"
              disabled={busy}
            />
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Maliyet" description={dirty ? 'Kaydedilmemiş satırlarla önizleme (sunucuda hesaplanır).' : 'Güncel malzeme maliyetiyle, KDV hariç.'}>
          {preview.isError && previewValid ? (
            <Alert tone="warning">{preview.error.message}</Alert>
          ) : totals ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">Bir parti ({quantityText(form.yieldQuantity, form.yieldUnit)})</dt>
              <dd className="text-right font-semibold tabular-nums">{formatMoney(totals.batch, currency)}</dd>
              <dt className="text-ink-muted">{KITCHEN_UNIT_LABELS[form.yieldUnit]} başına</dt>
              <dd className="text-right font-semibold tabular-nums">{formatMoney(totals.perUnit, currency)}</dd>
              <dt className="text-ink-muted">Alerjen</dt>
              <dd className="text-right">{allergenText(totals.allergens)}</dd>
              {totals.missing > 0 && (
                <dd className="col-span-2 text-xs font-semibold text-warning-ink">{totals.missing} malzemenin birim maliyeti girilmemiş; maliyet eksik görünür.</dd>
              )}
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">{form.lines.length ? 'Satırları tamamlayınca hesaplanır.' : 'Satır eklenince hesaplanır.'}</p>
          )}
        </Card>
        {recipe?.menuItem && !dirty && (
          <Card title="Kâr marjı" description={`${recipe.menuItem.name} · satış ${formatMoney(recipe.menuItem.price, currency)} (KDV dahil)`}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">Satış (KDV hariç)</dt>
              <dd className="text-right tabular-nums">{formatMoney(recipe.menuItem.netPrice, currency)}</dd>
              <dt className="text-ink-muted">Porsiyon maliyeti</dt>
              <dd className="text-right tabular-nums">{formatMoney(recipe.cost.perUnit, currency)}</dd>
              <dt className="text-ink-muted">Brüt kâr</dt>
              <dd className="text-right font-semibold tabular-nums">{formatMoney(recipe.menuItem.margin, currency)}</dd>
              <dt className="text-ink-muted">Gıda maliyeti</dt>
              <dd className="text-right">
                <Badge tone={foodCostTone(recipe.menuItem.foodCostPct)}>{pctText(recipe.menuItem.foodCostPct)}</Badge>
              </dd>
            </dl>
          </Card>
        )}
        {recipe && (
          <Card title="Kullanıldığı yerler">
            <ul className="flex flex-col gap-1.5 text-sm">
              {recipe.usedIn.recipes.map((parent) => (
                <li key={parent.id}>
                  <Link to={`/mutfak/receteler/${parent.id}`} className="font-semibold text-ink hover:underline">
                    {parent.name}
                  </Link>{' '}
                  <span className="text-xs text-ink-muted">({RECIPE_KIND_LABELS[parent.kind]})</span>
                </li>
              ))}
              {recipe.usedIn.recipeCount > recipe.usedIn.recipes.length && <li className="text-xs text-ink-muted">+{recipe.usedIn.recipeCount - recipe.usedIn.recipes.length} reçete daha</li>}
              <li className="text-ink-soft">Set menülerde {recipe.usedIn.banquetMenuDishes} kez</li>
              <li className="text-ink-soft">Yaklaşan etkinlik menülerinde {recipe.usedIn.upcomingEventDishes} kez</li>
            </ul>
          </Card>
        )}
      </div>

      <Card title="Yapılış">
        <Textarea label="Yapılış (isteğe bağlı)" name="recipe-method" rows={5} value={form.method} onChange={(event) => patch({ method: event.target.value })} error={errors.method} disabled={disabled} />
      </Card>
    </form>
  );
}
