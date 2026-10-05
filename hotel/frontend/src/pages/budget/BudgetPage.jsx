import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BUDGET_STATUS_LABELS, saveBudgetLinesSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { apiPost, apiPut } from '../../lib/api.js';
import { budgetKeys, downloadBudgetTemplate, parseCell, readBudgetTemplate, useBudgetLive, useBudgetYear } from '../../lib/budget.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { QueryError } from '../activity/shared.jsx';
import { ExpenseItemsDialog, ReviseDialog } from './BudgetDialogs.jsx';
import { BudgetGrid, gridValues } from './BudgetGrid.jsx';
import { BudgetTabs, YearPicker, useBudgetYearParam } from './BudgetTabs.jsx';

/** Bayat sürüm hatası tek cümleyle; diğerleri sunucunun mesajı. */
const errorText = (error) => (error?.code === 'STALE_WRITE' ? 'Bütçe bu arada başkası tarafından değiştirildi; sayfa yenilendi, değişikliklerinizi tekrar girin.' : error?.message);

/**
 * Bütçe (modül 27): yılın bütçesi ay ay. Taslak düzenlenir (`budget.manage`),
 * onaylanınca kilitlenir (`budget.approve`); değişiklik için revize açılır.
 * Excel: otele göre şablon indirilir, doldurulup yüklenir — değerler ızgaraya
 * kaydedilmemiş değişiklik olarak gelir, kullanıcı gözden geçirip kaydeder.
 */
