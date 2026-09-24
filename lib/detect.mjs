// lib/detect.mjs — تشخیص خودکار نوع سامانهٔ یک سایت و کشف مسیر آگهی‌ها
import { fetchText, fetchJson } from './fetcher.mjs';
import { extractItemsFromHtml, absolutize } from './adapters/html.mjs';
import { discoverFromSitemap } from './adapters/sitemap.mjs';
import { foldForSearch } from './text.mjs';

const TENDER_PATH_HINTS = ['مناقصه', 'مزایده', 'استعلام', 'فراخوان', 'tender', 'auction', 'مناقصات', 'مزایدات', 'آگهی'];

/**
 * یک نشانی را بررسی می‌کند: نوع آداپتر، فیدها، مسیر آگهی‌ها، و نمونهٔ آیتم‌ها.
 * @returns {Promise<object>}
 */
export async function detectSource(rawUrl, { timeout = 25000 } = {}) {
  const url = normalizeUrl(rawUrl);
  const base = url.replace(/\/+$/, '');
  const report = {
    url: base,
    reachable: false,
    adapter: 'html',
    title: '',
    feeds: [],
    pages: [],
    sitemap: null,
    sampleItems: [],
    notes: [],
    error: null,
  };

  const home = await fetchText(base + '/', { timeout, retries: 1 });
  if (!home.ok) {
    report.error = home.error || `HTTP ${home.status}`;
    // حتی اگر صفحه اصلی نیامد، ممکن است API وردپرس کار کند
    const wp = await fetchJson(`${base}/wp-json/wp/v2/posts?per_page=1`, { timeout: Math.min(timeout, 15000), retries: 0 });
    if (wp.ok && Array.isArray(wp.json)) {
      report.reachable = true; report.adapter = 'wordpress';
      report.notes.push('صفحهٔ اصلی در دسترس نبود اما REST API وردپرس پاسخ داد.');
    }
    return report;
  }

  report.reachable = true;
  report.status = home.status;
  report.finalUrl = home.url;
  const html = home.body;
  report.title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  report.generator = (html.match(/name=["']generator["'][^>]*content=["']([^"']+)/i) || [, ''])[1] || '';

  // ۱) وردپرس؟
  const wp = await fetchJson(`${base}/wp-json/wp/v2/posts?per_page=1`, { timeout: Math.min(timeout, 15000), retries: 0 });
  const isWp = wp.ok && Array.isArray(wp.json);
  if (isWp) {
    report.adapter = 'wordpress';
    report.notes.push('REST API وردپرس فعال است — استخراج دقیق با جستجوی سرور.');
  }

  // ۲) فیدها
  const feedRe = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/gi;
  for (const m of html.matchAll(feedRe)) report.feeds.push(absolutize(m[1], report.finalUrl || base));
  for (const m of html.matchAll(/href=["']([^"']*(?:\/feed\/?|\/rss\/?|feed\.xml|rss\.xml)[^"']*)["']/gi)) {
    const u = absolutize(m[1], report.finalUrl || base);
    if (!report.feeds.includes(u)) report.feeds.push(u);
  }
  report.feeds = report.feeds.slice(0, 6);
  if (report.adapter === 'html' && report.feeds.length) {
    report.notes.push(`${report.feeds.length} فید RSS پیدا شد.`);
  }

  // ۳) مسیرهای آگهی از لینک‌های صفحهٔ اصلی
  const pageSet = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const text = (m[4] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!href || /^(javascript:|#|mailto:|tel:)/i.test(href)) continue;
    const probe = foldForSearch(decodeURIComponent(href)) + '|' + foldForSearch(text);
    if (!TENDER_PATH_HINTS.some(k => probe.includes(foldForSearch(k)))) continue;
    pageSet.add(absolutize(href, report.finalUrl || base));
  }
  report.pages = [...pageSet].slice(0, 8);
  if (!report.pages.length && report.adapter === 'html') {
    report.pages = [base + '/'];
    report.notes.push('مسیر اختصاصی آگهی پیدا نشد — صفحهٔ اصلی پیمایش می‌شود.');
  }

  // ۴) sitemap
  try {
    const sm = await discoverFromSitemap(base, { timeout: Math.min(timeout, 20000) });
    if (sm.ok) {
      report.sitemap = { indexUrl: sm.indexUrl, allCount: sm.allCount, tenderCount: sm.tenderCount };
      if (sm.tenderCount > 0 && !report.pages.length) {
        report.notes.push(`sitemap شامل ${sm.tenderCount} نشانی مرتبط با مناقصه است.`);
        report.pages = sm.urls.slice(0, 5);
      }
    }
  } catch { /* بی‌اهمیت */ }

  // ۵) نمونهٔ آیتم‌ها از صفحهٔ اصلی
  if (report.adapter !== 'wordpress') {
    const sample = extractItemsFromHtml(html, report.finalUrl || base, {});
    report.sampleItems = sample.slice(0, 5);
    report.sampleCount = sample.length;
  }

  return report;
}

export function normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const p = new URL(s);
    return `${p.protocol}//${p.host}${p.pathname.replace(/\/+$/, '')}${p.search || ''}`;
  } catch { return s; }
}
