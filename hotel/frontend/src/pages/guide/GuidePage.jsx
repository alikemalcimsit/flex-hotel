import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import { Input } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';

/**
 * Kılavuz: uygulama içi kullanım ve mimari dökümanı. Bölümler `src/guide/*.md` dosyalarından derleme anında
 * toplanır (dosya adı sırası = bölüm sırası; ilk `#` başlık = bölüm adı). Sol tarafta bölüm listesi ve
 * bölüm içi başlıklar, üstte başlıklarda arama. Herkes görür; içerik rol ayrımı yapmaz.
 */

const sources = import.meta.glob('../../guide/*.md', { query: '?raw', import: 'default', eager: true });

/** Başlıktan bağlantı kimliği: Türkçe karakterler sadeleşir, boşluk tire olur. */
export function slugify(text) {
  return String(text)
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** @param {string} path */
const fileSlug = (path) => path.split('/').pop().replace(/\.md$/, '').replace(/^\d+-/, '');

/** Dosyadan bölüm: ad, kimlik, HTML ve başlık listesi (## / ###). */
function compile(path, markdown) {
  const lines = markdown.split('\n');
  const titleLine = lines.find((line) => /^#\s+/.test(line));
  const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : fileSlug(path);
  const headings = [];
  const renderer = new marked.Renderer();
  const seen = new Map();
  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map((token) => token.text ?? token.raw ?? '').join('');
    let id = slugify(text) || `baslik-${headings.length + 1}`;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count) id = `${id}-${count + 1}`;
    if (depth === 2 || depth === 3) headings.push({ id, text, depth });
    return `<h${depth} id="${id}">${marked.parseInline(text)}</h${depth}>`;
  };
  const html = marked.parse(markdown, { renderer, gfm: true, breaks: false });
  return { slug: fileSlug(path), title, html, headings, markdown };
}

export function GuidePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const sections = useMemo(() => Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([path, markdown]) => compile(path, markdown)), []);
  const current = sections.find((section) => section.slug === slug) ?? sections[0];

  useEffect(() => {
    if (!slug && sections[0]) navigate(`/kilavuz/${sections[0].slug}`, { replace: true });
  }, [slug, sections, navigate]);
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }, [current?.slug]);

  const query = search.trim().toLocaleLowerCase('tr');
  const hits = useMemo(() => {
    if (!query) return [];
    return sections.flatMap((section) => section.headings.filter((heading) => heading.text.toLocaleLowerCase('tr').includes(query)).map((heading) => ({ section, heading }))).slice(0, 40);
  }, [query, sections]);

  if (!current) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Kılavuz" description="Henüz kılavuz bölümü yok." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Kılavuz" description="Sistemi yeni öğrenen için kullanım rehberi ve 'arka planda ne oluyor' anlatımı. Bölümler soldan, başlıklar aramadan." />
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <Input label="Başlıkta ara" name="guide-search" placeholder="ör. sayım, onay, folyo" value={search} onChange={(event) => setSearch(event.target.value)} />
          {query ? (
            <nav aria-label="Arama sonuçları" className="rounded-card bg-surface p-3 shadow-card">
              {hits.length === 0 && <p className="px-2 py-1 text-sm text-ink-muted">Eşleşen başlık yok.</p>}
              <ul className="flex flex-col gap-0.5">
                {hits.map(({ section, heading }) => (
                  <li key={`${section.slug}-${heading.id}`}>
                    <Link to={`/kilavuz/${section.slug}#${heading.id}`} onClick={() => setSearch('')} className="block rounded-item px-2 py-1 text-sm hover:bg-surface-muted">
                      <span className="block font-semibold text-ink">{heading.text}</span>
                      <span className="block text-xs text-ink-muted">{section.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <nav aria-label="Kılavuz bölümleri" className="rounded-card bg-surface p-3 shadow-card">
              <ul className="flex flex-col gap-0.5">
                {sections.map((section) => (
                  <li key={section.slug}>
                    <Link to={`/kilavuz/${section.slug}`} aria-current={section.slug === current.slug ? 'page' : undefined} className={`block rounded-item px-3 py-2 text-sm font-semibold ${section.slug === current.slug ? 'bg-ink text-surface' : 'text-ink hover:bg-surface-muted'}`}>
                      {section.title}
                    </Link>
                    {section.slug === current.slug && section.headings.length > 0 && (
                      <ul className="my-1 ml-2 flex flex-col gap-0.5 border-l border-line pl-2">
                        {section.headings.map((heading) => (
                          <li key={heading.id}>
                            <a href={`#${heading.id}`} className={`block rounded-item px-2 py-1 text-xs text-ink-soft hover:bg-surface-muted hover:text-ink ${heading.depth === 3 ? 'pl-5' : ''}`}>
                              {heading.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>
        <article className="guide-prose min-w-0 rounded-card bg-surface p-6 shadow-card sm:p-10" dangerouslySetInnerHTML={{ __html: current.html }} />
      </div>
    </div>
  );
}
