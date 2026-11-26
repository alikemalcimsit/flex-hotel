import { Alert, Badge } from '@hotelos/ui';
import { gatewayMode } from '../../lib/paymentGateway.js';

const MODE_TEXT = Object.freeze({
  off: 'Ödeme linki oluşturulamaz; portal ve widget kartla ödeme göstermez. Ayarlar sekmesinden açılır.',
  test: 'Ödemeler taklit sayfada onaylanır / reddedilir; karttan para çekilmez. Gerçek tahsilat için iyzico seçin.',
  sandbox: 'iyzico deneme ortamı: test kartlarıyla çalışır, gerçek para çekilmez.',
});

/**
 * Sanal POS durum şeridi (modül 50): kapalı, test ortamı, iyzico sandbox uyarısı; canlıda yalnız rozet.
 * @param {{ settings: { isEnabled: boolean, provider: string, environment: string } }} props
 */
export function GatewayStatusStrip({ settings }) {
  const mode = gatewayMode(settings);
  if (mode.kind === 'live') {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-soft">
        <Badge tone="success">Açık</Badge> {mode.title}
      </p>
    );
  }
  return (
    <Alert tone={mode.tone} title={mode.title}>
      {MODE_TEXT[mode.kind]}
    </Alert>
  );
}
