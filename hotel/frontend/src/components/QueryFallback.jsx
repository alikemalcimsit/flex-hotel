import { Alert, Button, Card, Spinner } from '@hotelos/ui';

/**
 * Tek kayıt yükleyen ekranların (otel bilgileri, genel parametreler)
 * yükleniyor/hata görünümü. Sorgu hazırsa `null` döner; ekran kendi içeriğini
 * çizer.
 *
 * `isLoading` değil `isPending` kullanılır: react-query v5'te `isLoading`
 * yeniden deneme aralarında kısa süre `false` oluyor. O boşlukta ne veri ne
 * hata var; `isLoading`'e bakan kod veriye erişip çöküyordu.
 *
 * @param {{ query: import('@tanstack/react-query').UseQueryResult, errorTitle: string }} props
 */
export function QueryFallback({ query, errorTitle }) {
  if (query.isPending) {
    return (
      <Card className="max-w-4xl">
        <Spinner className="py-8" />
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Alert
        tone="danger"
        title={errorTitle}
        className="max-w-4xl"
        action={
          <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
            Tekrar dene
          </Button>
        }
      >
        {query.error.message}
      </Alert>
    );
  }

  return null;
}
