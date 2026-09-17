/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      /*
       * Tasarım DarkMinimal şablonundan (MIT, Andres Hernandez / ThemeWagon)
       * alındı. Şablon renkleri CSS değişkeni olarak tutuyordu; burada aynı
       * değerler semantik token oldu — bileşenlerde ham hex kullanılmaz.
       *
       * Tek fark vurgu rengi: şablonun moru (#A476FF) yerine FlexAI kırmızısı.
       * Logo ve sektör kilitleri kırmızı; mor bir vurgu onlarla çatışıyordu.
       * Başka bir vurguya dönmek için yalnızca `sec` değişir.
       */
      colors: {
        background: '#101010',
        panel: 'rgba(20, 20, 20, 0.61)',
        card: '#1a1a1a',
        ink: '#dfdfdf',
        'ink-muted': 'rgba(243, 243, 243, 0.6)',
        line: 'rgba(255, 255, 255, 0.063)',
        'line-soft': 'rgba(243, 243, 243, 0.063)',
        sec: '#EF4444',
        'sec-light': '#FEE2E2',
      },
      /*
       * sans  — şablonun tek ailesi, Montserrat. latin-ext dosyası da
       *         yükleniyor; Türkçe harfler (ş, ğ, İ) oradan geliyor.
       * brand — yalnızca logo ve "Flex" kilidi. Hero'daki 3B animasyon bu
       *         fontun harflerinden mesafe alanı üretiyor (sectors.js); logo
       *         ile animasyon ayrışmasın diye ayrı tutuluyor.
       */
      fontFamily: {
        sans: ['"Montserrat Variable"', '-apple-system', 'system-ui', 'sans-serif'],
        brand: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        scroll: {
          from: { transform: 'translate3d(0, 0, 0)' },
          to: { transform: 'translate3d(-50%, 0, 0)' },
        },
        shine: {
          '0%': { backgroundPosition: '100% 50%' },
          '30%, 70%': { backgroundPosition: '0% 50%' },
        },
        unlock: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        scroll: 'scroll 60s linear infinite',
        'scroll-fast': 'scroll 50s linear infinite',
        shine: 'shine 3s linear infinite',
        unlock: 'unlock 450ms cubic-bezier(0.34, 1.42, 0.64, 1) both',
      },
    },
  },
  plugins: [],
}
