import { Alert, Button } from '@hotelos/ui';
import { copyPayLink } from '../../lib/paymentGateway.js';

/** Misafirin ödeme sayfası adresi ve "Kopyala". @param {{ url: string | null }} props */
export function PayUrl({ url }) {
  if (!url) {
    return (
      <Alert tone="warning" title="Bağlantı adresi yok">
        Misafir portalı ayarında portal adresi tanımlı değil; ödeme sayfası orada açılır.
      </Alert>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-item bg-surface-muted px-3 py-2 text-xs text-ink-soft" title={url}>
        {url}
      </code>
      <Button type="button" size="sm" variant="outline" icon="clipboard" onClick={() => copyPayLink(url)}>
        Kopyala
      </Button>
    </div>
  );
}
