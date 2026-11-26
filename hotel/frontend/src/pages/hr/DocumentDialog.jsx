import { useState } from 'react';
import { EMPLOYEE_DOCUMENT_CONTENT_TYPES, EMPLOYEE_DOCUMENT_MAX_BYTES, EMPLOYEE_DOCUMENT_TYPES, EMPLOYEE_DOCUMENT_TYPE_LABELS, EXPIRING_DOCUMENT_TYPES, employeeDocumentSchema } from '@hotelos/hotel-contracts';
import { Icon, Input, Select, Textarea } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { employeeName, readFileAsBase64 } from '../../lib/hr.js';
import { EmployeeField } from './EmployeeField.jsx';
import { HrFormDialog, useHrDialogSubmit } from './HrFormDialog.jsx';

const ACCEPT = EMPLOYEE_DOCUMENT_CONTENT_TYPES.join(',');
const MAX_MB = Math.floor(EMPLOYEE_DOCUMENT_MAX_BYTES / 1_000_000);

/** @param {number} bytes */
const sizeText = (bytes) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/** Seçilen dosyanın istemci denetimi: tür ve boyut. @param {File} file */
function fileProblem(file) {
  if (!EMPLOYEE_DOCUMENT_CONTENT_TYPES.includes(file.type)) return 'Dosya PDF, JPEG, PNG ya da WebP olmalı';
  if (file.size > EMPLOYEE_DOCUMENT_MAX_BYTES) return `Dosya ${sizeText(file.size)}; en fazla ${MAX_MB} MB`;
  return null;
}

/**
 * Özlük belgesi ekle (modül 52, `hr.manage`): personel, tür, ad, düzenleme / bitiş tarihi, not ve isteğe bağlı dosya
 * (PDF / JPEG / PNG / WebP, en fazla 5 MB; tarayıcıda base64'e çevrilir). Süreli türlerde bitiş tarihi beklenir —
 * süresi dolacak belgeler İK'ya hatırlatılır.
 * @param {{ onClose: () => void, employee?: any | null }} props
 */
export function DocumentDialog({ onClose, employee = null }) {
  const [picked, setPicked] = useState(employee);
  const [values, setValues] = useState({ type: 'CONTRACT', title: '', issuedOn: '', expiresOn: '', note: '' });
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [reading, setReading] = useState(false);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const { submit, errors, setErrors, serverError, busy } = useHrDialogSubmit({ schema: employeeDocumentSchema, request: (body) => apiPost(`/hr/employees/${picked.id}/documents`, body), success: 'Belge kaydedildi', onClose });
  const expiring = EXPIRING_DOCUMENT_TYPES.includes(values.type);

  function pickFile(event) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setFileError(next ? fileProblem(next) : null);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!picked) return setErrors({ employeeId: 'Personel seçin' });
    if (file && fileProblem(file)) return setFileError(fileProblem(file));
    setReading(true);
    try {
      const data = file ? await readFileAsBase64(file) : null;
      submit({ type: values.type, title: values.title, issuedOn: values.issuedOn || null, expiresOn: values.expiresOn || null, note: values.note || null, file: file ? { name: file.name, contentType: file.type, data } : null });
    } catch (error) {
      setFileError(/** @type {Error} */ (error).message);
    } finally {
      setReading(false);
    }
  }

  const working = busy || reading;
  return (
    <HrFormDialog title={picked ? `Belge ekle: ${employeeName(picked)}` : 'Belge ekle'} formId="document-form" busy={working} onClose={onClose} submitLabel="Kaydet" serverError={serverError} submitDisabled={!picked || Boolean(fileError)}>
      <form id="document-form" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <EmployeeField value={picked} onChange={setPicked} error={errors.employeeId} disabled={working} className="sm:col-span-2" />
        <Select label="Belge türü" name="document-type" options={EMPLOYEE_DOCUMENT_TYPES.map((value) => ({ value, label: EMPLOYEE_DOCUMENT_TYPE_LABELS[value] }))} value={values.type} onChange={set('type')} error={errors.type} />
        <Input label="Belge adı" name="document-title" placeholder="örn. Hijyen eğitimi sertifikası 2026" value={values.title} onChange={set('title')} error={errors.title} />
        <Input label="Düzenleme tarihi" name="document-issued" type="date" value={values.issuedOn} onChange={set('issuedOn')} error={errors.issuedOn} />
        <Input label={expiring ? 'Bitiş tarihi (süreli belge)' : 'Bitiş tarihi'} name="document-expires" type="date" min={values.issuedOn || undefined} value={values.expiresOn} onChange={set('expiresOn')} error={errors.expiresOn} />
        <Textarea label="Not" name="document-note" rows={2} value={values.note} onChange={set('note')} error={errors.note} className="sm:col-span-2" />
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-[0.85rem] font-bold text-ink">Dosya</span>
          <label className={`flex cursor-pointer items-center gap-3 rounded-control border border-dashed px-4 py-3 text-sm transition-colors hover:border-ink ${fileError || errors.file ? 'border-sec-strong' : 'border-line-strong'}`}>
            <Icon name={file ? 'fileText' : 'upload'} className="size-5 shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1">
              {file ? (
                <>
                  <span className="block truncate font-semibold text-ink">{file.name}</span>
                  <span className="block text-xs text-ink-muted">{sizeText(file.size)}</span>
                </>
              ) : (
                <span className="text-ink-muted">PDF, JPEG, PNG ya da WebP; en fazla {MAX_MB} MB. Dosyasız yalnız kayıt da tutulabilir.</span>
              )}
            </span>
            <input type="file" accept={ACCEPT} className="sr-only" onChange={pickFile} disabled={working} />
          </label>
          {(fileError || errors.file) && <span className="text-xs font-bold text-sec-strong">{fileError ?? errors.file}</span>}
          {expiring && !values.expiresOn && <p className="text-xs text-ink-muted">Bu tür süreli: bitiş tarihi girilirse süresi dolmadan hatırlatılır.</p>}
        </div>
      </form>
    </HrFormDialog>
  );
}
