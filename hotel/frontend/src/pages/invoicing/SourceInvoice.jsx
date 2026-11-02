import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EDOC_STATE_LABELS, INVOICE_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button } from '@hotelos/ui';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { EDOC_STATE_TONES, INVOICE_STATUS_TONES, invoiceKeys, useInvoicesLive } from '../../lib/invoicing.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError } from '../../store/toast.js';

/**
 * Folyo / etkinlik ekranındaki fatura kutusu (modül 16 / 49): geçerli faturası (taslak ya da kesilmiş) varsa ona
 * bağlantı ve durumu; yoksa yetkiliye "Fatura taslağı aç". Fatura izni olmayana görünmez.
 *
 * @param {{ kind: 'folio' | 'event', id: string }} props
 */
export function SourceInvoice({ kind, id }) {
  useInvoicesLive();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canView = can(PERMISSIONS.INVOICES_VIEW);
  const canIssue = can(PERMISSIONS.INVOICES_ISSUE);
  const filters = { [kind === 'folio' ? 'folioId' : 'eventId']: id, page: 1, pageSize: 5 };
  const query = useQuery({ queryKey: invoiceKeys.ofSource(kind, id), queryFn: () => api(withQuery('/invoices', filters)), enabled: canView });
  const open = useMutation({
    mutationFn: () => apiPost('/invoices', kind === 'folio' ? { source: 'FOLIO', folioId: id } : { source: 'EVENT', eventId: id }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      navigate(`/faturalar/${data.invoice.id}`);
    },
    onError: (error) => toastError(error.message),
  });
  if (!canView || !query.data) return null;
  const active = query.data.items.find((row) => row.status !== 'CANCELLED');
  if (active) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/faturalar/${active.id}`} className="font-semibold text-info-ink hover:underline">
          {active.number ? `Fatura ${active.number}` : 'Fatura taslağı'}
        </Link>
        <Badge tone={INVOICE_STATUS_TONES[active.status]}>{INVOICE_STATUS_LABELS[active.status]}</Badge>
        {active.edocState && <Badge tone={EDOC_STATE_TONES[active.edocState]}>{EDOC_STATE_LABELS[active.edocState]}</Badge>}
      </div>
    );
  }
  if (!canIssue) return null;
  return (
    <div>
      <Button type="button" variant="outline" icon="fileText" onClick={() => open.mutate()} disabled={open.isPending}>
        {open.isPending ? 'Açılıyor…' : 'Fatura taslağı aç'}
      </Button>
    </div>
  );
}
