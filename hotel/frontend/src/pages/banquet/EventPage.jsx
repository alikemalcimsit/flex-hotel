import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EVENT_STATUS_LABELS, EVENT_TYPE_LABELS, cancellationTierRanges } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { apiPost } from '../../lib/api.js';
import { EVENT_STATUS_TONES, banquetKeys, dayText, eventPath, useBanquetEvent, useBanquetLive, wallRange } from '../../lib/banquet.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { EventDocumentsTab } from './EventDocumentsTab.jsx';
import { EventHeaderDialog } from './EventFormPage.jsx';
import { EventItemsTab } from './EventItemsTab.jsx';
import { EventPaymentsTab } from './EventPaymentsTab.jsx';
import { EventProgramTab } from './EventProgramTab.jsx';
import { CompleteDialog, ConfirmEventDialog, EventReasonDialog, TentativeDialog } from './EventStatusDialogs.jsx';

const TABS = Object.freeze([
  { key: 'genel', label: 'Genel', icon: 'info' },
  { key: 'program', label: 'Program', icon: 'calendar' },
  { key: 'kalemler', label: 'Fiyat kalemleri', icon: 'list' },
  { key: 'odemeler', label: 'Ödemeler', icon: 'wallet' },
  { key: 'belgeler', label: 'Belgeler', icon: 'fileText' },
]);

const STALE_TEXT = 'Dosya bu arada başkası tarafından değiştirildi; ekran yenilendi, tekrar deneyin.';

/**
 * Etkinlik dosyası (modül 37): başlıkta durum, opsiyon sırası ve durum eylemleri
 * (opsiyonla / uzat, bırak, kesinleştir, gerçekleşti, iptal, kaybedildi); sekmeler
 * genel bilgi, program (salon × saat), fiyat kalemleri, ödeme planı ve ödemeler,
 * belgeler. Sekme adresteki `?sekme=` ile paylaşılabilir.
 */
