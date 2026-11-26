import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_REVIEW_IMPORT_ROWS, REVIEW_SOURCE_LABELS, REVIEW_SOURCE_SCALES, REVIEW_SOURCES, suggestReviewMapping } from '@hotelos/hotel-contracts';
import { Alert, Button, Select } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { newRequestId } from '../../lib/reservations.js';
import { hasReviewTextColumn, missingReviewFields, readReviewFile, reviewImportRows, reviewKeys } from '../../lib/reviews.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ReviewDialog } from './ReviewDialog.jsx';
import { ReviewMappingTable, ReviewResultTable } from './ReviewImportSteps.jsx';

const SOURCE_OPTIONS = REVIEW_SOURCES.map((value) => ({ value, label: `${REVIEW_SOURCE_LABELS[value]} (puan / ${REVIEW_SOURCE_SCALES[value]})` }));
const ACCEPT = '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * "Dosyadan yükle" (modül 54, `reviews.manage`): kaynak → dosya (.xlsx / .csv) → sütun eşleştirme (Booking / Google başlıkları
 * kendiliğinden) → önizleme (`dryRun`) → içe aktar (aynı istek kimliğiyle; çift tıklama ikinci kez yazmaz). Hatalı satır
 * varken içe aktarılmaz.
 * @param {{ onClose: () => void }} props
 */
export function ReviewImportDialog({ onClose }) {
  const queryClient = useQueryClient();
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [source, setSource] = useState('BOOKING');
  const [file, setFile] = useState(/** @type {{ name: string, headers: string[], rows: unknown[][] } | null} */ (null));
  const [fileErrors, setFileErrors] = useState(/** @type {string[]} */ ([]));
  const [mapping, setMapping] = useState(/** @type {Record<string, number | null>} */ ({}));
  const [requestId, setRequestId] = useState(newRequestId);
  const [preview, setPreview] = useState(/** @type {any} */ (null));
  const [done, setDone] = useState(/** @type {any} */ (null));
  const [failedRows, setFailedRows] = useState(/** @type {any[] | null} */ (null));
  const [reading, setReading] = useState(false);
  const missing = file ? missingReviewFields(mapping) : [];
  const noText = file ? !hasReviewTextColumn(mapping) : false;

  const run = useMutation({
    mutationFn: (/** @type {boolean} */ dryRun) => apiPost('/reviews/import', { requestId, dryRun, source, fileName: file?.name ?? null, rows: reviewImportRows(file?.rows ?? [], mapping) }),
    onSuccess: (result) => {
      if (result.dryRun) return setPreview(result);
      queryClient.invalidateQueries({ queryKey: reviewKeys.all });
      toastSuccess(result.replayed ? 'Bu yükleme daha önce yapılmıştı' : `${result.summary.ok} yorum içe aktarıldı`);
      setDone(result);
    },
    onError: (error) => {
      if (Array.isArray(error.details?.rows)) setFailedRows(error.details.rows);
      toastError(error.message);
    },
  });

  /** Eşleştirme / kaynak değişince önizleme geçersiz; yeni istek kimliği. */
  const invalidate = () => {
    setPreview(null);
    setFailedRows(null);
    setRequestId(newRequestId());
  };

  async function pickFile(event) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    setReading(true);
    try {
      const parsed = await readReviewFile(picked);
      setFileErrors(parsed.errors);
      setFile(parsed.errors.length ? null : { name: picked.name, headers: parsed.headers, rows: parsed.rows });
      setMapping(parsed.errors.length ? {} : suggestReviewMapping(parsed.headers));
      invalidate();
    } catch (failure) {
      setFileErrors([`Dosya okunamadı: ${failure instanceof Error ? failure.message : String(failure)}`]);
      setFile(null);
    } finally {
      setReading(false);
    }
  }

  if (done) {
    return (
      <ReviewDialog title="Yorumlar yüklendi" onClose={onClose} size="lg">
        <div className="flex flex-col gap-4">
          <Alert tone="success" title={`${done.summary.ok} yorum eklendi`}>
            {done.summary.skipped > 0 ? `${done.summary.skipped} satır zaten kayıtlı olduğu için atlandı. ` : ''}
            Yeni yorumlar AI analizine sırayla gider.
          </Alert>
          {done.rows.length > 0 && <ReviewResultTable result={done} />}
        </div>
      </ReviewDialog>
    );
  }

  const busy = run.isPending;
  return (
    <ReviewDialog
      title="Dosyadan yorum yükle"
      onClose={onClose}
      busy={busy}
      size="xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          {file && !preview && (
            <Button type="button" icon="eye" onClick={() => run.mutate(true)} disabled={busy || missing.length > 0 || noText}>
              {busy ? 'Denetleniyor…' : 'Önizle'}
            </Button>
          )}
          {preview && (
            <Button type="button" icon="upload" onClick={() => run.mutate(false)} disabled={busy || preview.summary.errors > 0 || preview.summary.ok === 0}>
              {busy ? 'İçe aktarılıyor…' : `İçe aktar (${preview.summary.ok})`}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">1. Kaynak ve dosya</h3>
          <p className="text-xs text-ink-muted">Platformun dışa aktardığı Excel (.xlsx) ya da CSV; ilk satır başlık. En fazla {MAX_REVIEW_IMPORT_ROWS} satır. Puan kaynağın ölçeğinde okunur.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Kaynak"
              name="review-import-source"
              options={SOURCE_OPTIONS}
              value={source}
              disabled={busy}
              onChange={(event) => {
                setSource(event.target.value);
                invalidate();
              }}
              className="w-full sm:w-60"
            />
            <Button type="button" variant="outline" icon="upload" onClick={() => inputRef.current?.click()} disabled={reading || busy}>
              {reading ? 'Okunuyor…' : file ? 'Başka dosya' : 'Dosya seç'}
            </Button>
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={pickFile} aria-label="Yorum dosyası" />
            {file && <span className="pb-2 text-sm text-ink-muted">{file.name} · {file.rows.length} satır</span>}
          </div>
          {fileErrors.length > 0 && <Alert tone="danger">{fileErrors.join(' ')}</Alert>}
        </section>

        {file && (
          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <h3 className="text-sm font-bold">2. Sütunları eşleştirin</h3>
            <ReviewMappingTable
              headers={file.headers}
              rows={file.rows}
              mapping={mapping}
              disabled={busy}
              onChange={(next) => {
                setMapping(next);
                invalidate();
              }}
            />
            {missing.length > 0 && <Alert tone="warning">Eşlenmemiş zorunlu alan: {missing.join(', ')}</Alert>}
            {noText && <Alert tone="warning">Yorum, olumlu / olumsuz yorum ya da puan sütunlarından en az biri eşlenmeli.</Alert>}
          </section>
        )}

        {preview && (
          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <h3 className="text-sm font-bold">3. Önizleme</h3>
            <ReviewResultTable result={preview} />
            {preview.summary.errors > 0 && <Alert tone="danger">Hatalı satırlar varken yükleme yapılmaz: dosyayı düzeltip yeniden seçin ya da eşleştirmeyi değiştirin.</Alert>}
          </section>
        )}
        {failedRows && <ReviewResultTable result={{ rows: failedRows }} />}
      </div>
    </ReviewDialog>
  );
}
