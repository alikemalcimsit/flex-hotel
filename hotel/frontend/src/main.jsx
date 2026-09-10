import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import './index.css';

/**
 * react-query varsayılanları.
 *
 * Varsayılan ayarlarla başarısız bir istek 3 kez, artan gecikmelerle yeniden
 * deneniyordu: backend 2 saniyede "hata" dese bile kullanıcı yarım dakika
 * spinner'a bakıyordu. Oysa doğrulama hatası (400) veya "bulunamadı" (404)
 * tekrar denemekle düzelmez — yalnızca ağ/sunucu hatası geçici olabilir.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // İstemci hatası kendiliğinden düzelmez: hemen göster.
        if (error?.status >= 400 && error?.status < 500) return false;
        return failureCount < 1;
      },
      retryDelay: 1000,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Yazma işlemi otomatik tekrarlanmaz: aynı kaydı iki kez oluşturma riski.
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
