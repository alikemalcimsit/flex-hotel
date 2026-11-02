import { INVOICE_UNIT_CODES, INVOICE_UNIT_LABELS, MAX_INVOICE_LINES, TAX_APPLIES_TO, TAX_APPLIES_TO_LABELS } from '@hotelos/hotel-contracts';
import { Button, Input, Select } from '@hotelos/ui';

/** Boş satır. */
export const emptyInvoiceLine = () => ({ description: '', quantity: '1', unitCode: 'C62', unitAmount: '', taxCategory: 'OTHER' });

/**
 * Elle girilen fatura satırları (serbest fatura, iptal bedeli): açıklama, miktar, birim, birim tutar ve vergi
 * kategorisi. Birim tutar otelin vergi ayarıyla girilir (dahil vergiler içinde, hariçler üstüne eklenir — folyodaki
 * gibi); KDV ve konaklama vergisi kategoriden hesaplanır.
 *
 * @param {{ lines: Array<any>, onChange: (lines: Array<any>) => void, errors?: Record<string, string>, disabled?: boolean }} props
 */
export function LinesEditor({ lines, onChange, errors = {}, disabled = false }) {
  const update = (index, patch) => onChange(lines.map((line, position) => (position === index ? { ...line, ...patch } : line)));
  return (
    <div className="flex flex-col gap-3">
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-1 gap-2 rounded-item border border-line p-3 sm:grid-cols-12">
          <Input
            label="Açıklama"
            className="sm:col-span-4"
            value={line.description}
            onChange={(event) => update(index, { description: event.target.value })}
            error={errors[`lines.${index}.description`]}
            disabled={disabled}
          />
          <Input label="Miktar" className="sm:col-span-2" inputMode="decimal" value={line.quantity} onChange={(event) => update(index, { quantity: event.target.value })} error={errors[`lines.${index}.quantity`]} disabled={disabled} />
          <Select
            label="Birim"
            className="sm:col-span-2"
            options={INVOICE_UNIT_CODES.map((code) => ({ value: code, label: INVOICE_UNIT_LABELS[code] }))}
            value={line.unitCode}
            onChange={(event) => update(index, { unitCode: event.target.value })}
            disabled={disabled}
          />
          <Input label="Birim tutar" className="sm:col-span-2" inputMode="decimal" value={line.unitAmount} onChange={(event) => update(index, { unitAmount: event.target.value })} error={errors[`lines.${index}.unitAmount`]} disabled={disabled} />
          <Select
            label="Vergi"
            className="sm:col-span-2"
            options={TAX_APPLIES_TO.map((category) => ({ value: category, label: TAX_APPLIES_TO_LABELS[category] }))}
            value={line.taxCategory}
            onChange={(event) => update(index, { taxCategory: event.target.value })}
            disabled={disabled}
          />
          {lines.length > 1 && (
            <div className="sm:col-span-12">
              <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => onChange(lines.filter((_, position) => position !== index))} disabled={disabled}>
                Satırı kaldır
              </Button>
            </div>
          )}
        </div>
      ))}
      {errors.lines && <p className="text-xs font-semibold text-sec-strong">{errors.lines}</p>}
      {lines.length < MAX_INVOICE_LINES && (
        <div>
          <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => onChange([...lines, emptyInvoiceLine()])} disabled={disabled}>
            Satır ekle
          </Button>
        </div>
      )}
    </div>
  );
}
