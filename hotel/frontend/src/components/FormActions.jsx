import { Button, Icon } from '@hotelos/ui';

/**
 * Ayar formlarının kaydet şeridi: kaydet düğmesi ve kaydın son güncellenme
 * zamanı. Zaman, iki kişinin aynı ayarı düzenlediği durumda (STALE_WRITE)
 * kullanıcının neyin üstüne yazdığını görebilmesi için gösteriliyor.
 *
 * @param {{ isPending: boolean, updatedAt?: string }} props
 */
export function FormActions({ isPending, updatedAt }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-surface px-6 py-4 shadow-card">
      {updatedAt ? (
        <p className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
          <Icon name="refresh" className="size-3.5" />
          Son güncelleme: {new Date(updatedAt).toLocaleString('tr-TR')}
        </p>
      ) : (
        <span />
      )}
      <Button type="submit" icon="check" disabled={isPending}>
        {isPending ? 'Kaydediliyor…' : 'Kaydet'}
      </Button>
    </div>
  );
}
