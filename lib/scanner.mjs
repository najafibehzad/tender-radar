// lib/scanner.mjs — هماهنگ‌کنندهٔ اسکن همهٔ منابع
import { fetchWordPress } from './adapters/wordpress.mjs';
import { fetchHtml, dedupe } from './adapters/html.mjs';
import { fetchRss } from './adapters/rss.mjs';
import { fetchSitemap } from './adapters/sitemap.mjs';
import { fetchOData } from './adapters/odata.mjs';
import { fetchSetadiran } from './adapters/setadiran.mjs';
import { fetchDidehban } from './adapters/didehban.mjs';
import { mapLimit } from './fetcher.mjs';
import {
  foldForSearch, normalizeFa, matchTopic, detectKind, looksLikeTender,
  daysUntil, todayTehran, toAsciiDigits,
} from './text.mjs';
import { inferLocation } from './cities.mjs';

/** اجرای آداپتر مناسب یک منبع */
async function runAdapter(src, ctx) {
  const t0 = Date.now();
  // مهلت هر منبع: می‌تواند در خود منبع بازنویسی شود (src.timeoutMs)
  const timeout = Math.min(Number(src.timeoutMs) || ctx.timeout, 120000);
  const c = { ...ctx, timeout };
  let res;
  try {
    switch (src.adapter) {
      case 'wordpress': res = await fetchWordPress(src, { queries: c.queries, timeout, perQuery: 20 }); break;
      case 'rss':       res = await fetchRss(src, { timeout }); break;
      case 'sitemap':   res = await fetchSitemap(src, { timeout }); break;
      case 'odata':     res = await fetchOData(src, { timeout }); break;
      case 'setadiran': res = await fetchSetadiran(src, { timeout, lookbackDays: c.lookbackDays }); break;
      case 'didehban':  res = await fetchDidehban(src, { timeout }); break;
      case 'html':
      default:          res = await fetchHtml(src, { timeout }); break;
    }
  } catch (e) {
    res = { ok: false, items: [], error: String(e && e.message || e) };
  }
  return { ...res, ms: Date.now() - t0 };
}

/**
 * یک آیتم خام را به شکل یکپارچه درمی‌آورد.
 */
function normalizeItem(raw, src, topics) {
  const title = normalizeFa(raw.title || '').slice(0, 400);
  if (!title) return null;
  const description = normalizeFa(raw.description || '').slice(0, 900);
  const hay = foldForSearch(`${title} ${description}`);

  let srcCity = normalizeFa(raw.city || src.city || '');
  // یکسان‌سازی نام شهر: حذف پیشوند «شهر » (مثلاً «شهر قدس» → «قدس»)
  srcCity = srcCity.replace(/^شهر\s+/, '');
  // «کشور» یک مقدار جانگهدار برای تجمیع‌کننده‌هاست، نه استان واقعی
  let province = normalizeFa(raw.province || src.province || '');
  if (province === 'کشور') province = '';

  // تشخیص خودکار شهر/استان از متن آگهی (برای تجمیع‌کننده‌ها و منابع بدون شهر)
  let inferred = null;
  if (!srcCity) {
    inferred = inferLocation(`${title} ${description} ${raw.org || ''} ${raw.locationRaw || ''}`);
    if (inferred && !province && inferred.province) province = inferred.province;
  }
  const city = srcCity || (inferred && inferred.city) || '';

  const topicHits = [];
  for (const t of topics) {
    if (t._disabled) continue;
    const hits = matchTopic(hay, t.words || []);
    if (hits.length) topicHits.push({ id: t.id, name: t.name, hits });
  }

  const today = todayTehran().iso;
  const daysLeft = daysUntil(raw.deadlineISO, today);

  return {
    id: `${src.id}:${foldForSearch(title).slice(0, 60)}`,
    title,
    description,
    url: raw.url || src.url,
    city, province,
    sourceId: src.id,
    sourceName: src.name,
    sourceType: src.type || 'شهرداری',
    sourceUrl: src.url,
    kind: raw.kind && raw.kind !== 'سایر' ? raw.kind : detectKind(`${title} ${description}`),
    org: normalizeFa(raw.org || src.name),
    publishedISO: raw.publishedISO || null,
    publishedJalali: raw.publishedJalali || '',
    deadlineISO: raw.deadlineISO || null,
    deadlineJalali: raw.deadlineJalali || '',
    daysLeft,
    topics: topicHits.map(t => t.name),
    topicIds: topicHits.map(t => t.id),
    keywords: [...new Set(topicHits.flatMap(t => t.hits))],
    locationRaw: raw.locationRaw || '',
    inferredLocation: inferred,
    fetchedAt: new Date().toISOString(),
  };
}

/** حذف تکراری‌ها در کل مجموعه (عنوان + شهر) */
function globalDedupe(items) {
  const byKey = new Map();
  for (const it of items) {
    const k = foldForSearch(it.title).slice(0, 80) + '|' + foldForSearch(it.city);
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, it); continue; }
    // ترجیح: منبع رسمی، سپس دارای مهلت، سپس جدیدتر
    const score = x => (x.sourceType === 'شهرداری' ? 2 : x.sourceType === 'دهیاری' ? 2 : 0)
      + (x.deadlineISO ? 1 : 0) + (x.publishedISO ? 0.5 : 0);
    if (score(it) > score(prev)) {
      it.alsoSeenAt = [...(prev.alsoSeenAt || []), { source: prev.sourceName, url: prev.url }];
      byKey.set(k, it);
    } else {
      prev.alsoSeenAt = [...(prev.alsoSeenAt || []), { source: it.sourceName, url: it.url }];
    }
  }
  return [...byKey.values()];
}

