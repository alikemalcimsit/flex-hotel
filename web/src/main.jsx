import React from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

const container = document.getElementById('root')

const tree = (
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

// Build sırasında her adres için HTML statik olarak üretilir
// (bkz. scripts/prerender.mjs); tarayıcı sadece üzerine bağlanır.
//
// Geliştirme sunucusunda böyle bir HTML yoktur, kap boştur. Boş kaba
// `hydrateRoot` çağırmak React'i her açılışta uyumsuzluk hatasına düşürüyor ve
// bu gürültü GERÇEK uyumsuzlukları görünmez kılıyordu — kapta içerik varsa
// bağlan, yoksa baştan çiz.
if (container.firstChild) hydrateRoot(container, tree)
else createRoot(container).render(tree)
