import { useState } from 'react';
import { ASSET_IMPORT_COLUMNS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { downloadAssetImportTemplate, readAssetImport } from '../../lib/assets.js';
import { useAssetImport } from '../../lib/assetQueries.js';
import { formatMoney } from '../../lib/format.js';

/**
 * Excel ile toplu yükleme (modül 46): şablon indir → doldur → seç → önizleme (sunucu her satırı doğrular,
 * kategori / konum / sicil adlarını kayda çevirir) → hatasızsa yükle. Aynı yükleme kimliğiyle ikinci kez gönderim
 * yeni kart açmaz. Önceki yıllarda ayrılmış amortisman satırda yazılır.
 */

const COLUMN_LABELS = Object.freeze(Object.fromEntries(ASSET_IMPORT_COLUMNS.map((column) => [column.key, column.label])));
/** Önizlemede ilk bu kadar satır gösterilir (hatalılar önce). */
const PREVIEW_ROWS = 200;

/** @param {{ onClose: () => void }} props */
export function AssetImportDialog({ onClose }) {
  const [requestId, setRequestId] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState(null);
  const [parseErrors, setParseErrors] = useState([]);
  const [reading, setReading] = useState(false);
  const preview = useAssetImport();
  const upload = useAssetImport();
  const report = preview.data;
  const busy = reading || preview.isPending || upload.isPending;
  const ready = Boolean(report && report.summary.invalid === 0 && rows?.length);

  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileName(file.name);
    setReading(true);
    setRows(null);
    preview.reset();
    upload.reset();
    // Yeni dosya yeni yükleme: önizleme ve yükleme aynı kimlikle gider (tekrar gönderim ikinci kart açmaz).
    const nextRequestId = crypto.randomUUID();
    setRequestId(nextRequestId);
    try {
      const parsed = await readAssetImport(file);
      setParseErrors(parsed.errors);
      if (parsed.errors.length) return;
      setRows(parsed.rows);
      preview.mutate({ requestId: nextRequestId, dryRun: true, rows: parsed.rows });
    } catch (failure) {
      setParseErrors([`Dosya okunamadı: ${failure.message}`]);
    } finally {
      setReading(false);
    }
  }

  function confirm() {
    upload.mutate({ requestId, dryRun: false, rows }, { onSuccess: (result) => !result.dryRun && onClose() });
  }

  const shown = report ? [...report.rows].sort((a, b) => Number(a.ok) - Number(b.ok) || a.index - b.index).slice(0, PREVIEW_ROWS) : [];
  return (
    <Modal
      open
      size="xl"
      title="Excel ile demirbaş yükle"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={upload.isPending}>
            Vazgeç
          </Button>
          <Button type="button" icon="upload" onClick={confirm} disabled={!ready || busy}>
            {upload.isPending ? 'Yükleniyor…' : ready ? `${report.summary.valid} demirbaşı yükle` : 'Yükle'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
          <li>Şablonu indirin; sarı başlıklı sütunlar zorunlu. Konum: oda numarası ya da Tanımlar'daki alan adı. Kategori: Tanımlar'daki ad. Zimmet: personel sicil no.</li>
          <li>Tarihleri GG.AA.YYYY, tutarları sayı olarak yazın. Önceki yıllarda ayrılmış amortisman varsa tutarı ve hangi yıla kadar olduğunu yazın.</li>
          <li>Dosyayı seçin: satırlar önce denetlenir, hata yoksa yüklenir.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" icon="download" onClick={() => downloadAssetImportTemplate()} disabled={busy}>
            Şablonu indir
          </Button>
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-control border border-line-strong px-4 py-2 text-sm font-semibold ${busy ? 'pointer-events-none opacity-50' : 'hover:bg-black/[0.04]'}`}>
            <input type="file" accept=".xlsx" className="sr-only" onChange={pick} disabled={busy} />
            {reading ? 'Okunuyor…' : 'Dosya seç (.xlsx)'}
          </label>
          {fileName && <span className="text-sm text-ink-muted">{fileName}</span>}
        </div>

        {parseErrors.length > 0 && (
          <Alert tone="danger" title="Dosya okunamadı">
            {parseErrors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </Alert>
        )}
        {preview.isPending && <p className="text-sm text-ink-muted">Satırlar denetleniyor…</p>}
        {report && (
          <>
            <Alert tone={report.summary.invalid ? 'warning' : 'success'} title={`${report.summary.total} satır: ${report.summary.valid} hazır${report.summary.invalid ? `, ${report.summary.invalid} hatalı` : ''}`}>
              {report.summary.invalid
                ? 'Hatalı satırları Excel\'de düzeltip dosyayı yeniden seçin; hepsi hazır olmadan yükleme yapılmaz.'
                : `Toplam tutar ${formatMoney(report.summary.totalCost)}. Yüklenince her satır için kod (DM-…) üretilir.`}
            </Alert>
            <div className="max-h-[22rem] overflow-auto rounded-card border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                  <tr>
                    <th className="px-3 py-2">Satır</th>
                    <th className="px-3 py-2">Demirbaş</th>
                    <th className="px-3 py-2">Kategori / konum</th>
                    <th className="px-3 py-2 text-right">Tutar</th>
                    <th className="px-3 py-2">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((row) => (
                    <tr key={row.index} className={row.ok ? '' : 'bg-danger-soft/40'}>
                      <td className="px-3 py-2 tabular-nums text-ink-muted">{row.index + 2}</td>
                      <td className="px-3 py-2">
                        <span className="block font-semibold">{row.preview?.name ?? rows?.[row.index]?.name ?? '—'}</span>
                        {row.preview?.employeeName && <span className="block text-xs text-ink-muted">Zimmet: {row.preview.employeeName}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="block">{row.preview?.categoryName ?? rows?.[row.index]?.category}</span>
                        <span className="block text-ink-muted">{row.preview?.locationLabel ?? rows?.[row.index]?.location}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.preview?.cost ?? rows?.[row.index]?.cost)}</td>
                      <td className="px-3 py-2">
                        {row.ok ? (
                          <Badge tone="success">Hazır</Badge>
                        ) : (
                          <ul className="space-y-0.5 text-xs text-danger-ink">
                            {row.errors.map((error) => (
                              <li key={`${error.field}-${error.message}`}>
                                {error.field && COLUMN_LABELS[error.field] ? `${COLUMN_LABELS[error.field]}: ` : ''}
                                {error.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.rows.length > PREVIEW_ROWS && <p className="text-xs text-ink-muted">İlk {PREVIEW_ROWS} satır gösteriliyor (hatalılar önce).</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
