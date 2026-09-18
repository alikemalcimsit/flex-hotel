/** Rezervasyon durumunun rozet tonu (Badge). */
export function statusTone(status) {
  switch (status) {
    case 'CONFIRMED':
      return 'info';
    case 'CHECKED_IN':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'WAITLISTED':
      return 'violet';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'danger';
    case 'CHECKED_OUT':
    default:
      return 'neutral';
  }
}
