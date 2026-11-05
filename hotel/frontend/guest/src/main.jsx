import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './guest.css';

/*
 * Derin bağlantı: sunucu `/misafir/...` yolunu tanımıyorsa panelin sayfası açılır ve misafiri
 * `/misafir/index.html?p=<yol>` ile buraya yollar (panelin index.html'i). Asıl yol adres çubuğuna geri yazılır; yenilemede
 * yine çalışır.
 */
const params = new URLSearchParams(window.location.search);
const original = params.get('p');
if (original && original.startsWith('/misafir/')) window.history.replaceState(null, '', original);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
