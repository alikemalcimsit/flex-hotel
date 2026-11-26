import { GATEWAY_REFUND_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Card } from '@hotelos/ui';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { refundStatusTone } from '../../lib/paymentGateway.js';

const EVENT_LABELS = Object.freeze({
  CREATED: 'Oluşturuldu',
  SENT: 'Gönderildi',
  SESSION: 'Oturum açıldı',
  STARTED: 'Ödemeye başlandı',
  PAID: 'Ödendi',
  FAILED: 'Başarısız',
  EXPIRED: 'Süresi doldu',
  CANCELLED: 'İptal edildi',
  REFUND_REQUESTED: 'İade istendi',
  REFUNDED: 'İade edildi',
  REFUND_FAILED: 'İade başarısız',
  REFUND_REJECTED: 'İade reddedildi',
});

/** Kodu gizli olay türleri: ödeme oturumunun kodu sağlayıcının token'ıdır. */
const HIDDEN_CODE_KINDS = Object.freeze(['SESSION']);

const HEAD = 'border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted';

/**
 * Linkin iadeleri (modül 50).
 * @param {{ refunds: Array<any>, currency: string }} props
 */
export function RefundsCard({ refunds, currency }) {
  if (refunds.length === 0) return null;
  return (
    <Card title="Karta iadeler" description="Her istek onaya gider; onaylanınca sağlayıcıdan iade edilir.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={HEAD}>
            <tr>
              <th className="py-2 pr-3">Zaman</th>
              <th className="py-2 pr-3 text-right">Tutar</th>
              <th className="py-2 pr-3">Durum</th>
              <th className="py-2 pr-3">Gerekçe</th>
              <th className="py-2">İsteyen / onaylayan</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((row) => (
              <tr key={row.id} className="border-b border-line align-top">
                <td className="whitespace-nowrap py-2 pr-3 text-xs">{formatDateTime(row.createdAt)}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{formatMoney(row.amount, currency)}</td>
                <td className="py-2 pr-3">
                  <Badge tone={refundStatusTone(row.status)}>{GATEWAY_REFUND_STATUS_LABELS[row.status] ?? row.status}</Badge>
                  {row.failureMessage && <span className="mt-1 block text-xs text-danger-ink">{row.failureMessage}</span>}
                </td>
                <td className="py-2 pr-3 text-ink-soft">{row.reason}</td>
                <td className="py-2 text-xs text-ink-muted">
                  {row.requestedBy ?? '—'}
                  {row.decidedBy && <span className="block">{row.decidedBy}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Linkin izi (modül 50): oluşturma, gönderim, denemeler, ödeme, iade.
 * @param {{ events: Array<any> }} props
 */
export function EventsCard({ events }) {
  return (
    <Card title="İz" description="Linkin her adımı ve sağlayıcının cevabı.">
      {events.length === 0 ? (
        <p className="text-sm text-ink-muted">Henüz kayıt yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={HEAD}>
              <tr>
                <th className="py-2 pr-3">Zaman</th>
                <th className="py-2 pr-3">Adım</th>
                <th className="py-2 pr-3">Sonuç</th>
                <th className="py-2 pr-3">Mesaj</th>
                <th className="py-2">Yapan</th>
              </tr>
            </thead>
            <tbody>
              {events.map((row) => (
                <tr key={row.id} className="border-b border-line align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-xs">{formatDateTime(row.createdAt)}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{EVENT_LABELS[row.kind] ?? row.kind}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={row.ok ? 'success' : 'danger'}>{row.ok ? 'Tamam' : 'Hata'}</Badge>
                    {row.code && !HIDDEN_CODE_KINDS.includes(row.kind) && <span className="mt-1 block font-mono text-xs text-ink-muted">{row.code}</span>}
                  </td>
                  <td className="py-2 pr-3 text-ink-soft">{row.message ?? '—'}</td>
                  <td className="py-2 text-xs text-ink-muted">{row.actor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
