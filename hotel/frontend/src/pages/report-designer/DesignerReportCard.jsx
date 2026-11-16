import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card } from '@hotelos/ui';
import { formatDateTime } from '../../lib/format.js';
import { downloadReportExcel } from '../../lib/reportChat.js';
import { designSummary, designerChart, designerEditPath } from '../../lib/reportDesigner.js';
import { useRunDefinition, useUpdateDefinition } from '../../lib/reportDesignerQueries.js';
import { toastError } from '../../store/toast.js';
import { ReportResult } from '../report-chat/ReportResult.jsx';

/**
 * Kayıtlı raporlar ekranında tasarım raporu (modül 26): çalıştır (dönem filtreleri bugüne göre) + Excel; sahibi
 * düzenler, yeniden adlandırır, paylaşır, siler. Kaynağı görme yetkisi olmayan kullanıcı çalıştıramaz.
 *
 * @param {{ definition: any, canEdit: boolean, onRename: (definition: any) => void, onDelete: (definition: any) => void }} props
 */
export function DesignerReportCard({ definition, canEdit, onRename, onDelete }) {
  const navigate = useNavigate();
  const run = useRunDefinition();
  const share = useUpdateDefinition();
  const result = run.data;

  async function exportExcel() {
    try {
      await downloadReportExcel({ title: definition.title, periodLabel: designSummary(definition.design), dataset: result.dataset });
    } catch (failure) {
      toastError(`Excel hazırlanamadı: ${failure.message}`);
    }
  }

  function toggleShare() {
    share.mutate(
      { id: definition.id, body: { expectedUpdatedAt: definition.updatedAt, shared: !definition.shared }, message: definition.shared ? 'Paylaşım kaldırıldı' : 'Rapor otelle paylaşıldı' },
      { onError: (error) => toastError(error.message) },
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">{definition.title}</h2>
              <Badge tone="violet">Tasarım</Badge>
              {definition.shared && <Badge tone="info">Paylaşılan</Badge>}
            </div>
            <p className="text-xs text-ink-muted">
              {designSummary(definition.design)}
              {!definition.isMine && ` · ${definition.owner}`}
              {` · Son çalıştırma: ${definition.lastRunAt ? formatDateTime(definition.lastRunAt) : 'hiç'}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <Button size="sm" variant="ghost" icon="sliders" onClick={() => navigate(designerEditPath(definition.id))}>
                  Düzenle
                </Button>
                <Button size="sm" variant="ghost" icon="pencil" onClick={() => onRename(definition)}>
                  Yeniden adlandır
                </Button>
                <Button size="sm" variant="ghost" icon="users" onClick={toggleShare} disabled={share.isPending}>
                  {definition.shared ? 'Paylaşmayı kaldır' : 'Paylaş'}
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => onDelete(definition)}>
                  Sil
                </Button>
              </>
            )}
            {!canEdit && definition.allowed && (
              <Button size="sm" variant="ghost" icon="sliders" onClick={() => navigate(designerEditPath(definition.id))}>
                Aç / farklı kaydet
              </Button>
            )}
            {result && (
              <Button size="sm" variant="outline" icon="download" onClick={exportExcel}>
                Excel'e aktar
              </Button>
            )}
            {definition.allowed ? (
              <Button size="sm" icon={result ? 'refresh' : 'play'} onClick={() => run.mutate(definition.id)} disabled={run.isPending}>
                {run.isPending ? 'Çalışıyor…' : result ? 'Yeniden çalıştır' : 'Çalıştır'}
              </Button>
            ) : (
              <span className="self-center text-xs font-semibold text-ink-muted">Bu kaynağı görme yetkiniz yok</span>
            )}
          </div>
        </header>
        {result && (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <p className="text-xs font-semibold text-ink-soft">
              {result.rowCount} satır{result.truncated ? ` (ilk ${result.dataset.rows.length} gösteriliyor)` : ''}
            </p>
            <ReportResult dataset={result.dataset} chart={designerChart(definition.design, result.dataset)} />
          </div>
        )}
      </div>
    </Card>
  );
}
