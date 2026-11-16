import { useReducer, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DESIGNER_PREVIEW_ROWS, DESIGNER_SOURCES, DESIGNER_SOURCE_PERMISSIONS, reportDesignSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { useCan } from '../../lib/permissions.js';
import { SAVED_REPORTS_PATH, downloadReportExcel } from '../../lib/reportChat.js';
import { REPORT_DESIGNER_PATH, designPayload, designReducer, designSummary, designerChart, designerEditPath, emptyDesign, groupDesignErrors } from '../../lib/reportDesigner.js';
import { useDesignerDefinition, useRunDesign, useUpdateDefinition } from '../../lib/reportDesignerQueries.js';
import { validateWith } from '../../lib/validate.js';
import { toastError } from '../../store/toast.js';
import { ReportResult } from '../report-chat/ReportResult.jsx';
import { SaveDefinitionDialog } from './DesignerDialogs.jsx';
import { FiltersSection, SortSection } from './DesignerFilters.jsx';
import { ColumnsSection, GroupingSection, SourceSection } from './DesignerSections.jsx';

/**
 * Rapor tasarımcısı (modül 26): kaynak seç → sütunları seç / sırala → (isteğe bağlı) grupla → filtrele → sırala →
 * önizle → kaydet / Excel indir. `/raporlar/tasarim/:id` kayıtlı tasarımı açar: sahibi değişiklikleri kaydeder, diğerleri
 * "farklı kaydet" ile kendi kopyasını alır. Sorguyu sunucu yalnız katalogdaki sütunlardan kurar.
 */
export function ReportDesignerPage() {
  const { id } = useParams();
  const definition = useDesignerDefinition(id);
  if (!id) return <DesignerEditor definition={null} />;
  if (definition.isPending || definition.isError) return <QueryFallback query={definition} errorTitle="Kayıtlı rapor açılamadı" />;
  return <DesignerEditor key={definition.data.id} definition={definition.data} />;
}

/** @param {any} definition @param {(permission: string) => boolean} can */
function initialDesign(definition, can) {
  if (definition) return designReducer(emptyDesign(definition.design.source), { type: 'LOAD', design: definition.design });
  return emptyDesign(DESIGNER_SOURCES.find((source) => can(DESIGNER_SOURCE_PERMISSIONS[source])) ?? DESIGNER_SOURCES[0]);
}

/** @param {{ definition: any | null }} props */
function DesignerEditor({ definition }) {
  const can = useCan();
  const navigate = useNavigate();
  const [design, dispatch] = useReducer(designReducer, null, () => initialDesign(definition, can));
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [result, setResult] = useState(/** @type {any} */ (null));
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const run = useRunDesign();
  const update = useUpdateDefinition();
  const sections = groupDesignErrors(errors);
  const sourceAllowed = can(DESIGNER_SOURCE_PERMISSIONS[design.source]);
  const owned = Boolean(definition?.isMine);
  const title = definition?.title ?? 'Tasarım raporu';

  /** Şemayla doğrular; geçerliyse sunucuya gidecek tasarım. */
  function validDesign() {
    const checked = validateWith(reportDesignSchema, designPayload(design));
    if (!checked.ok) {
      setErrors(checked.errors);
      return null;
    }
    setErrors({});
    return checked.data;
  }

  function preview() {
    const data = validDesign();
    if (!data) return;
    run.mutate(
      { design: data, preview: true },
      {
        onSuccess: (response) => setResult({ ...response, design: data, chart: designerChart(data, response.dataset) }),
        onError: (error) => (Object.keys(error.fields ?? {}).length ? setErrors(error.fields) : toastError(error.message)),
      },
    );
  }

  async function exportExcel() {
    const data = validDesign();
    if (!data) return;
    setExporting(true);
    try {
      const response = await run.mutateAsync({ design: data, preview: false });
      await downloadReportExcel({ title, periodLabel: designSummary(data), dataset: response.dataset });
      if (response.truncated) toastError(`Rapor ${response.rowCount} satır; ilk ${data.limit} satır indirildi. Satır sınırını artırın ya da filtre ekleyin.`);
    } catch (failure) {
      toastError(`Excel hazırlanamadı: ${failure.message}`);
    } finally {
      setExporting(false);
    }
  }

  function saveChanges() {
    const data = validDesign();
    if (!data) return;
    update.mutate(
      { id: definition.id, body: { expectedUpdatedAt: definition.updatedAt, design: data }, message: 'Rapor güncellendi' },
      { onError: (error) => toastError(error.code === 'STALE_WRITE' ? 'Rapor başka bir yerde değişti; sayfayı yenileyip tekrar deneyin.' : error.message) },
    );
  }

  function openSave() {
    if (validDesign()) setSaving(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{definition ? definition.title : 'Yeni rapor'}</h2>
          {definition && !owned && <Badge tone="neutral">{definition.owner} paylaştı — değişiklik için farklı kaydedin</Badge>}
          {definition?.shared && owned && <Badge tone="info">Paylaşılan</Badge>}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {definition && (
            <Link to={REPORT_DESIGNER_PATH} className="font-semibold text-info-ink underline-offset-2 hover:underline">
              Yeni tasarım
            </Link>
          )}
          <Link to={SAVED_REPORTS_PATH} className="font-semibold text-info-ink underline-offset-2 hover:underline">
            Kayıtlı raporlar
          </Link>
        </div>
      </div>

      <SourceSection source={design.source} dispatch={dispatch} errors={sections.source} />
      <ColumnsSection design={design} dispatch={dispatch} errors={sections.columns} />
      <GroupingSection design={design} dispatch={dispatch} errors={sections.aggregates} />
      <FiltersSection design={design} dispatch={dispatch} errors={sections.filters} />
      <SortSection design={design} dispatch={dispatch} errors={[...sections.sort, ...sections.limit]} />

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">{designSummary(design)}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon="eye" onClick={preview} disabled={!sourceAllowed || run.isPending}>
                {run.isPending && !exporting ? 'Hazırlanıyor…' : 'Önizle'}
              </Button>
              <Button variant="outline" icon="download" onClick={exportExcel} disabled={!sourceAllowed || exporting}>
                {exporting ? 'Hazırlanıyor…' : 'Excel indir'}
              </Button>
              {owned && (
                <Button icon="check" onClick={saveChanges} disabled={update.isPending}>
                  {update.isPending ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}
                </Button>
              )}
              <Button variant={owned ? 'outline' : 'primary'} icon="fileText" onClick={openSave} disabled={!sourceAllowed}>
                {definition ? 'Farklı kaydet' : 'Kaydet'}
              </Button>
            </div>
          </div>
          {!sourceAllowed && <Alert tone="warning">Bu kaynağı görme yetkiniz yok; raporu çalıştıramazsınız.</Alert>}
          {result && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <p className="text-xs font-semibold text-ink-soft">
                {result.rowCount} satır{result.rowCount > DESIGNER_PREVIEW_ROWS ? ` (ilk ${DESIGNER_PREVIEW_ROWS} gösteriliyor; tamamı için Excel indirin)` : ''}
              </p>
              <ReportResult dataset={result.dataset} chart={result.chart} />
            </div>
          )}
        </div>
      </Card>

      {saving && (
        <SaveDefinitionDialog
          design={design}
          initialTitle={definition ? `${definition.title} (kopya)` : ''}
          onClose={() => setSaving(false)}
          onSaved={(saved) => {
            setSaving(false);
            navigate(designerEditPath(saved.id));
          }}
        />
      )}
    </div>
  );
}