export function EventPage() {
  const { eventId } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((entry) => entry.key === params.get('sekme')) ? params.get('sekme') : 'genel';
  const query = useBanquetEvent(eventId);
  useBanquetLive();
  const [dialog, setDialog] = useState(null);

  const action = useMutation({
    mutationFn: ({ kind, body }) => apiPost(`/banquet/events/${eventId}/${kind}`, body),
    onSuccess: (result, { kind }) => {
      setDialog(null);
      queryClient.setQueryData(banquetKeys.event(eventId), result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      const messages = {
        tentative: result.status === 'TENTATIVE' && query.data?.status === 'TENTATIVE' ? 'Opsiyon tarihi güncellendi' : `Opsiyonlandı: ${result.optionRank}. opsiyon`,
        release: 'Opsiyon bırakıldı; dosya talebe döndü',
        confirm: 'Etkinlik kesinleşti',
        complete: 'Etkinlik gerçekleşti: faturaya hazır',
        cancel: 'Etkinlik iptal edildi',
        lose: 'Dosya kaybedildi olarak kapandı',
      };
      toastSuccess(messages[kind]);
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: banquetKeys.event(eventId) });
    },
  });

  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <QueryFallback query={query} errorTitle="Etkinlik yüklenemedi" />
      </div>
    );
  }

  const event = query.data;
  const canManage = can(PERMISSIONS.BANQUET_MANAGE);
  const busy = action.isPending;
  const run = (kind, body) => action.mutate({ kind, body: { expectedUpdatedAt: event.updatedAt, ...body } });
  const open = ['INQUIRY', 'TENTATIVE'].includes(event.status);
  const ended = event.lastEndAt && new Date(event.lastEndAt).getTime() < Date.now();

  const actions = canManage && (
    <div className="flex flex-wrap gap-2">
      {open && (
        <Button type="button" variant={event.status === 'TENTATIVE' ? 'outline' : 'primary'} icon="clock" onClick={() => setDialog('tentative')} disabled={busy}>
          {event.status === 'TENTATIVE' ? 'Opsiyonu uzat' : 'Opsiyonla'}
        </Button>
      )}
      {open && (
        <Button type="button" icon="checkCircle" onClick={() => setDialog('confirm')} disabled={busy}>
          Kesinleştir
        </Button>
      )}
      {event.status === 'TENTATIVE' && (
        <Button type="button" variant="ghost" icon="rotateCcw" onClick={() => setDialog('release')} disabled={busy}>
          Opsiyonu bırak
        </Button>
      )}
      {event.status === 'DEFINITE' && ended && (
        <Button type="button" icon="checkCheck" onClick={() => setDialog('complete')} disabled={busy}>
          Gerçekleşti
        </Button>
      )}
      {event.status === 'DEFINITE' && (
        <Button type="button" variant="dangerSoft" icon="close" onClick={() => setDialog('cancel')} disabled={busy}>
          İptal et
        </Button>
      )}
      {open && (
        <Button type="button" variant="ghost" icon="close" onClick={() => setDialog('lose')} disabled={busy}>
          Kaybedildi
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader
        title={event.name}
        description={`${event.code} · ${event.client.name} · ${EVENT_TYPE_LABELS[event.type]}${event.firstStartLocal ? ` · ${wallRange(event.firstStartLocal, event.lastEndLocal)}` : ''}`}
        actions={actions}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={EVENT_STATUS_TONES[event.status]}>{EVENT_STATUS_LABELS[event.status]}</Badge>
        {event.status === 'TENTATIVE' && (
          <Badge tone={event.optionRank === 1 ? 'warning' : 'danger'}>
            {event.optionRank}. opsiyon · son gün {dayText(event.optionUntil)}
          </Badge>
        )}
        {event.requireSignedContract && open && <Badge tone={event.contractSigned ? 'success' : 'neutral'}>{event.contractSigned ? 'Sözleşme imzalı' : 'İmzalı sözleşme bekleniyor'}</Badge>}
        {event.invoiceReady && <Badge tone={event.proformaIssued ? 'success' : 'info'}>{event.proformaIssued ? 'Proforma üretildi' : 'Faturaya hazır'}</Badge>}
      </div>
      {event.status === 'TENTATIVE' && event.optionRank > 1 && (
        <Alert tone="warning" title={`Bu dosya ${event.optionRank}. opsiyon`}>
          Salonda önde: {event.blockingEvents.map((entry) => (
            <Link key={entry.id} to={eventPath(entry.id)} className="mr-2 font-semibold underline-offset-2 hover:underline">
              {entry.name} ({entry.code}, {EVENT_STATUS_LABELS[entry.status].toLocaleLowerCase('tr')})
            </Link>
          ))}
          Öndeki opsiyon düşmeden kesinleşemez; düşünce size haber gelir.
        </Alert>
      )}
      {event.equipmentShortages.length > 0 && (
        <Alert tone={event.status === 'DEFINITE' ? 'danger' : 'warning'} title="Ekipman stoğu yetmiyor">
          {event.equipmentShortages.map((entry) => `${entry.name}: aynı anda ${entry.peak} adet gerekli, stok ${entry.stock}`).join(' · ')}. Kesinleştirme bu durumda yapılmaz.
        </Alert>
      )}

      <nav aria-label="Dosya sekmeleri" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-current={tab === entry.key ? 'page' : undefined}
            onClick={() => setParams(entry.key === 'genel' ? {} : { sekme: entry.key }, { replace: true })}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${tab === entry.key ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            <Icon name={entry.icon} className="size-4" />
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'genel' && <OverviewTab event={event} canManage={canManage} onEdit={() => setDialog('header')} />}
      {tab === 'program' && <EventProgramTab event={event} canManage={canManage} />}
      {tab === 'kalemler' && <EventItemsTab event={event} canManage={canManage} />}
      {tab === 'odemeler' && <EventPaymentsTab event={event} />}
      {tab === 'belgeler' && <EventDocumentsTab event={event} canManage={canManage} />}

      {dialog === 'header' && <EventHeaderDialog event={event} onClose={() => setDialog(null)} />}
      {dialog === 'tentative' && <TentativeDialog event={event} busy={busy} onConfirm={(body) => run('tentative', body)} onClose={() => setDialog(null)} />}
      {dialog === 'confirm' && <ConfirmEventDialog event={event} busy={busy} onConfirm={() => run('confirm')} onClose={() => setDialog(null)} />}
      {dialog === 'complete' && <CompleteDialog event={event} busy={busy} onConfirm={(body) => run('complete', body)} onClose={() => setDialog(null)} />}
      {dialog === 'release' && (
        <EventReasonDialog
          title="Opsiyonu bırak"
          intro="Salon bırakılır, dosya talebe döner; sırada bekleyen opsiyonların sorumlularına haber gider."
          label="Bırakma sebebi"
          confirmLabel="Opsiyonu bırak"
          busy={busy}
          onConfirm={(body) => run('release', body)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel' && (
        <EventReasonDialog
          title="Etkinliği iptal et"
          intro={
            <>
              İptal bedeli kesinleşirken kopyalanan kademelerden: bugün iptal edilirse <strong>%{event.cancellationPreview?.feePct ?? '0'}</strong> ·{' '}
              <strong>{formatMoney(event.cancellationPreview?.fee ?? '0', event.currency)}</strong>. Ödenen bundan fazlaysa fark iade edilir (onaylı).
            </>
          }
          label="İptal gerekçesi"
          confirmLabel="İptal et"
          busy={busy}
          onConfirm={(body) => run('cancel', body)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'lose' && (
        <EventReasonDialog
          title="Kaybedildi olarak kapat"
          intro="Dosya kapanır, salon tutmaları silinir. Sebep satış raporunda görünür."
          label="Kaybedilme sebebi"
          confirmLabel="Kapat"
          busy={busy}
          onConfirm={(body) => run('lose', body)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/etkinlikler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
      <Icon name="arrowLeft" className="size-4" /> Etkinlikler
    </Link>
  );
}

/** @param {{ label: string, children: React.ReactNode }} props */
function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink">{children}</dd>
    </div>
  );
}

/**
 * Genel: müşteri, kişi, tutarlar, iptal koşulu ve dosyanın izi.
 * @param {{ event: any, canManage: boolean, onEdit: () => void }} props
 */
function OverviewTab({ event, canManage, onEdit }) {
  const money = (value) => formatMoney(value, event.currency);
  const editable = !['CANCELLED', 'LOST'].includes(event.status);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card
        title="Dosya"
        actions={
          canManage &&
          editable && (
            <Button type="button" size="sm" variant="outline" icon="pencil" onClick={onEdit}>
              Düzenle
            </Button>
          )
        }
      >
        <dl className="divide-y divide-line">
          <Row label="Müşteri">{event.client.name}</Row>
          {event.client.contactName && <Row label="Yetkili">{event.client.contactName}</Row>}
          {event.client.phone && <Row label="Telefon">{event.client.phone}</Row>}
          <Row label="Sorumlu">{event.ownerEmail}</Row>
          <Row label="Tahmini / garanti">
            {event.expectedPax} / {event.guaranteedPax ?? '—'}
          </Row>
          {event.actualPax !== null && <Row label="Gerçekleşen">{event.actualPax}</Row>}
          <Row label="Faturalanan kişi">{event.billablePax}</Row>
        </dl>
        {event.notes && <p className="mt-3 whitespace-pre-line text-sm text-ink-soft">{event.notes}</p>}
      </Card>
      <Card title="Tutar">
        <dl className="divide-y divide-line">
          <Row label="Vergisiz">{money(event.netTotal)}</Row>
          <Row label="Vergi">{money(event.taxTotal)}</Row>
          <Row label="Toplam">{money(event.grandTotal)}</Row>
          {event.status === 'CANCELLED' && <Row label="İptal bedeli">{money(event.cancellationFee)}</Row>}
          <Row label="Ödenen">{money(event.paidTotal)}</Row>
          <Row label={Number(event.balance) < 0 ? 'Fazla ödeme' : 'Kalan'}>
            <span className={Number(event.balance) > 0 ? 'text-warning-ink' : Number(event.balance) < 0 ? 'text-info-ink' : ''}>{money(Math.abs(Number(event.balance)))}</span>
          </Row>
        </dl>
        {Number(event.paymentSummary.pendingPayments) > 0 && <p className="mt-2 text-xs text-ink-muted">Onay bekleyen tahsilat: {money(event.paymentSummary.pendingPayments)}</p>}
      </Card>
      <Card title="İptal koşulu">
        {event.cancellationTiers.length === 0 ? (
          <p className="text-sm text-ink-muted">İptal bedeli uygulanmaz.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {cancellationTierRanges(event.cancellationTiers).map((tier) => (
              <li key={tier.daysBefore} className="flex justify-between gap-3">
                <span className="text-ink-soft">{tier.label}</span>
                <span className="font-semibold">%{tier.feePct}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          {event.cancellationTiersSnapshot ? 'Kesinleşirken politikadan kopyalandı; politika sonradan değişse de bu dosya için geçerli.' : 'Şu anki banket politikası; kesinleşince dosyaya kopyalanır.'}
        </p>
        {event.cancellationPreview && (
          <p className="mt-2 text-sm">
            Bugün iptal: <strong>%{event.cancellationPreview.feePct}</strong> · <strong>{money(event.cancellationPreview.fee)}</strong>
          </p>
        )}
      </Card>
      <Card title="Dosyanın izi" className="lg:col-span-3">
        <ol className="flex flex-col gap-1 text-sm text-ink-soft">
          <li>Açıldı: {new Date(event.trail.createdAt).toLocaleString('tr-TR')} · {event.trail.createdBy}</li>
          {event.optionedAt && <li>Opsiyonlandı: {new Date(event.optionedAt).toLocaleString('tr-TR')}</li>}
          {event.trail.definiteAt && <li>Kesinleşti: {new Date(event.trail.definiteAt).toLocaleString('tr-TR')} · {event.trail.definiteBy}</li>}
          {event.trail.completedAt && <li>Gerçekleşti: {new Date(event.trail.completedAt).toLocaleString('tr-TR')} · {event.trail.completedBy}</li>}
          {event.trail.cancelledAt && (
            <li>
              İptal: {new Date(event.trail.cancelledAt).toLocaleString('tr-TR')} · {event.trail.cancelledBy} — {event.trail.cancelReason}
            </li>
          )}
          {event.trail.lostAt && (
            <li>
              Kaybedildi: {new Date(event.trail.lostAt).toLocaleString('tr-TR')} · {event.trail.lostBy} — {event.trail.lostReason}
            </li>
          )}
        </ol>
      </Card>
    </div>
  );
}
