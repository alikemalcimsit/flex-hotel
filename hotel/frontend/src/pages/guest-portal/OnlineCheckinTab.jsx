import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GUEST_PORTAL_LANGUAGE_LABELS,
  ONLINE_CHECKIN_PAYMENT_PREFERENCE_LABELS,
  ONLINE_CHECKIN_STATUSES,
  ONLINE_CHECKIN_STATUS_LABELS,
  ONLINE_CHECKIN_STATUS_TONES,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Input } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { guestPortalKeys, useGuestPortalLive } from '../../lib/guestPortal.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useCrudResource } from '../../lib/useCrudResource.js';
import { OnlineCheckinDialog } from './OnlineCheckinDialog.jsx';

const VIEWS = Object.freeze([
  { value: 'UPCOMING', label: 'Gelecek girişler' },
  { value: 'ALL', label: 'Tümü' },
]);

/**
 * Online check-in'ler (modül 53): misafirin portaldan gönderdiği kimlik, belge fotoğrafı ve imza. Resepsiyon girişten
 * önce inceler (onay ya da düzeltme isteği); misafir gelince giriş penceresi bu bilgilerle dolu açılır.
 */
export function OnlineCheckinTab() {
  useGuestPortalLive();
  const can = useCan();
  const { today } = useHotelToday();
  const [view, setView] = useState('UPCOMING');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);
  const resource = useCrudResource({
    basePath: '/guest-portal/online-checkins',
    queryKey: [...guestPortalKeys.all, 'online-checkins'],
    labels: { singular: 'Online check-in' },
    extraParams: { ...(status ? { status } : {}), ...(view === 'UPCOMING' && today ? { from: today } : {}), pageSize: 25 },
  });
  const counts = resource.meta?.counts ?? {};
  const changeFilter = (setter) => (value) => {
    setter(value);
    resource.setPage(1);
  };

  const columns = [
    {
      key: 'guest',
      header: 'Misafir',
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{row.guestName}</span>
          <span className="font-mono text-xs text-ink-muted">{row.confirmationCode}</span>
        </span>
      ),
    },
    {
      key: 'stay',
      header: 'Giriş',
      render: (row) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>
            {formatDate(row.checkIn)} – {formatDate(row.checkOut)}
          </span>
          <span className="text-xs text-ink-muted">{row.arrivalTime ? `Varış ~${row.arrivalTime}` : 'Varış saati yok'}{row.roomNumber ? ` · oda ${row.roomNumber}` : ''}</span>
        </span>
      ),
    },
    { key: 'people', header: 'Kişi', className: 'text-right tabular-nums', render: (row) => `${row.people} / ${row.adults + row.children}` },
    {
      key: 'documents',
      header: 'Belge',
      render: (row) =>
        row.documentsPurged ? (
          <span className="text-xs text-ink-muted">Silindi (KVKK)</span>
        ) : (
          <span className="tabular-nums">{row.photoCount} fotoğraf</span>
        ),
    },
    { key: 'payment', header: 'Ödeme', render: (row) => <span className="whitespace-nowrap text-xs">{ONLINE_CHECKIN_PAYMENT_PREFERENCE_LABELS[row.paymentPreference] ?? row.paymentPreference}</span> },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={ONLINE_CHECKIN_STATUS_TONES[row.status]}>{ONLINE_CHECKIN_STATUS_LABELS[row.status]}</Badge>
          {row.submitCount > 1 && <span className="text-xs text-ink-muted">{row.submitCount}. gönderim</span>}
        </span>
      ),
    },
    {
      key: 'submitted',
      header: 'Gönderim',
      render: (row) => (
        <span className="flex flex-col whitespace-nowrap text-xs">
          <span>{formatDateTime(row.submittedAt)}</span>
          <span className="text-ink-muted">{GUEST_PORTAL_LANGUAGE_LABELS[row.language] ?? row.language}</span>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ChoiceChips
          label="Durum"
          options={[
            { value: '', label: 'Hepsi' },
            ...ONLINE_CHECKIN_STATUSES.map((value) => ({ value, label: counts[value] ? `${ONLINE_CHECKIN_STATUS_LABELS[value]} (${counts[value]})` : ONLINE_CHECKIN_STATUS_LABELS[value] })),
          ]}
          value={status}
          onChange={changeFilter(setStatus)}
        />
        {can(PERMISSIONS.GUEST_PORTAL_SETUP) && (
          <Link to="/on-buro/online-check-in/ayarlar" className="text-sm font-semibold text-ink underline-offset-4 hover:underline">
            Portal ayarları →
          </Link>
        )}
      </div>
      <Toolbar>
        <ChoiceChips label="Görünüm" options={VIEWS} value={view} onChange={changeFilter(setView)} />
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Onay kodu ya da misafir adı…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-full sm:w-72"
        />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={resource.rows}
        meta={resource.meta}
        isLoading={resource.isLoading}
        isFetching={resource.isFetching}
        error={resource.error}
        onRetry={resource.refetch}
        onPageChange={resource.setPage}
        emptyTitle={resource.search ? 'Eşleşen online check-in yok' : 'Online check-in yok'}
        emptyHint={
          resource.search
            ? 'Farklı bir kod ya da ad deneyin.'
            : 'Misafirler portal bağlantısıyla (davet ya da rezervasyondaki bağlantı) gönderdikçe burada görünür.'
        }
        rowActions={(row) => (
          <Button type="button" size="sm" variant={row.status === 'SUBMITTED' ? 'primary' : 'outline'} icon="eye" onClick={() => setOpenId(row.id)}>
            {row.status === 'SUBMITTED' ? 'İncele' : 'Gör'}
          </Button>
        )}
      />
      {openId && <OnlineCheckinDialog onlineCheckinId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
