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
import { REPORT_DESIGNER_PATH } from '../../lib/reportDesigner.js';
import { useDeleteDefinition, useDesignerDefinitions } from '../../lib/reportDesignerQueries.js';
import { toastError } from '../../store/toast.js';
import { RenameDefinitionDialog } from '../report-designer/DesignerDialogs.jsx';
import { DesignerReportCard } from '../report-designer/DesignerReportCard.jsx';
import { RenameReportDialog } from './ReportChatDialogs.jsx';
import { ReportResult } from './ReportResult.jsx';

/**
 * Kayıtlı raporlar (modül 24 + 26): rapor asistanının raporları ve tasarımcıda kurulan raporlar birlikte — benim
 * raporlarım ve otelle paylaşılanlar, en son değişen önce. "Çalıştır" AI kullanmaz: tanım bugüne göre çözülür ("geçen
 * ay" kayar), rapor güncel veriyle hazırlanır. Düzeltme / paylaşım / silme yalnız sahibinde.
 */
export function SavedReportsPage() {
  const can = useCan();
  const canAsk = can(PERMISSIONS.REPORTS_ASK);
  const [scope, setScope] = useState('MINE');
  const reports = useSavedReports(scope);
  const definitions = useDesignerDefinitions(scope);
  const [renaming, setRenaming] = useState(/** @type {{ type: 'ASSISTANT' | 'DESIGN', item: any } | null} */ (null));
  const [deleting, setDeleting] = useState(/** @type {{ type: 'ASSISTANT' | 'DESIGN', item: any } | null} */ (null));
  const removeSaved = useDeleteSavedReport({ onDone: () => setDeleting(null) });
  const removeDefinition = useDeleteDefinition({ onDone: () => setDeleting(null) });
  const remove = deleting?.type === 'DESIGN' ? removeDefinition : removeSaved;
  const items = [
    ...(reports.data?.items ?? []).map((item) => ({ type: 'ASSISTANT', item })),
    ...(definitions.data?.items ?? []).map((item) => ({ type: 'DESIGN', item })),
  ].sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
  const loading = reports.isPending || definitions.isPending;
  const failed = reports.isError ? reports : definitions.isError ? definitions : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ChoiceChips label="Görünüm" options={SAVED_REPORT_SCOPES.map((value) => ({ value, label: SAVED_REPORT_SCOPE_LABELS[value] }))} value={scope} onChange={(value) => value && setScope(value)} />
        <div className="flex flex-wrap gap-4">
          <Link to={REPORT_DESIGNER_PATH} className="text-sm font-semibold text-info-ink underline-offset-2 hover:underline">
            Yeni rapor tasarla
          </Link>
          {canAsk && (
            <Link to={REPORT_CHAT_PATH} className="text-sm font-semibold text-info-ink underline-offset-2 hover:underline">
              Rapor asistanına yeni soru sor
            </Link>
          )}
        </div>
      </div>

      {loading || failed ? (
        <QueryFallback query={failed ?? reports} errorTitle="Kayıtlı raporlar yüklenemedi" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="fileText"
            title={scope === 'MINE' ? 'Henüz kayıtlı raporunuz yok' : 'Paylaşılan rapor yok'}
            description={
              scope === 'MINE'
                ? 'Rapor tasarımcısında kurduğunuz ya da rapor asistanının cevabından "Kaydet" dediğiniz raporlar burada.'
                : 'Bir rapor "otelle paylaş" işaretlenince burada görünür.'
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map(({ type, item }) =>
            type === 'DESIGN' ? (
              <DesignerReportCard
                key={`design-${item.id}`}
                definition={item}
                canEdit={item.isMine}
                onRename={(definition) => setRenaming({ type, item: definition })}
                onDelete={(definition) => setDeleting({ type, item: definition })}
              />
            ) : (
              <SavedReportCard
                key={`assistant-${item.id}`}
                report={item}
                canEdit={canAsk && item.isMine}
                onRename={(report) => setRenaming({ type, item: report })}
                onDelete={(report) => setDeleting({ type, item: report })}
              />
            ),
          )}
        </div>
      )}

      {renaming?.type === 'ASSISTANT' && <RenameReportDialog report={renaming.item} onClose={() => setRenaming(null)} />}
      {renaming?.type === 'DESIGN' && <RenameDefinitionDialog definition={renaming.item} onClose={() => setRenaming(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Kayıtlı raporu sil"
        message={deleting ? `"${deleting.item.title}" silinsin mi? Paylaştıysanız başkalarının listesinden de kalkar.` : ''}
        onConfirm={() => remove.mutate(deleting.item.id)}
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
              <Badge tone="sky">Asistan</Badge>
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
