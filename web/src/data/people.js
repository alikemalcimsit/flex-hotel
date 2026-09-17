/**
 * Ekip üyelerinin ayrıntılı bilgileri — kişiye özel sayfaların kaynağı.
 *
 * `hasPage: false` olan üye için ayrı sayfa üretilmez ve ekip kartı
 * bağlantı taşımaz; yarım dolu bir sayfa açmaktansa hiç açmamak daha iyi.
 * CV geldiğinde `hasPage` açılır.
 *
 * Buradaki hiçbir bilgi tahmin değildir; tamamı kişinin verdiği metinden gelir.
 */

export const PEOPLE = [
  {
    slug: 'ahmet-yusuf-demir',
    name: 'Ahmet Yusuf Demir',
    role: 'Kurucu Ortak',
    photo: 'ahmet-yusuf-demir',
    hasPage: true,
    headline: 'Yapay zekâ sistemleri ve LLM tabanlı ürün geliştirme',
    summary:
      'Yapay zekâ ve yazılım geliştirme alanında çalışan bir bilgisayar mühendisliği öğrencisiyim. Akademik eğitimimin yanında gerçek dünya projelerinde yapay zekâ sistemleri, LLM tabanlı uygulamalar ve yapay zekâ destekli ürünler geliştirmeye odaklandım.',
    closing:
      'Farklı disiplinlerden edindiğim deneyimleri birleştirerek, yapay zekâ alanında yenilikçi ve gerçek dünyada kullanılabilir ürünler geliştirmeyi hedefliyorum.',
    timeline: [
      {
        period: '2024',
        title: 'Bilgisayar Mühendisliği',
        place: 'Ankara',
        description: 'Bilgisayar mühendisliği eğitimine başladı.',
      },
      {
        period: '2024 · ~6 ay',
        title: 'Yapay Zekâ Geliştirme',
        place: 'TaleWorlds Entertainment',
        description:
          'Mount & Blade II: Bannerlord için geliştirilen War Sails DLC’sinin yapay zekâ tarafında çalıştı. Ticari ölçekte bir oyun projesinde yapay zekâ geliştirme deneyimi.',
      },
      {
        period: '12 ay',
        title: 'Yapay Zekâ Eğitimi',
        place: 'Arizona State University',
        description:
          'Yapay zekâ alanındaki teorik ve uygulamalı altyapısını geliştirdiği 12 aylık program.',
      },
      {
        period: 'Erzurum',
        title: 'MİZAN',
        place: 'Yapay zekâ destekli manevi asistan ve lifestyle tracker',
        description:
          'Yapay zekâyı günlük yaşam, kişisel takip ve manevi gelişim deneyimiyle bir araya getirmeyi amaçlayan ürünün geliştirilmesine başladı.',
      },
      {
        period: 'Proje',
        title: 'Motor Match Up',
        place: 'Yapay zekâ destekli araç performans simülasyonu',
        description:
          'Gerçek dünya fizik parametreleriyle araçların yarış dinamiklerini hesaplayan, farklı araçların performansını simüle edip karşılaştıran platformun geliştirilmesinde görev aldı.',
      },
      {
        period: 'Şu an',
        title: 'FlexAI',
        place: 'Kurucu Ortak',
        description:
          'Yapay zekâ teknolojilerini gerçek dünya problemlerine yönelik ürünlere dönüştürmek üzere çalışıyor.',
        current: true,
      },
    ],
    skills: {
      title: 'Uzmanlık',
      items: [
        'LangChain',
        'LangGraph',
        'AI orchestration',
        'LLM tabanlı uygulamalar',
        'Yapay zekâ sistemleri',
        'Oyun yapay zekâsı',
      ],
      note: 'LangChain, LangGraph ve AI orchestration alanlarında eğitimli; bu teknolojiler üzerine beşin üzerinde yapay zekâ projesi geliştirdi.',
    },
    languages: [
      { name: 'İngilizce', level: 'C1' },
      { name: 'Almanca', level: 'B2' },
    ],
    // Kamuya açık profil. Telefon numarası bilinçli olarak eklenmedi —
    // açık sitede spam toplar.
    links: [
      {
        label: 'Instagram',
        url: 'https://www.instagram.com/ahmetydemir/',
        icon: 'instagram',
      },
    ],
    // NOT: Bu maddeler eğlence amaçlı, ekip adına yazıldı — özgeçmiş bilgisi
    // değil. Kişi kendi metnini gönderdiğinde birebir değiştirilecek.
    funFacts: {
      title: 'Künye',
      items: [
        {
          icon: 'coffee',
          label: 'Kahve',
          value:
            'Türk kahvesi, orta şekerli. Filtre kahveyi “sadece su” diye savunanlarla arası iyi değil.',
        },
        {
          icon: 'clock',
          label: 'Kod saati',
          value:
            'Sabah erken. Ofis sessizken yazılan kodun daha az hata çıkardığına dair kişisel bir teorisi var.',
        },
        {
          icon: 'ball',
          label: 'Spor',
          value:
            'Basketbol. Sahada da kodda da tercihi aynı: pas, tek başına bitirmeye çalışmak yok.',
        },
        {
          icon: 'globe',
          label: 'Dil',
          value:
            'İngilizce C1, Almanca B2. Üçüncü dil olarak “prompt” sayılır mı, hâlâ tartışılıyor.',
        },
        {
          icon: 'sparkle',
          label: 'En sevdiği an',
          value: 'Bir aktörün ilk defa kendi başına doğru kararı verdiği an.',
        },
      ],
    },
  },
  {
    slug: 'ali-kemal-cimsit',
    name: 'Ali Kemal Cimşit',
    role: 'Kurucu Ortak',
    photo: 'ali-kemal-cimsit',
    hasPage: true,
    headline: 'Full-stack geliştirme ve otonom yapay zekâ aktör sistemleri',
    summary:
      'Üretimde çalışan, çok kiracılı ve gerçek zamanlı bir sağlık CRM platformunu React, Node.js, Prisma, MySQL ve Socket.IO ile geliştirdim. Bunun yanında kendi kodunu planlayan, yazan, gözden geçiren ve raporlayan sözleşme tabanlı çok aktörlü yapay zekâ sistemleri tasarlıyorum.',
    closing:
      'Katmanlı mimari, REST API tasarımı ve klasik backend mühendisliğini LLM destekli otomasyonla birleştirmeye odaklanıyorum.',
    // Kamuya açık mesleki profiller. Telefon numarası bilinçli olarak
    // eklenmedi — açık sitede spam toplar.
    links: [
      { label: 'GitHub', url: 'https://github.com/alikemalcimsit' },
      { label: 'LinkedIn', url: 'https://linkedin.com/in/ali-kemalcimsit' },
      { label: 'Kaggle', url: 'https://kaggle.com/alikemalcimsit' },
      {
        label: 'Instagram',
        url: 'https://www.instagram.com/alikemalcimsit/',
        icon: 'instagram',
      },
    ],
    timeline: [
      {
        period: '2021 – 2026',
        title: 'Bilgisayar Mühendisliği (Lisans)',
        place: 'Atatürk Üniversitesi',
        description: 'Lisans eğitimi.',
      },
      {
        period: 'Tem 2022 – Kas 2022',
        title: 'Frontend Geliştirici Stajyeri',
        place: 'Arteq Engineering · Uzaktan',
        description:
          'React tabanlı arayüz geliştirme ve Git ile ekip çalışmasındaki ilk profesyonel deneyim.',
      },
      {
        period: 'Tem 2024 – Eki 2024',
        title: 'Bilgisayar Mühendisliği Stajyeri',
        place: 'Kars Valiliği',
        description:
          'Kamu bilişim ortamında iç sistemlere ve idari yazılım süreçlerine destek verdi.',
      },
      {
        period: 'Haz 2025 – devam ediyor',
        title: 'Full-Stack Geliştirici',
        place: 'Pratik Bilişim',
        description:
          'Birden fazla hastane kiracısına hizmet veren, üretimde çalışan sağlık CRM platformu (React arayüz + v2 REST API).',
        bullets: [
          'Katmanlı mimariyle (Route → Controller → Service → Repository) uçtan uca özellik modülleri; Awilix ile bağımlılık enjeksiyonu, sayfalama/hata/yanıt biçimini standartlaştıran temel sınıflar.',
          'Node.js / Express v5 / Prisma v6 / MySQL üzerinde API: JWT ve refresh token, kayan oturum, rol bazlı erişim, ioredis ile önbellek, hız sınırlama, Helmet sertleştirmesi, istek doğrulama.',
          'Socket.IO ile gerçek zamanlı mesajlaşma, bildirim ve atama akışları; alan kapsamlı odalarla olaylar hastane bazında tamamen izole.',
          'Dış servis entegrasyonları: WhatsApp / Meta WABA şablon eşitleme ve gönderimi, IMAP/SMTP posta, sunucu tarafında PDF üretimi.',
          'React 18 + Vite + Redux Toolkit + SCSS Modules ile arayüz: veri tabloları, Recharts panelleri, sürükle-bırak akışları, Excel/PDF/Word dışa aktarımı.',
          'Aktörlerin okuyabildiği mühendislik kuralları (AGENTS.md); Docker ile paketleme, GitHub Actions CI/CD ile dağıtım.',
        ],
        current: true,
      },
      {
        period: 'Devam ediyor',
        title: 'Yüksek Lisans — Yapay Zekâ ve Veri Bilimi',
        place: 'Atatürk Üniversitesi',
        description: 'Yapay zekâ ve veri bilimi alanında yüksek lisans eğitimi.',
        current: true,
      },
      {
        period: 'Şu an',
        title: 'FlexAI',
        place: 'Kurucu Ortak',
        description:
          'Yapay zekâ destekli iş yazılımları geliştiriyor; FlexHotel’in mimarisi ve altyapısı üzerinde çalışıyor.',
        current: true,
      },
    ],
    projects: [
      {
        title: 'CRM AI Agent System',
        subtitle: 'Trello ile tetiklenen otonom kodlama akışı',
        stack: 'Node.js (ESM) · OpenAI & Anthropic API · Playwright · Trello Webhooks',
        description:
          'Trello kartı → belirsiz kartları eleyen görev kapısı → planlayıcı → JSON şemalı görev sözleşmesi (kapsam, hedef, davranış, kısıt, bitti tanımı) → sözleşme kapsamında kod yazan geliştirici aktörü → sözleşmeyle karşılaştıran gözden geçirici → kendi kendini onaran düzeltme döngüsü → Trello’ya rapor. Doğrulama, Playwright ile otomatik giriş ve hedefli ekran görüntüleriyle yapılıyor.',
      },
      {
        title: 'AI Agent Learning Track',
        subtitle: 'ReAct, LangChain, RAG',
        stack: 'Yapılandırılmış not ve kod depoları',
        description:
          'ReAct çerçevesi ve tam aktör döngüsü (Düşünce → Eylem → Gözlem), üç katmanlı LLM + Prompt + Araç mimarisi, karalama belleği, LangChain düzenlemesi ve vektör veritabanlarıyla RAG.',
      },
      {
        title: 'Yemekhane',
        subtitle: 'Mobil uygulama',
        stack: 'React Native · Expo SDK 51',
        description:
          'Expo akışını ve React Native temellerini keşfetmek için geliştirilen çok platformlu mobil uygulama.',
      },
    ],
    skillGroups: [
      { title: 'Diller', items: ['JavaScript (ES6+)', 'Python', 'SQL'] },
      {
        title: 'Frontend',
        items: [
          'React 18',
          'Next.js',
          'Vite',
          'Redux Toolkit',
          'React Router',
          'SCSS / Sass Modules',
          'Tailwind CSS',
          'Styled Components',
          'react-hook-form',
          'Zod',
        ],
      },
      {
        title: 'Backend',
        items: [
          'Node.js',
          'Express v5 (ESM)',
          'Awilix (DI)',
          'Prisma v6',
          'Socket.IO v4',
          'ioredis',
          'imapflow',
          'nodemailer',
          'multer',
          'pdf-lib',
        ],
      },
      {
        title: 'Veritabanı',
        items: ['MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Firebase'],
      },
      {
        title: 'Mimari',
        items: ['Katmanlı mimari', 'Clean Architecture', 'SOLID', 'MVC', 'Çok kiracılı desenler'],
      },
      {
        title: 'Yapay zekâ ve aktörler',
        items: [
          'OpenAI & Anthropic API',
          'Prompt mühendisliği',
          'ReAct',
          'Araç / fonksiyon çağırma',
          'Aktör döngüleri',
          'Sözleşme tabanlı çok aktörlü akışlar',
          'LangChain',
          'RAG ve vektör veritabanları',
        ],
      },
      {
        title: 'Kimlik ve güvenlik',
        items: [
          'JWT + refresh token',
          'OAuth',
          'bcrypt',
          'Helmet',
          'CORS',
          'express-rate-limit',
          'express-validator',
          'Joi',
        ],
      },
      {
        title: 'DevOps ve test',
        items: [
          'Git / GitHub / GitLab',
          'Docker',
          'GitHub Actions CI/CD',
          'Nginx',
          'Vercel',
          'AWS',
          'Render',
          'Jest',
          'Mocha',
          'Supertest',
          'Postman',
          'Playwright',
        ],
      },
      {
        title: 'Mobil ve süreç',
        items: ['React Native', 'Expo', 'Agile / Scrum', 'Kod incelemesi', 'Jira', 'Trello'],
      },
    ],
    languages: [
      { name: 'Türkçe', level: 'Ana dil' },
      { name: 'İngilizce', level: 'Profesyonel' },
    ],
    // NOT: Bu maddeler eğlence amaçlı yazıldı — özgeçmiş bilgisi değil.
    funFacts: {
      title: 'Künye',
      items: [
        {
          icon: 'coffee',
          label: 'Kahve',
          value:
            'Sade filtre, günde üç. Dördüncüden sonra yazdığı kodun incelemesini ertesi güne bırakıyor.',
        },
        {
          icon: 'clock',
          label: 'Kod saati',
          value: 'Gece yarısından sonra. Sabah dokuza toplantı koyan arkadaş, seni görüyor.',
        },
        {
          icon: 'ball',
          label: 'Spor',
          value: 'Halı saha, haftada bir. Kaleci değil ama kaleye nedense hep o geçiyor.',
        },
        {
          icon: 'keyboard',
          label: 'Vazgeçilmez',
          value: 'Terminal, mekanik klavye ve bir tane fazla açılmış Trello sekmesi.',
        },
        {
          icon: 'bug',
          label: 'Hata ayıklama tarzı',
          value: 'Önce console.log. Gururu kırılınca debugger. İkisi de olmazsa kahve molası.',
        },
      ],
    },
  },
]

/** @param {string} slug @returns {(typeof PEOPLE)[number] | undefined} */
export function findPerson(slug) {
  return PEOPLE.find((person) => person.slug === slug)
}
