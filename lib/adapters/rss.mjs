// lib/adapters/rss.mjs — استخراج از فیدهای RSS/Atom
import { fetchText } from '../fetcher.mjs';
import { stripHtml, parseAnyDate, detectKind, normalizeFa } from '../text.mjs';
import { extractDeadline } from './wordpress.mjs';

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

/** خواندن یک فید RSS/Atom */
export async function fetchFeed(url, { timeout = 25000, limit = 200 } = {}) {
  const r = await fetchText(url, { timeout, retries: 1 });
  if (!r.ok) return { ok: false, items: [], error: r.error || `HTTP ${r.status}` };

  const body = r.body.replace(/^\uFEFF/, '');
  const blocks = [...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
  const entries = blocks.length ? blocks : [...body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(m => m[1]);

  const items = [];
  for (const b of entries.slice(0, limit)) {
    const rawTitle = tag(b, 'title');
    const title = stripHtml(rawTitle);
    if (!title) continue;

    let link = tag(b, 'link');
    if (!link) {
      const alt = b.match(/<link[^>]*href\s*=\s*["']([^"']+)["']/i);
      if (alt) link = alt[1];
    }
    if (!link) link = tag(b, 'guid');

    const descRaw = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    const description = stripHtml(descRaw);
    const dateStr = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const d = parseAnyDate(dateStr);

    // «سازمان: X | موقعیت: استان، شهر»
    const org = (description.match(/سازمان\s*:\s*([^|]+)/) || [, ''])[1].trim();
    const loc = (description.match(/موقعیت\s*:\s*([^|]+)/) || [, ''])[1].trim();
    let province = '', city = '';
    if (loc) {
      const parts = loc.split(/[،,]/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) { city = parts[0]; province = parts[1]; }
      else { city = loc; }
    }
    const deadline = extractDeadline(description);

    items.push({
      title,
      description: description.slice(0, 600),
      url: link,
      org,
      city, province, locationRaw: loc,
      publishedISO: d.iso, publishedJalali: d.jalali, publishedTime: d.time || '',
      deadlineISO: deadline.iso, deadlineJalali: deadline.jalali,
      kind: detectKind(`${title} ${description.slice(0, 120)}`),
    });
  }

  return { ok: true, items, diagnostics: { api: 'rss', total: entries.length, parsed: items.length } };
}

/** آداپتر فید: src.feeds = فهرست نشانی فیدها */
export async function fetchRss(src, { timeout = 25000 } = {}) {
  const feeds = src.feeds && src.feeds.length ? src.feeds : [src.url];
  const all = [];
  const errors = [];
  const pages = [];
  for (const f of feeds) {
    const r = await fetchFeed(f, { timeout });
    if (!r.ok) { errors.push(`${f}: ${r.error}`); pages.push({ url: f, status: 0, count: 0, error: r.error }); continue; }
    pages.push({ url: f, status: 200, count: r.items.length });
    all.push(...r.items);
  }
  return { ok: all.length > 0, items: all, diagnostics: { api: 'rss', pages, errors } };
}
