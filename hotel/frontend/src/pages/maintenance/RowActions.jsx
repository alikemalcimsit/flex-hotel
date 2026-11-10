import { Button } from '@hotelos/ui';
import { useTicketAction } from '../../lib/maintenance.js';

/**
 * Teknisyen listesinin satır içi hızlı işlemleri (modül 20). Her satır kendi
 * mutation kancasını taşır (koşullu hook olmaması için ayrı bileşen).
 *
 * @param {{ ticket: any, onDone: () => void }} props
 */
export function RowActions({ ticket, onDone }) {
  const actions = useTicketAction(ticket.id);
  if (!['PENDING', 'IN_PROGRESS'].includes(ticket.status)) return null;
  return (
    <>
      {ticket.status === 'PENDING' && (
        <Button variant="outline" size="sm" icon="play" disabled={actions.start.isPending} onClick={() => actions.start.mutate(undefined, { onSuccess: onDone })}>
          Başla
        </Button>
      )}
      <Button variant="primary" size="sm" icon="check" disabled={actions.resolve.isPending} onClick={() => actions.resolve.mutate({}, { onSuccess: onDone })}>
        Bitti
      </Button>
    </>
  );
}
