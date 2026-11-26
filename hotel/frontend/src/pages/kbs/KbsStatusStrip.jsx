import { KBS_PROVIDER_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge } from '@hotelos/ui';

/**
 * KBS durum şeridi (modül 58): kapalıysa "girişler bildirilmiyor", test ortamındaysa açık uyarı (bildirimler dışarı gitmez),
 * yoksa etkin sağlayıcı.
 * @param {{ data: { settings: { isEnabled: boolean, provider: string } } }} props
 */
export function KbsStatusStrip({ data }) {
  const { isEnabled, provider } = data.settings;
  const isTest = provider === 'TEST';
  return (
    <div className="flex flex-col gap-2">
      {!isEnabled && (
        <Alert tone="warning" title="KBS kapalı">
          Girişler KBS'ye bildirilmiyor. Ayarlar sekmesinden tesis kodu ve kullanıcıyla açılır.
        </Alert>
      )}
      {isTest && (
        <Alert tone="danger" title="Test ortamı — bildirimler Emniyete gitmiyor">
          Bildirimler yalnız benzetimde işlenir. Gerçek bildirim için misafirleri KBS ekranından elle girin; gerçek bağlantı tesis yetkisi ve servis dokümanıyla açılacak.
        </Alert>
      )}
      {isEnabled && !isTest && (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Badge tone="success">Açık</Badge> {KBS_PROVIDER_LABELS[provider] ?? provider}
        </p>
      )}
    </div>
  );
}
