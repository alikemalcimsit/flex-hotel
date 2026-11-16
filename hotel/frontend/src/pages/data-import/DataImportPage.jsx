import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IMPORT_KIND_LABELS, suggestImportMapping } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { formatDateTime } from '../../lib/format.js';
import { IMPORT_TARGET_LINKS, downloadImportTemplate, importKindsFor, mapImportRows, missingRequired, readImportFile } from '../../lib/dataImport.js';
import { useImportHistory, useRunImport } from '../../lib/dataImportQueries.js';
import { useCan } from '../../lib/permissions.js';
import { toastError } from '../../store/toast.js';
import { MappingTable, ResultTable } from './ImportSteps.jsx';

/**
 * Excel'den yükle (modül 26): misafir listesi ya da fiyat planı. Sihirbaz: tür → şablon / dosya → sütun eşleştirme →
 * denetle (sunucu satır satır doğrular; sistemde olan misafir "zaten var" diye atlanır, çakışan fiyat planı hatadır)
 * → hatasızsa içe aktar. Denetim ve yükleme aynı yükleme kimliğini taşır: çift tıklama ikinci kez yazmaz.
 */
export function DataImportPage() {
  const can = useCan();
  const kinds = importKindsFor(can);
  const [kind, setKind] = useState(kinds[0] ?? 'GUESTS');
  const history = useImportHistory({ enabled: kinds.length > 0 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Excel'den yükle"
        description="Misafir listesini ya da fiyat planlarını Excel'den toplu yükleyin. Dosyanın sütunlarını alanlarla eşleştirin, satırlar denetlensin; hata yoksa tek seferde içe aktarılır."
      />
      {kinds.length === 0 ? (
        <Card>
          <EmptyState icon="upload" title="Yükleme yetkiniz yok" description="Misafir yükleme misafir yönetimi, fiyat planı yükleme ayar yönetimi yetkisi ister." />
        </Card>
      ) : (
        <>
          <ChoiceChips label="Ne yüklenecek?" options={kinds.map((value) => ({ value, label: IMPORT_KIND_LABELS[value] }))} value={kind} onChange={(value) => value && setKind(value)} />
          <ImportWizard key={kind} kind={kind} />
          <ImportHistory query={history} />
        </>
      )}
    </div>
  );
}

/** @param {{ kind: string }} props */
function ImportWizard({ kind }) {
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [file, setFile] = useState(/** @type {{ name: string, headers: string[], rows: unknown[][] } | null} */ (null));
  const [fileErrors, setFileErrors] = useState(/** @type {string[]} */ ([]));
  const [mapping, setMapping] = useState(/** @type {Record<string, number | null>} */ ({}));
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [checked, setChecked] = useState(/** @type {any} */ (null));
  const [done, setDone] = useState(/** @type {any} */ (null));
  const [reading, setReading] = useState(false);
  const runImport = useRunImport();
  const missing = file ? missingRequired(kind, mapping) : [];

  async function pickFile(event) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    setReading(true);
    try {
      const parsed = await readImportFile(picked);
      setFileErrors(parsed.errors);
      setFile(parsed.errors.length ? null : { name: picked.name, headers: parsed.headers, rows: parsed.rows });
      setMapping(parsed.errors.length ? {} : suggestImportMapping(kind, parsed.headers));
      setRequestId(crypto.randomUUID());
      setChecked(null);
      setDone(null);
    } catch (failure) {
      setFileErrors([`Dosya okunamadı: ${failure.message}`]);
      setFile(null);
    } finally {
      setReading(false);
    }
  }

  function changeMapping(next) {
    setMapping(next);
    setChecked(null);
  }

  function send(dryRun) {
    const body = { requestId, dryRun, fileName: file.name, rows: mapImportRows(file.rows, mapping) };
    runImport.mutate(
      { kind, body },
      {
        onSuccess: (result) => (dryRun ? setChecked(result) : setDone(result)),
        onError: (error) => toastError(error.message),
      },
    );
  }

  async function template() {
    try {
      await downloadImportTemplate(kind);
    } catch (failure) {
      toastError(`Şablon hazırlanamadı: ${failure.message}`);
    }
  }

  function restart() {
    setFile(null);
    setMapping({});
    setChecked(null);
    setDone(null);
    setFileErrors([]);
    setRequestId(crypto.randomUUID());
  }

  if (done) {
    const target = IMPORT_TARGET_LINKS[kind];
    return (
      <Card>
        <div className="flex flex-col gap-4">
          <Alert tone="success" title={`${done.created} kayıt içe aktarıldı`}>
            {done.skipped > 0 ? `${done.skipped} satır sistemde zaten olduğu için atlandı.` : 'Atlanan satır yok.'}
            {done.replayed ? ' (Bu yükleme daha önce yapılmıştı; yeniden yazılmadı.)' : ''}
          </Alert>
          <ResultTable kind={kind} result={done} />
          <div className="flex flex-wrap gap-3">
            <Link to={target.to} className="text-sm font-semibold text-info-ink underline-offset-2 hover:underline">
              {target.label}
            </Link>
            <Button size="sm" variant="outline" icon="upload" onClick={restart}>
              Yeni dosya yükle
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold">1. Dosya</h2>
          <p className="text-sm text-ink-muted">Şablonu indirip doldurabilir ya da kendi dosyanızı seçebilirsiniz; ilk satır başlık olmalı. En fazla 2000 satır.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" icon="download" onClick={template}>
              Şablonu indir
            </Button>
            <Button icon="upload" onClick={() => inputRef.current?.click()} disabled={reading}>
              {reading ? 'Okunuyor…' : file ? 'Başka dosya seç' : 'Dosya seç (.xlsx)'}
            </Button>
            <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={pickFile} aria-label="Excel dosyası" />
            {file && (
              <span className="text-sm text-ink-muted">
                {file.name} · {file.rows.length} satır
              </span>
            )}
          </div>
          {fileErrors.length > 0 && <Alert tone="danger">{fileErrors.join(' ')}</Alert>}
        </section>

        {file && (
          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <h2 className="text-base font-bold">2. Sütunları eşleştirin</h2>
            <p className="text-sm text-ink-muted">Başlık adlarından önerildi; yanlışsa değiştirin. Yıldızlı alanlar zorunlu.</p>
            <MappingTable kind={kind} headers={file.headers} rows={file.rows} mapping={mapping} onChange={changeMapping} />
            {missing.length > 0 && <Alert tone="warning">Eşlenmemiş zorunlu alan: {missing.join(', ')}</Alert>}
            <div>
              <Button icon="checkCircle" onClick={() => send(true)} disabled={missing.length > 0 || runImport.isPending}>
                {runImport.isPending && !checked ? 'Denetleniyor…' : 'Denetle'}
              </Button>
            </div>
          </section>
        )}

        {file && checked && (
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <h2 className="text-base font-bold">3. Denetim sonucu</h2>
            <ResultTable kind={kind} result={checked} />
            {checked.summary.errors > 0 && <Alert tone="danger">Hatalı satırlar varken yükleme yapılmaz. Excel'de düzeltip dosyayı yeniden seçin ya da eşleştirmeyi değiştirip yeniden denetleyin.</Alert>}
            <div>
              <Button icon="upload" onClick={() => send(false)} disabled={checked.summary.errors > 0 || checked.summary.ok === 0 || runImport.isPending}>
                {runImport.isPending ? 'İçe aktarılıyor…' : `İçe aktar (${checked.summary.ok} kayıt)`}
              </Button>
            </div>
          </section>
        )}
      </div>
    </Card>
  );
}

/** @param {{ query: any }} props */
function ImportHistory({ query }) {
  const items = query.data?.items ?? [];
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-bold">Yükleme geçmişi</h2>
        {query.isPending || query.isError ? (
          <QueryFallback query={query} errorTitle="Yükleme geçmişi okunamadı" />
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-muted">Henüz yükleme yapılmadı.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-semibold">{IMPORT_KIND_LABELS[item.kind] ?? item.kind}</span>
                  {item.fileName ? ` · ${item.fileName}` : ''}
                </span>
                <span className="text-xs text-ink-muted">
                  {item.created} yüklendi · {item.skipped} atlandı · {item.total} satır · {item.createdBy} · {formatDateTime(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
