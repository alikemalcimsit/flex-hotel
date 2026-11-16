import { useState } from 'react';
import { saveReportSchema, updateSavedReportSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { useSaveReport, useUpdateSavedReport } from '../../lib/reportChatQueries.js';
import { validateWith } from '../../lib/validate.js';

/**
 * Rapor asistanının diyalogları (modül 24): cevabı kaydet, kayıtlı raporu yeniden adlandır.
 */

/** @param {{ id: string, title: string, busy: boolean, onClose: () => void, submitLabel: string, onSubmit: (event: React.FormEvent) => void, children: React.ReactNode }} props */
function FormModal({ id, title, busy, onClose, submitLabel, onSubmit, children }) {
  return (
    <Modal
      open
      size="sm"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={id} icon="check" disabled={busy}>
            {busy ? 'İşleniyor…' : submitLabel}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {children}
      </form>
    </Modal>
  );
}

/**
 * Cevabı kaydet: başlık (cevabın başlığı önerilir) ve "otelle paylaş".
 * @param {{ question: any, onClose: () => void }} props
 */
export function SaveReportDialog({ question, onClose }) {
  const [title, setTitle] = useState(question.title ?? question.question.slice(0, 80));
  const [shared, setShared] = useState(false);
  const [errors, setErrors] = useState({});
  const save = useSaveReport({ onDone: onClose });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(saveReportSchema, { questionId: question.id, title, shared });
    if (!checked.ok) return setErrors(checked.errors);
    save.mutate(checked.data, { onError: (error) => setErrors({ ...error.fields, form: Object.keys(error.fields ?? {}).length ? undefined : error.message }) });
  }

  return (
    <FormModal id="report-save" title="Raporu kaydet" busy={save.isPending} onClose={onClose} submitLabel="Kaydet" onSubmit={submit}>
      <Input label="Başlık" name="report-save-title" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} error={errors.title} disabled={save.isPending} autoFocus />
      <Checkbox
        label="Otelle paylaş"
        hint="Rapor yetkisi olan herkes kayıtlı raporlarda görür ve çalıştırır; düzeltip silmek yalnız sizde."
        checked={shared}
        onChange={(event) => setShared(event.target.checked)}
        disabled={save.isPending}
      />
      <p className="text-xs text-ink-muted">Kayıtlı rapor her çalıştırıldığında güncel veriyle, AI kullanmadan hazırlanır; "geçen ay" gibi dönemler o güne göre kayar.</p>
      {errors.form && <Alert tone="danger">{errors.form}</Alert>}
    </FormModal>
  );
}

/**
 * Kayıtlı raporu yeniden adlandır.
 * @param {{ report: any, onClose: () => void }} props
 */
export function RenameReportDialog({ report, onClose }) {
  const [title, setTitle] = useState(report.title);
  const [errors, setErrors] = useState({});
  const update = useUpdateSavedReport({ onDone: onClose });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(updateSavedReportSchema, { expectedUpdatedAt: report.updatedAt, title });
    if (!checked.ok) return setErrors(checked.errors);
    update.mutate(
      { id: report.id, body: checked.data, message: 'Rapor yeniden adlandırıldı' },
      { onError: (error) => setErrors({ ...error.fields, form: Object.keys(error.fields ?? {}).length ? undefined : error.message }) },
    );
  }

  return (
    <FormModal id="report-rename" title="Yeniden adlandır" busy={update.isPending} onClose={onClose} submitLabel="Kaydet" onSubmit={submit}>
      <Input label="Başlık" name="report-rename-title" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} error={errors.title} disabled={update.isPending} autoFocus />
      {errors.form && <Alert tone="danger">{errors.form}</Alert>}
    </FormModal>
  );
}
