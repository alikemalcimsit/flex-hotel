# notification-worker

Ortak worker (LLM'siz): olay olunca misafir bildirimlerini gönderim kuyruğuna yazdırır.
Olay → bildirim eşlemesi ve kuyruğa yazan servis dışarıdan verilir (bkz. `index.js`);
otel kurulumu `hotel/backend/src/lib/actors.js` içinde.
