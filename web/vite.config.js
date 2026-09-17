import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Otel paneli 5173'ü kullanıyor — çakışmasın.
    port: 5174,
  },
})
