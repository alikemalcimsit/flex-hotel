import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { parseAssetCode } from '@hotelos/hotel-contracts';
import { Alert, Card, Spinner } from '@hotelos/ui';
import { api } from '../../lib/api.js';
import { assetKeys, assetPath } from '../../lib/assets.js';

/**
 * Etiketteki QR'ın açtığı adres (`/demirbas/k/DM-000123`, modül 46): kodla kart bulunup karta yönlendirilir.
 * Telefon kamerasıyla okutan personel giriş yapmışsa doğrudan kartı görür.
 */
export function AssetQrRedirect() {
  const { code: raw } = useParams();
  const code = parseAssetCode(raw ?? '');
  const query = useQuery({ queryKey: assetKeys.byCode(code ?? ''), queryFn: () => api(`/assets/by-code/${encodeURIComponent(code)}`), enabled: Boolean(code), retry: false });

  if (!code) return <Alert tone="danger" title="Etiket okunamadı">Bu bağlantıda geçerli bir demirbaş kodu yok (ör. DM-000123).</Alert>;
  if (query.data) return <Navigate to={assetPath(query.data.id)} replace />;
  if (query.isError) {
    return (
      <Alert tone="danger" title={`${code} bulunamadı`}>
        {query.error.status === 404 ? 'Bu kodla bir demirbaş kartı yok; etiket başka otele ait olabilir.' : query.error.message}
      </Alert>
    );
  }
  return (
    <Card className="max-w-md">
      <Spinner className="py-6" />
      <p className="text-center text-sm text-ink-muted">{code} açılıyor…</p>
    </Card>
  );
}
