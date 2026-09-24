// lib/adapters/sitemap.mjs — کشف و استخراج از sitemap.xml
import { fetchText, mapLimit } from '../fetcher.mjs';
import { foldForSearch, parseAnyDate, stripHtml, detectKind, looksLikeTender } from '../text.mjs';
import { absolutize } from './html.mjs';

const TENDER_SLUG = ['مناقصه', 'مزایده', 'استعلام', 'فراخوان', 'tender', 'auction', 'agahi', 'مناقصات', 'مزایدات'];

function urlsFromSitemap(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].trim());
}

/** فهرست نشانی‌های مرتبط با مناقصه از sitemap */
export async function discoverFromSitemap(baseUrl, { timeout = 25000, maxSitemaps = 6 } = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const candidates = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`, `${base}/sitemap-index.xml`];
  let indexXml = null, indexUrl = null;
  for (const c of candidates) {
    const r = await fetchText(c, { timeout, retries: 0 });
    if (r.ok && /<urlset|<sitemapindex/i.test(r.body)) { indexXml = r.body; indexUrl = r.url || c; break; }
  }
  if (!indexXml) return { ok: false, urls: [], error: 'sitemap یافت نشد' };

  let urls = urlsFromSitemap(indexXml);
  // اگر sitemap index است، زیرنقشه‌های مرتبط را بخوان
  if (/<sitemapindex/i.test(indexXml)) {
    const subs = urls
      .filter(u => /post|news|article|مناقصه|مزایده|tender|content/i.test(u))
      .slice(0, maxSitemaps);
    const list = subs.length ? subs : urls.slice(0, 3);
    const results = await mapLimit(list, 3, async (s) => {
      const r = await fetchText(s, { timeout, retries: 0 });
      return r.ok ? urlsFromSitemap(r.body) : [];
    });
    urls = results.flat().filter(Boolean);
  }

  const tenderUrls = urls.filter(u => TENDER_SLUG.some(k => foldForSearch(decodeURIComponent(u)).includes(foldForSearch(k))));
  return { ok: true, urls: tenderUrls.length ? tenderUrls : urls, allCount: urls.length, tenderCount: tenderUrls.length, indexUrl };
}

/** آداپتر sitemap: نشانی‌های مناقصه‌ای را می‌گیرد و تیترشان را استخراج می‌کند */
export async function fetchSitemap(src, { timeout = 25000, maxPages = 25 } = {}) {
  const base = src.url.replace(/\/+$/, '');
  const d = await discoverFromSitemap(base, { timeout });
  if (!d.ok) return { ok: false, items: [], error: d.error, diagnostics: { api: 'sitemap', error: d.error } };

  const targets = d.urls.slice(0, maxPages);
  const items = [];
  const errors = [];
  const results = await mapLimit(targets, 5, async (u) => {
    const r = await fetchText(u, { timeout: Math.min(timeout, 18000), retries: 0 });
    if (!r.ok) return null;
    const h = r.body;
    const t = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1];
    const h1 = (h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ''])[1];
    let title = stripHtml(h1) || stripHtml(t);
    title = title.split(/[|\-–—]{1,2}/).map(s => s.trim()).filter(Boolean)[0] || title;
    if (!title || title.length < 12 || !looksLikeTender(title)) return null;
    const dm = h.match(/(?:datePublished|article:published_time)["'\s:=]+([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    const dd = parseAnyDate(dm ? dm[1] : '');
    return {
      title, url: u, description: '',
      publishedISO: dd.iso, publishedJalali: dd.jalali,
      deadlineISO: null, deadlineJalali: '', kind: detectKind(title),
    };
  });

  for (const r of results) {
    if (r && r.__error) { errors.push(r.__error); continue; }
    if (r) items.push(r);
  }
  return { ok: true, items, diagnostics: { api: 'sitemap', discovered: d.allCount, tenderUrls: d.tenderCount, fetched: targets.length, errors } };
}
