import { useState } from 'react';
import { createReportDefinitionSchema, updateReportDefinitionSchema } from '@hotelos/hotel-contracts';
import { Alert, Checkbox, Input } from '@hotelos/ui';
import { designPayload } from '../../lib/reportDesigner.js';
import { useSaveDefinition, useUpdateDefinition } from '../../lib/reportDesignerQueries.js';
import { validateWith } from '../../lib/validate.js';
import { FormModal } from '../report-chat/ReportChatDialogs.jsx';

/**
 * Rapor tasarımcısının (modül 26) diyalogları: tasarımı yeni rapor olarak kaydet, kayıtlı tasarımı yeniden adlandır.
 */

/** Sunucu hatası alanlara ya da forma. @param {any} error */
const errorsOf = (error) => ({ ...error.fields, form: Object.keys(error.fields ?? {}).length ? undefined : error.message });

/**
 * Yeni kayıt (ilk kayıt ya da "farklı kaydet").
 * @param {{ design: any, initialTitle?: string, onClose: () => void, onSaved: (definition: any) => void }} props
 */
export function SaveDefinitionDialog({ design, initialTitle = '', onClose, onSaved }) {
  const [title, setTitle] = useState(initialTitle);
  const [shared, setShared] = useState(false);
  const [errors, setErrors] = useState({});
  const save = useSaveDefinition({ onDone: onSaved });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createReportDefinitionSchema, { title, shared, design: designPayload(design) });
    if (!checked.ok) return setErrors(checked.errors);
    save.mutate(checked.data, { onError: (error) => setErrors(errorsOf(error)) });
  }

  return (
    <FormModal id="designer-save" title="Raporu kaydet" busy={save.isPending} onClose={onClose} submitLabel="Kaydet" onSubmit={submit}>
      <Input label="Başlık" name="designer-save-title" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} error={errors.title} disabled={save.isPending} autoFocus />
      <Checkbox
        name="designer-save-shared"
        label="Otelle paylaş"
        hint="Rapor yetkisi (ve kaynağın yetkisi) olan herkes kayıtlı raporlarda görür ve çalıştırır; düzeltip silmek yalnız sizde."
        checked={shared}
        onChange={(event) => setShared(event.target.checked)}
        disabled={save.isPending}
      />
      <p className="text-xs text-ink-muted">Kayıtlı rapor her çalıştırıldığında güncel veriyle hazırlanır; "bu ay" gibi dönem filtreleri o güne göre kayar.</p>
      {errors.form && <Alert tone="danger">{errors.form}</Alert>}
      {Object.keys(errors).some((key) => key.startsWith('design')) && <Alert tone="danger">Tasarımda hata var; önce önizleyip düzeltin.</Alert>}
    </FormModal>
  );
}

/**
 * Kayıtlı tasarımı yeniden adlandır.
 * @param {{ definition: any, onClose: () => void }} props
 */
export function RenameDefinitionDialog({ definition, onClose }) {
  const [title, setTitle] = useState(definition.title);
  const [errors, setErrors] = useState({});
  const update = useUpdateDefinition({ onDone: onClose });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(updateReportDefinitionSchema, { expectedUpdatedAt: definition.updatedAt, title });
    if (!checked.ok) return setErrors(checked.errors);
    update.mutate({ id: definition.id, body: checked.data, message: 'Rapor yeniden adlandırıldı' }, { onError: (error) => setErrors(errorsOf(error)) });
  }

  return (
    <FormModal id="designer-rename" title="Yeniden adlandır" busy={update.isPending} onClose={onClose} submitLabel="Kaydet" onSubmit={submit}>
      <Input label="Başlık" name="designer-rename-title" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} error={errors.title} disabled={update.isPending} autoFocus />
      {errors.form && <Alert tone="danger">{errors.form}</Alert>}
    </FormModal>
  );
}