export function BudgetPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const { year, setYear, currentYear } = useBudgetYearParam();
  useBudgetLive();
  const query = useBudgetYear(year);
  const data = query.data;
  const [view, setView] = useState(/** @type {'DRAFT' | 'APPROVED'} */ ('DRAFT'));
  const shown = view === 'APPROVED' ? data?.approved ?? data?.draft : data?.draft ?? data?.approved;
  const editable = Boolean(shown && shown.status === 'DRAFT' && can(PERMISSIONS.BUDGET_MANAGE));
  const items = useMemo(() => (data?.items ?? []).filter((item) => !item.archived || shown?.lines.some((line) => line.item === item.item)), [data, shown]);
  const serverValues = useMemo(() => (shown ? gridValues(items, shown.lines) : new Map()), [items, shown]);
  const [values, setValues] = useState(serverValues);
  const [errors, setErrors] = useState({});
  // Sunucudaki sürüm kullanıcı düzenlerken değişti (başkası kaydetti): uyarı, girişler silinmez.
  const [serverChanged, setServerChanged] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [dialog, setDialog] = useState(/** @type {null | 'items' | 'revise' | 'approve'} */ (null));
  const fileRef = useRef(null);

  const dirty = useMemo(() => [...values.entries()].some(([item, texts]) => texts.some((text, index) => text !== (serverValues.get(item)?.[index] ?? ''))), [values, serverValues]);

  // Izgara yalnızca gösterilen sürüm (kimlik + damga) ya da kalem listesi değişince baştan kurulur —
  // ilgisiz bir canlı tazeleme (gerçekleşen gider, AI yorumu) kaydedilmemiş girişi silmesin. Kullanıcının
  // kaydedilmemiş değişikliği varken başkası kaydettiyse girişler korunur, uyarı gösterilir.
  const versionKey = shown ? `${shown.id}|${shown.updatedAt}|${items.map((item) => `${item.item}:${item.label}`).join(',')}` : 'none';
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const lastKey = useRef(versionKey);
  // Kendi kaydımızdan sonraki ilk sürüm: ızgara sunucudan kurulur (biçim farkı "değişiklik" sayılmasın).
  const resetNext = useRef(false);
  useEffect(() => {
    const sameVersion = lastKey.current.split('|')[0] === versionKey.split('|')[0];
    lastKey.current = versionKey;
    if (dirtyRef.current && sameVersion && !resetNext.current) {
      setServerChanged(true);
      return;
    }
    resetNext.current = false;
    setValues(serverValues);
    setErrors({});
    setServerChanged(false);
  }, [versionKey]);

  function reload() {
    setValues(serverValues);
    setErrors({});
    setServerChanged(false);
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey: budgetKeys.all });

  const create = useMutation({
    mutationFn: () => apiPost('/budgets', { year }),
    onSuccess: () => {
      toastSuccess(`${year} bütçe taslağı açıldı`);
      refresh();
    },
    onError: (error) => toastError(error.message),
  });
  const save = useMutation({
    mutationFn: (body) => apiPut(`/budgets/versions/${shown.id}/lines`, body),
    onSuccess: () => {
      resetNext.current = true;
      toastSuccess('Bütçe kaydedildi');
      refresh();
    },
    onError: (error) => {
      toastError(errorText(error));
      if (error?.code === 'STALE_WRITE') refresh();
    },
  });
  const approve = useMutation({
    mutationFn: () => apiPost(`/budgets/versions/${shown.id}/approve`, { expectedUpdatedAt: shown.updatedAt }),
    onSuccess: () => {
      toastSuccess(`${year} bütçesi onaylandı ve kilitlendi`);
      setDialog(null);
      setView('APPROVED');
      refresh();
    },
  });

  function change(item, month, text) {
    setValues((current) => {
      const next = new Map(current);
      const texts = [...(next.get(item) ?? [])];
      texts[month] = text;
      next.set(item, texts);
      return next;
    });
  }

  function submit() {
    const body = {
      expectedUpdatedAt: shown.updatedAt,
      lines: [...values.entries()].map(([item, texts]) => ({ item, months: texts.map((text) => parseCell(text)) })).filter((line) => line.months.some((value) => value !== null)),
    };
    const checked = saveBudgetLinesSchema.safeParse(body);
    if (!checked.success) {
      const next = {};
      for (const issue of checked.error.issues) {
        const [, lineIndex, , month] = issue.path;
        const line = body.lines[lineIndex];
        if (line && Number.isInteger(month)) next[`${line.item}|${month}`] = issue.message;
      }
      setErrors(next);
      toastError(`${Object.keys(next).length || checked.error.issues.length} hücre hatalı; işaretli hücreleri düzeltin.`);
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const result = await readBudgetTemplate(file, { items });
      setImportErrors(result.errors);
      if (!result.lines.length) return;
      setValues((current) => {
        const next = new Map(current);
        for (const line of result.lines) next.set(line.item, line.months.map((value) => (value === null ? '' : value.replace('.', ','))));
        return next;
      });
      toastSuccess(`${result.lines.length} kalem dosyadan alındı; kontrol edip kaydedin.`);
    } catch (error) {
      setImportErrors([`Dosya okunamadı: ${error.message}`]);
    }
  }

  async function download() {
    try {
      const lines = new Map([...values.entries()].map(([item, texts]) => [item, texts.map((text) => parseCell(text))]));
      await downloadBudgetTemplate({ year, items, lines });
    } catch (error) {
      toastError(`Şablon hazırlanamadı: ${error.message}`);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Bütçe" description="Yılın bütçesi ay ay: gelirler, doluluk ve ADR hedefleri, giderler. Tutarlar vergiler hariç, otelin para biriminde. Onaylanan bütçe kilitlenir; değişiklik revizeyle." />
      <BudgetTabs year={year} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <YearPicker year={year} currentYear={currentYear} onChange={setYear} />
        {data && <VersionBadges data={data} view={shown?.status} onView={setView} />}
      </div>

      {query.isPending && <Spinner label="Bütçe yükleniyor…" className="py-12" />}
      {query.isError && <QueryError query={query} title="Bütçe yüklenemedi" />}

      {data && !shown && (
        <EmptyState
          icon="wallet"
          title={`${year} bütçesi yok`}
          description="Bütçe açılınca ızgaraya ay ay plan girilir ya da Excel şablonu doldurulup yüklenir."
          action={can(PERMISSIONS.BUDGET_MANAGE) ? <Button icon="plus" onClick={() => create.mutate()} disabled={create.isPending}>{year} bütçesini aç</Button> : null}
        />
      )}

      {shown && (
        <Card
          title={`${year} · ${BUDGET_STATUS_LABELS[shown.status]} (sürüm ${shown.version})`}
          description={versionNote(shown)}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" icon="download" onClick={download}>
                {editable ? 'Excel şablonu' : 'Excel olarak indir'}
              </Button>
              {editable && (
                <>
                  <Button variant="outline" size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
                    Excel'den yükle
                  </Button>
                  <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={importFile} aria-label="Bütçe Excel dosyası" />
                  <Button variant="ghost" size="sm" icon="sliders" onClick={() => setDialog('items')}>
                    Gider kalemleri
                  </Button>
                </>
              )}
              {shown.status === 'DRAFT' && can(PERMISSIONS.BUDGET_APPROVE) && (
                <Button size="sm" icon="lock" onClick={() => setDialog('approve')} disabled={dirty} title={dirty ? 'Önce değişiklikleri kaydedin' : undefined}>
                  Onayla
                </Button>
              )}
              {shown.status === 'APPROVED' && !data.draft && can(PERMISSIONS.BUDGET_APPROVE) && (
                <Button variant="outline" size="sm" icon="pencil" onClick={() => setDialog('revise')}>
                  Revize aç
                </Button>
              )}
            </div>
          }
        >
          <div className={`flex flex-col gap-3 transition-opacity ${query.isFetching && !query.isPending ? 'opacity-60' : ''}`}>
            {serverChanged && (
              <Alert
                tone="warning"
                title="Bütçe bu arada başkası tarafından değiştirildi"
                action={
                  <Button size="sm" variant="outline" icon="refresh" onClick={reload}>
                    Güncelini yükle
                  </Button>
                }
              >
                Kaydedilmemiş girişleriniz duruyor; ama kaydederseniz sürüm uyuşmazlığı alırsınız. Güncel bütçeyi yükleyip (girişleriniz silinir) değişikliklerinizi yeniden girin.
              </Alert>
            )}
            {importErrors.length > 0 && (
              <Alert tone="warning" title="Dosyadaki bazı satırlar alınmadı">
                <ul className="list-disc pl-5">
                  {importErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <BudgetGrid items={items} values={values} editable={editable} errors={errors} onChange={change} currency={data.currency} />
            {editable && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {dirty && <span className="text-sm text-warning-ink">Kaydedilmemiş değişiklik var</span>}
                <Button variant="ghost" onClick={reload} disabled={!dirty || save.isPending}>
                  Vazgeç
                </Button>
                <Button icon="check" onClick={submit} disabled={!dirty || save.isPending}>
                  {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {dialog === 'items' && <ExpenseItemsDialog onClose={() => setDialog(null)} />}
      {dialog === 'revise' && <ReviseDialog year={year} onClose={() => setDialog(null)} onDone={() => setView('DRAFT')} />}
      <ConfirmDialog
        open={dialog === 'approve'}
        title={`${year} bütçesini onayla`}
        message={`Onaylanan bütçe kilitlenir; sapma raporu bu sürüme göre çıkar.${data?.approved ? ` Önceki onaylı sürüm (${data.approved.version}) eski sürüm olarak saklanır.` : ''} Sonradan değişiklik için revize açılır.`}
        confirmLabel="Onayla"
        confirmVariant="primary"
        confirmIcon="lock"
        onConfirm={() => approve.mutate()}
        onClose={() => {
          approve.reset();
          setDialog(null);
        }}
        isPending={approve.isPending}
        error={approve.error ? { ...approve.error, message: errorText(approve.error) } : null}
      />
    </div>
  );
}

/** @param {{ data: any, view: string | undefined, onView: (view: 'DRAFT' | 'APPROVED') => void }} props */
function VersionBadges({ data, view, onView }) {
  if (!data.draft || !data.approved) return null;
  return (
    <div className="flex gap-1.5" role="group" aria-label="Gösterilen sürüm">
      {[
        ['APPROVED', `Onaylı (sürüm ${data.approved.version})`],
        ['DRAFT', `Revize taslağı (sürüm ${data.draft.version})`],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => onView(key)}
          className={`rounded-full border px-3 py-1 text-sm font-semibold ${view === key ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** @param {any} version */
function versionNote(version) {
  if (version.status === 'APPROVED') return `${formatDate(version.approvedAt)} tarihinde ${version.approvedBy} onayladı. Kilitli.`;
  const reason = version.reason ? ` Revize gerekçesi: ${version.reason}` : '';
  return `Taslak — sapma raporu onaylanana kadar bu taslağa göre (işaretli) çıkar.${reason}`;
}

