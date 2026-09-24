// lib/adapters/html.mjs — استخراج عمومی از HTML (شامل سایت‌های دورتال/ASP.NET)
import { fetchText, mapLimit } from '../fetcher.mjs';
import {
  stripHtml, normalizeFa, toAsciiDigits, foldForSearch,
  parseAnyDate, detectKind, looksLikeTender, TENDER_WORDS,
} from '../text.mjs';

// برچسب‌های منو/ناوبری که «آگهی» نیستند
const NAV_LABELS = [
  'مناقصه و مزایده', 'مناقصات و مزایدات', 'مزایده و مناقصه', 'مناقصه', 'مزایده', 'استعلام',
  'استعلام بها', 'اطلاعیه ها', 'اطلاعیه‌ها', 'اخبار', 'فراخوان ها', 'فراخوان‌ها',
  'مزایده، مناقصه و استعلام', 'مناقصات', 'مزایدات', 'آرشیو', 'بیشتر', 'ادامه مطلب',
];

function isNavLabel(text) {
  const t = normalizeFa(text).replace(/\s+/g, ' ').trim();
  if (t.length < 22) {
    const f = foldForSearch(t);
    if (NAV_LABELS.some(l => foldForSearch(l) === f)) return true;
  }
  if (/^(ادامه|بیشتر|مشاهده|جزئیات|اطلاعات بیشتر|بعدی|قبلی|صفحه بعد)/.test(t)) return true;
  return false;
}

/** تاریخ‌های موجود در یک قطعه متن */
function datesIn(text) {
  const t = toAsciiDigits(normalizeFa(text));
  const out = [];
  const re = /(1[34]\d{2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/g;
  let m;
  while ((m = re.exec(t)) !== null) out.push(`${m[1]}/${m[2]}/${m[3]}`);
  return out;
}

/**
 * استخراج آیتم‌های مناقصه از یک صفحهٔ HTML.
 * @param {string} html
 * @param {string} pageUrl
 * @param {{keywords?:string[], minLen?:number, maxLen?:number}} opts
 */
export function extractItemsFromHtml(html, pageUrl, opts = {}) {
  const minLen = opts.minLen ?? 20;
  const maxLen = opts.maxLen ?? 320;
  const items = [];
  const seen = new Set();

  // 1) لینک‌های دارای متن معنادار
  const re = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]{0,600}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const rawHref = m[1] ?? m[2] ?? m[3] ?? '';
    const innerHtml = m[4] || '';
    const text = stripHtml(innerHtml);
    if (!text || text.length < minLen || text.length > maxLen) continue;
    if (isNavLabel(text)) continue;
    if (!looksLikeTender(text)) continue;
    // متن‌های تکراری/عمومی
    if (/^(چاپ|ارسال|دانلود|مشاهده|کلیک|اینجا)/.test(text)) continue;

    // زمینه برای یافتن تاریخ (پیرامون لنگر)
    const start = Math.max(0, m.index - 500);
    const ctx = stripHtml(html.slice(start, Math.min(html.length, m.index + m[0].length + 400)));
    const ds = datesIn(ctx);

    let href = rawHref.trim();
    if (/^javascript:/i.test(href) || href === '#' || href === '') href = pageUrl;
    else href = absolutize(href, pageUrl);

    const key = foldForSearch(text).slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      title: text,
      url: href,
      context: ctx.slice(0, 400),
      dateCandidates: ds,
      publishedJalali: ds[0] || '',
      publishedISO: ds[0] ? (parseAnyDate(ds[0]).iso || null) : null,
      deadlineJalali: ds.length > 1 ? ds[ds.length - 1] : '',
      deadlineISO: ds.length > 1 ? (parseAnyDate(ds[ds.length - 1]).iso || null) : null,
      kind: detectKind(text),
    });
  }

  // 2) تیترهای ساختاری (h1..h4) که لینک نیستند — برای سایت‌های بدون لینک قابل کلیک
  const hre = /<h([1-4])\b[^>]*>([\s\S]{0,400}?)<\/h\1>/gi;
  while ((m = hre.exec(html)) !== null) {
    const text = stripHtml(m[2]);
    if (!text || text.length < minLen || text.length > maxLen) continue;
    if (isNavLabel(text) || !looksLikeTender(text)) continue;
    const key = foldForSearch(text).slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Math.max(0, m.index - 400);
    const ctx = stripHtml(html.slice(start, Math.min(html.length, m.index + m[0].length + 300)));
    const ds = datesIn(ctx);
    items.push({
      title: text, url: pageUrl, context: ctx.slice(0, 400),
      dateCandidates: ds,
      publishedJalali: ds[0] || '', publishedISO: ds[0] ? (parseAnyDate(ds[0]).iso || null) : null,
      deadlineJalali: ds.length > 1 ? ds[ds.length - 1] : '',
      deadlineISO: ds.length > 1 ? (parseAnyDate(ds[ds.length - 1]).iso || null) : null,
      kind: detectKind(text),
    });
  }

  return items;
}

export function absolutize(href, base) {
  try { return new URL(href, base).toString(); } catch { return href; }
}

/**
 * آداپتر عمومی HTML: چند صفحه را می‌خواند و آیتم‌ها را برمی‌گرداند.
 * src.pages: فهرست نشانی‌ها (اگر نباشد: homepage + مسیرهای متداول)
 */
export async function fetchHtml(src, { timeout = 30000 } = {}) {
  const base = src.url.replace(/\/+$/, '');
  const pages = (src.pages && src.pages.length) ? src.pages.map(p => absolutize(p, base)) : [base + '/'];
  const all = [];
  const diagnostics = { api: 'html', pages: [], errors: [] };

  const results = await mapLimit(pages, 3, async (p) => {
    // سایت‌های شهرداری کند هستند و زیر بار هم‌زمانی تایم‌اوت می‌دهند → یک تلاش مجدد.
    // (بیشتر از این، برای میزبان‌های کاملاً مسدود فقط وقت اسکن را می‌خورد؛
    //  خطاهای قطعی مثل ENOTFOUND/ECONNREFUSED در خود fetcher بدون تلاش مجدد برمی‌گردند.)
    const r = await fetchText(p, { timeout, retries: 1 });
    if (!r.ok) return { page: p, status: r.status, error: r.error || `HTTP ${r.status}`, items: [] };
    const items = extractItemsFromHtml(r.body, r.url || p, { keywords: src.keywords });
    return { page: p, status: r.status, count: items.length, items };
  });

  for (const res of results) {
    if (res && res.__error) { diagnostics.errors.push(res.__error); continue; }
    diagnostics.pages.push({ url: res.page, status: res.status, count: res.count || 0, error: res.error });
    if (res.error) diagnostics.errors.push(`${res.page}: ${res.error}`);
    for (const it of (res.items || [])) all.push(it);
  }

  const ok = diagnostics.pages.some(p => p.status === 200);
  return { ok, items: dedupe(all), diagnostics };
}

export function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = foldForSearch(it.title).slice(0, 100);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
