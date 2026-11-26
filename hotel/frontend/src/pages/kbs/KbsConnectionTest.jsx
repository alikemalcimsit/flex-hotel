import { useMutation } from '@tanstack/react-query';
import { Alert, Button } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';

/**
 * "Bağlantıyı dene" (modül 58, `kbs.manage`): kayıtlı ayarla sağlayıcıya bağlanır, bildirim göndermez; sonucu altta yazar.
 * @param {{ isDirty: boolean }} props `isDirty`: formda kaydedilmemiş değişiklik var (deneme kayıtlı ayarla yapılır)
 */
export function KbsConnectionTest({ isDirty }) {
  const test = useMutation({ mutationFn: () => apiPost('/kbs/settings/test', {}) });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" icon="zap" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? 'Deneniyor…' : 'Bağlantıyı dene'}
        </Button>
        <p className="text-xs text-ink-muted">{isDirty ? 'Kaydedilmemiş değişiklik var: deneme kayıtlı ayarla yapılır.' : 'Kayıtlı ayarla denenir; bildirim gönderilmez.'}</p>
      </div>
      {test.isSuccess && (
        <Alert tone={test.data.ok ? 'success' : 'danger'} title={test.data.ok ? 'Bağlantı başarılı' : 'Bağlanılamadı'}>
          {test.data.message}
        </Alert>
      )}
      {test.isError && (
        <Alert tone="danger" title="Denenemedi">
          {test.error.message}
        </Alert>
      )}
    </div>
  );
}
