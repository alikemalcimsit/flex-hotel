import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAINTENANCE_BLOCK_TYPES, MAINTENANCE_BLOCK_TYPE_LABELS, MAINTENANCE_CATEGORIES } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { RoomPicker } from '../../components/RoomPicker.jsx';
import { categoryLabel, PRIORITY_OPTIONS, ticketPath, useCreateTicket } from '../../lib/maintenance.js';
import { toastSuccess } from '../../store/toast.js';

const CATEGORY_OPTIONS = MAINTENANCE_CATEGORIES.map((v) => ({ value: v, label: categoryLabel(v) }));
const BLOCK_OPTIONS = MAINTENANCE_BLOCK_TYPES.map((v) => ({ value: v, label: MAINTENANCE_BLOCK_TYPE_LABELS[v] }));

/**
 * Yeni arıza formu (modül 20): oda ya da serbest konum, kategori, açıklama,
 * öncelik ve (seçimli) odayı arızaya alma. Oda doluysa sunucu reddeder ve
 * "misafiri taşı" uyarısı gösterilir.
 */
export function TicketFormPage() {
  const navigate = useNavigate();
  const create = useCreateTicket();

  const [useRoom, setUseRoom] = useState(true);
  const [room, setRoom] = useState(null);
  const [locationText, setLocationText] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(3);
  const [closeRoom, setCloseRoom] = useState(false);
  const [blockType, setBlockType] = useState('OUT_OF_ORDER');
  const [endDate, setEndDate] = useState('');

  const occupied = create.error?.code === 'HAS_RESERVATIONS' || create.error?.code === 'WOULD_OVERBOOK';

  function submit(event) {
    event.preventDefault();
    const body = {
      category,
      title: title.trim(),
      description: description.trim(),
      priority: Number(priority),
    };
    if (useRoom) body.roomId = room?.id || undefined;
    else body.locationText = locationText.trim() || undefined;
    if (useRoom && closeRoom && room) body.closeRoom = { type: blockType, endDate: endDate || undefined };

    create.mutate(body, {
      onSuccess: (ticket) => {
        toastSuccess('Arıza bileti açıldı');
        navigate(ticketPath(ticket.id));
      },
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Yeni arıza" description="Arıza kaydı aç; gerekirse odayı kullanıma kapat." />

      <form onSubmit={submit} className="space-y-5 rounded-card bg-surface p-6 shadow-card">
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="radio" checked={useRoom} onChange={() => setUseRoom(true)} /> Oda
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="radio" checked={!useRoom} onChange={() => { setUseRoom(false); setCloseRoom(false); }} /> Ortak alan / konum
          </label>
        </div>

        {useRoom ? (
          <RoomPicker label="Oda" value={room} onChange={setRoom} />
        ) : (
          <Input label="Konum" value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Lobi, asansör, çatı…" />
        )}

        <Select label="Kategori" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} />
        <Input label="Başlık" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Klima soğutmuyor" required />
        <Textarea label="Açıklama" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required />
        <Select label="Öncelik" value={String(priority)} onChange={(e) => setPriority(e.target.value)} options={PRIORITY_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} />

        {useRoom && (
          <div className="space-y-3 rounded-item border border-line p-4">
            <Checkbox checked={closeRoom} onChange={(e) => setCloseRoom(e.target.checked)} label="Odayı kullanıma kapat (arıza kaydı aç)" />
            {closeRoom && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Kapatma türü" value={blockType} onChange={(e) => setBlockType(e.target.value)} options={BLOCK_OPTIONS} />
                <Input label="Bitiş (opsiyonel)" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {occupied && (
          <Alert tone="warning" title="Oda dolu">
            Bu odada o tarihlerde rezervasyon var; önce misafiri başka odaya taşıyın, sonra odayı arızaya alın.
          </Alert>
        )}
        {create.error && !occupied && <Alert tone="danger" title="Bilet açılamadı">{create.error.message}</Alert>}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => navigate('/teknik-servis')}>Vazgeç</Button>
          <Button type="submit" icon="check" disabled={create.isPending}>{create.isPending ? 'Açılıyor…' : 'Arıza kaydı aç'}</Button>
        </div>
      </form>
    </div>
  );
}