/**
 * اسکن کامل.
 * @param {object} registry
 * @param {{onProgress?:Function, onlySourceIds?:string[], concurrency?:number}} opts
 */
export async function scanAll(registry, opts = {}) {
  const startedAt = Date.now();
  const settings = registry.settings || {};
  const timeout = opts.timeout || settings.requestTimeoutMs || 30000;
  const concurrency = opts.concurrency || 6;

  const activeTopics = (registry.topics || []).filter(t => !t._disabled);
  // پرس‌وجوهای وردپرس: سه واژهٔ پایه + چند واژهٔ موضوعی.
  // هر پرس‌وجو یک درخواست جداگانه است، پس تعدادش مستقیم روی سرعت اثر دارد.
  // سه واژهٔ پایه تقریباً همهٔ آگهی‌ها را می‌گیرند؛ واژه‌های موضوعی فقط تکمیل‌کننده‌اند.
  const maxQueries = Math.min(Math.max(Number(settings.wpMaxQueries) || 5, 3), 10);
  const queries = [...new Set([
    'مناقصه', 'مزایده', 'استعلام',
    ...activeTopics.flatMap(t => (t.words || []).slice(0, 2)),
  ])].filter(Boolean).slice(0, maxQueries);

  let sources = (registry.sources || []).filter(s => !s._disabled);
  if (opts.onlySourceIds && opts.onlySourceIds.length) {
    sources = sources.filter(s => opts.onlySourceIds.includes(s.id));
  }

  const ctx = { queries, timeout, lookbackDays: settings.lookbackDays || 0 };
  let done = 0;
  const results = await mapLimit(sources, concurrency, async (src) => {
    const r = await runAdapter(src, ctx);
    done++;
    if (opts.onProgress) opts.onProgress({ done, total: sources.length, source: src.name, count: (r.items || []).length, ok: r.ok });
    return { src, ...r };
  });

  const rawItems = [];
  const sourceReports = [];
  for (const r of results) {
    if (!r || !r.src) continue;
    const { src } = r;
    let items = (r.items || []).map(it => normalizeItem(it, src, registry.topics || [])).filter(Boolean);

    // فیلتر زمانی (پنجرهٔ بازیابی)
    const lookback = settings.lookbackDays || 120;
    const cutoff = new Date(Date.now() - lookback * 86400000).toISOString().slice(0, 10);
    const before = items.length;
    items = items.filter(it => !it.publishedISO || it.publishedISO >= cutoff);
    const droppedOld = before - items.length;

    // سقف هر منبع: می‌تواند در خود منبع بازنویسی شود (ستاد سهم طبیعی بزرگ‌تری دارد)
    const cap = Number(src.maxItems) || settings.maxItemsPerSource || 300;
    const capped = items.length > cap;
    if (capped) items = items.slice(0, cap);

    rawItems.push(...items);
    sourceReports.push({
      id: src.id,
      name: src.name,
      city: src.city, province: src.province, type: src.type,
      url: src.url,
      adapter: src.adapter,
      ok: !!r.ok,
      count: items.length,
      droppedOld,
      capped,
      ms: r.ms || 0,
      error: r.error || (r.diagnostics && r.diagnostics.errors && r.diagnostics.errors.length ? r.diagnostics.errors.join(' | ') : null),
      diagnostics: r.diagnostics || null,
      scannedAt: new Date().toISOString(),
    });
  }

  const deduped = globalDedupe(rawItems);
  // مرتب‌سازی: جدیدترین انتشار
  deduped.sort((a, b) => String(b.publishedISO || '').localeCompare(String(a.publishedISO || '')));

  const okSources = sourceReports.filter(s => s.ok).length;
  const stats = {
    total: deduped.length,
    byKind: countBy(deduped, i => i.kind),
    byProvince: countBy(deduped, i => i.province || 'نامشخص'),
    byCity: countBy(deduped, i => i.city || 'نامشخص'),
    byTopic: countBy(deduped.flatMap(i => i.topics.length ? i.topics : ['بدون موضوع']), x => x),
    withDeadline: deduped.filter(i => i.deadlineISO).length,
    urgent: deduped.filter(i => i.daysLeft != null && i.daysLeft >= 0 && i.daysLeft <= 3).length,
    today: deduped.filter(i => i.publishedISO === todayTehran().iso).length,
  };

  return {
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    sourcesTotal: sourceReports.length,
    sourcesOk: okSources,
    sourcesFailed: sourceReports.length - okSources,
    items: deduped,
    sources: sourceReports,
    stats,
  };
}

function countBy(arr, fn) {
  const m = {};
  for (const x of arr) { const k = fn(x) || 'نامشخص'; m[k] = (m[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

export { normalizeItem, globalDedupe };
