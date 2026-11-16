import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SAVED_REPORT_SCOPES, SAVED_REPORT_SCOPE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Card, EmptyState } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { formatDateTime } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { REPORT_CHAT_PATH, downloadReportExcel, specLabel } from '../../lib/reportChat.js';
import { useDeleteSavedReport, useRunSavedReport, useSavedReports, useUpdateSavedReport } from '../../lib/reportChatQueries.js';
import { toastError } from '../../store/toast.js';
import { RenameReportDialog } from './ReportChatDialogs.jsx';
import { ReportResult } from './ReportResult.jsx';

/**
 * Kayıtlı raporlar (modül 24): benim raporlarım ve otelle paylaşılanlar. "Çalıştır" AI kullanmaz: tanım bugüne göre
 * çözülür ("geçen ay" kayar), rapor güncel veriyle hazırlanır. Düzeltme / paylaşım / silme yalnız sahibinde.
 */
export function SavedReportsPage() {
  const can = useCan();
  const canAsk = can(PERMISSIONS.REPORTS_ASK);
  const [scope, setScope] = useState('MINE');
  const reports = useSavedReports(scope);
  const [renaming, setRenaming] = useState(/** @type {any} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const remove = useDeleteSavedReport({ onDone: () => setDeleting(null) });
  const items = reports.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ChoiceChips label="Görünüm" options={SAVED_REPORT_SCOPES.map((value) => ({ value, label: SAVED_REPORT_SCOPE_LABELS[value] }))} value={scope} onChange={(value) => value && setScope(value)} />
        {canAsk && (
          <Link to={REPORT_CHAT_PATH} className="text-sm font-semibold text-info-ink underline-offset-2 hover:underline">
            Rapor asistanına yeni soru sor
          </Link>
        )}
      </div>

      {reports.isPending || reports.isError ? (
        <QueryFallback query={reports} errorTitle="Kayıtlı raporlar yüklenemedi" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="fileText"
            title={scope === 'MINE' ? 'Henüz kayıtlı raporunuz yok' : 'Paylaşılan rapor yok'}
            description={scope === 'MINE' ? 'Rapor asistanına sorun; beğendiğiniz cevabı "Kaydet" ile buraya ekleyin.' : 'Bir rapor "otelle paylaş" işaretlenince burada görünür.'}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((report) => (
            <SavedReportCard key={report.id} report={report} canEdit={canAsk && report.isMine} onRename={setRenaming} onDelete={setDeleting} />
          ))}
        </div>
      )}

      {renaming && <RenameReportDialog report={renaming} onClose={() => setRenaming(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Kayıtlı raporu sil"
        message={deleting ? `"${deleting.title}" silinsin mi? Paylaştıysanız başkalarının listesinden de kalkar.` : ''}
        onConfirm={() => remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
        isPending={remove.isPending}
        error={remove.error}
      />
    </div>
  );
}

/**
 * @param {{ report: any, canEdit: boolean, onRename: (report: any) => void, onDelete: (report: any) => void }} props
 */
function SavedReportCard({ report, canEdit, onRename, onDelete }) {
  const run = useRunSavedReport();
  const share = useUpdateSavedReport();
  const result = run.data;

  async function exportExcel() {
    try {
      await downloadReportExcel({ title: report.title, periodLabel: result.periodLabel, dataset: result.dataset });
    } catch (failure) {
      toastError(`Excel hazırlanamadı: ${failure.message}`);
    }
  }

  function toggleShare() {
    share.mutate(
      { id: report.id, body: { expectedUpdatedAt: report.updatedAt, shared: !report.shared }, message: report.shared ? 'Paylaşım kaldırıldı' : 'Rapor otelle paylaşıldı' },
      { onError: (error) => toastError(error.message) },
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">{report.title}</h2>
              {report.shared && <Badge tone="info">Paylaşılan</Badge>}
            </div>
            <p className="text-sm text-ink-muted">"{report.question}"</p>
            <p className="text-xs text-ink-muted">
              Rapor: {specLabel(report.spec)}
              {!report.isMine && ` · ${report.owner}`}
              {` · Son çalıştırma: ${report.lastRunAt ? formatDateTime(report.lastRunAt) : 'hiç'}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <Button size="sm" variant="ghost" icon="pencil" onClick={() => onRename(report)}>
                  Yeniden adlandır
                </Button>
                <Button size="sm" variant="ghost" icon="users" onClick={toggleShare} disabled={share.isPending}>
                  {report.shared ? 'Paylaşmayı kaldır' : 'Paylaş'}
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => onDelete(report)}>
                  Sil
                </Button>
              </>
            )}
            {result && (
              <Button size="sm" variant="outline" icon="download" onClick={exportExcel}>
                Excel'e aktar
              </Button>
            )}
            <Button size="sm" icon={result ? 'refresh' : 'play'} onClick={() => run.mutate(report.id)} disabled={run.isPending}>
              {run.isPending ? 'Çalışıyor…' : result ? 'Yeniden çalıştır' : 'Çalıştır'}
            </Button>
          </div>
        </header>
        {result && (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <p className="text-xs font-semibold text-ink-soft">{result.periodLabel}</p>
            <ReportResult dataset={result.dataset} chart={result.chart} />
          </div>
        )}
      </div>
    </Card>
  );
}
