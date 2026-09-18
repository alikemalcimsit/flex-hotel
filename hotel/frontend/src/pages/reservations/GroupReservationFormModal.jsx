import { useMemo, useState } from 'react';
import { BOARD_TYPES, BOARD_TYPE_LABELS, groupReservationSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { validateWith } from '../../lib/validate.js';
import { useBookableRoomTypes, useReservationActions } from './useReservations.js';

const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] ?? value }));
const emptyLine = () => ({ roomTypeId: '', checkIn: '', checkOut: '', adults: '2', children: '0', boardType: 'BB' });

/**
 * Grup rezervasyonu: ortak misafir + birden çok oda satırı. Her satır ayrı
 * rezervasyon olur; hepsi tek transaction'da açılır (biri düşerse hiçbiri).
 *
 * @param {{ onClose: () => void }} props
 */
export function GroupReservationFormModal({ onClose }) {
  const roomTypesQuery = useBookableRoomTypes();
  const actions = useReservationActions();
  const [guest, setGuest] = useState({ name: '', phone: '', email: '' });
  const [lines, setLines] = useState([emptyLine()]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});

  const roomTypeOptions = useMemo(
    () => [
      { value: '', label: 'Oda tipi…' },
      ...(roomTypesQuery.data ?? []).map((type) => ({ value: type.id, label: `${type.name} (${type.code})` })),
    ],
    [roomTypesQuery.data],
  );

  const setLine = (index, key) => (event) => {
    const { value } = event.target;
    setLines((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  };
  const addLine = () => setLines((current) => [...current, emptyLine()]);
  const removeLine = (index) => setLines((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current));

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(groupReservationSchema, {
      guest: { name: guest.name, phone: guest.phone || undefined, email: guest.email || undefined },
      rooms: lines,
      notes: notes || null,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    actions.createGroup.mutate(result.data, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      size="lg"
      title="Grup rezervasyonu"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={actions.createGroup.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="group-form" icon="check" disabled={actions.createGroup.isPending}>
            {actions.createGroup.isPending ? 'Oluşturuluyor…' : `${lines.length} oda oluştur`}
          </Button>
        </>
      }
    >
      <form id="group-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-bold text-ink">Grup lideri (misafir)</legend>
          <Input label="Ad soyad" name="guestName" value={guest.name} onChange={(e) => setGuest((g) => ({ ...g, name: e.target.value }))} error={errors['guest.name']} />
          <Input label="Telefon" name="guestPhone" value={guest.phone} onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))} />
          <Input label="E-posta" name="guestEmail" type="email" value={guest.email} onChange={(e) => setGuest((g) => ({ ...g, email: e.target.value }))} />
        </fieldset>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ink">Odalar</span>
            <Button type="button" variant="outline" size="sm" icon="plus" onClick={addLine}>
              Oda ekle
            </Button>
          </div>
          {typeof errors.rooms === 'string' && <Alert tone="danger">{errors.rooms}</Alert>}

          {lines.map((line, index) => (
            <div key={index} className="grid items-end gap-3 rounded-card border border-line p-3 sm:grid-cols-[2fr_1.5fr_1.5fr_1fr_1fr_auto]">
              <Select label="Oda tipi" name={`roomTypeId-${index}`} value={line.roomTypeId} onChange={setLine(index, 'roomTypeId')} options={roomTypeOptions} error={errors[`rooms.${index}.roomTypeId`]} />
              <Input label="Giriş" type="date" name={`checkIn-${index}`} value={line.checkIn} onChange={setLine(index, 'checkIn')} error={errors[`rooms.${index}.checkIn`]} />
              <Input label="Çıkış" type="date" name={`checkOut-${index}`} value={line.checkOut} onChange={setLine(index, 'checkOut')} error={errors[`rooms.${index}.checkOut`]} />
              <Input label="Yet." type="number" min="1" name={`adults-${index}`} value={line.adults} onChange={setLine(index, 'adults')} />
              <Input label="Çoc." type="number" min="0" name={`children-${index}`} value={line.children} onChange={setLine(index, 'children')} />
              <button
                type="button"
                onClick={() => removeLine(index)}
                aria-label="Odayı çıkar"
                className="mb-1.5 grid size-9 place-items-center rounded-item text-ink-muted hover:bg-black/[0.05] hover:text-danger"
              >
                <Icon name="trash" className="size-4" />
              </button>
            </div>
          ))}
        </div>

        <Textarea label="Not" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </form>
    </Modal>
  );
}
