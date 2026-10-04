# @hotelos/mcp-server

Salt okunur raporlama MCP sunucusu (modül 23). Tüketicisi report-agent (modül 24)
ya da stdio üzerinden bir masaüstü MCP istemcisi.

Paket ürün bilmez; araçları çağıran verir:

```js
import { connectInProcess, createReadOnlyMcpServer, serveStdio } from '@hotelos/mcp-server';

const server = createReadOnlyMcpServer({
  name: 'hotelos-reporting',
  version: '1.0.0',
  tools: [{ name, title, description, input: zodObject, readOnly: true, handler }],
});
const { client, close } = await connectInProcess(server); // aynı süreçteki ajan
await serveStdio(server); // süreç dışı istemci
```

Kurallar:

- Yalnızca `readOnly: true` araç kaydedilir; araçlar `readOnlyHint` ile ilan edilir.
- Girdi şemanın tamamıyla (alanlar arası kurallar dahil) doğrulanır.
- Beklenen hata (4xx) mesajıyla, beklenmeyen hata genel mesajla döner; iç ayrıntı
  modele sızmaz.

Otelin araçları (`get_occupancy`, `get_revenue`, `run_report_query`):
`hotel/backend/src/modules/reports/mcp.js`; stdio girişi
`hotel/backend/scripts/reporting-mcp.js` (`npm run mcp:reporting -w @hotelos/hotel-backend`).
Sorgular salt okunur işlemde (`SET TRANSACTION READ ONLY`) ve süre sınırıyla çalışır;
`REPORTING_DATABASE_URL` ile ayrı, yalnızca okuma yetkili bir veritabanı kullanıcısı verilebilir.
