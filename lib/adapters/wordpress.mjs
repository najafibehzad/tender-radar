// lib/adapters/wordpress.mjs — استخراج از سایت‌های وردپرسی از طریق REST API
import { fetchJson } from '../fetcher.mjs';
import { stripHtml, parseAnyDate, looksLikeTender, detectKind, normalizeFa, toAsciiDigits } from '../text.mjs';

/**
 * وردپرس: /wp-json/wp/v2/posts?search=<q>&per_page=<n>&_embed=1
 * جستجو در سرور وردپرس انجام می‌شود، پس برای هر موضوع یک فراخوانی لازم است.
 */
export async function fetchWordPress(src, { queries, perQuery = 20, timeout = 25000 } = {}) {
  const base = src.url.replace(/\/+$/, '');
  const items = [];
  const errors = [];
  const seen = new Set();
  let apiOk = false;

  const queryList = (queries && queries.length ? queries : ['مناقصه', 'مزایده', 'استعلام']).slice(0, 8);

  for (const q of queryList) {
    const url = `${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=${perQuery}&orderby=date&order=desc`;
    // سایت‌های شهرداری زیر بار کند می‌شوند → یک تلاش مجدد
    const r = await fetchJson(url, { timeout, retries: 1 });
    if (!r.ok || !Array.isArray(r.json)) { errors.push(`${q}: ${r.error || 'HTTP ' + r.status}`); continue; }
    apiOk = true;
    for (const p of r.json) {
      const id = `wp-${p.id}`;
      if (seen.has(id)) continue;
      const title = stripHtml(p.title && (p.title.rendered || p.title));
      if (!title) continue;
      const excerpt = stripHtml((p.excerpt && (p.excerpt.rendered || p.excerpt)) || '');
      const content = stripHtml((p.content && (p.content.rendered || p.content)) || '');
      const hay = `${title} ${excerpt}`;
      const d = parseAnyDate(p.date || p.date_gmt);
      const deadline = extractDeadline(content || excerpt);
      seen.add(id);
      items.push({
        id, title,
        description: (excerpt || content).slice(0, 600),
        url: p.link || `${base}/?p=${p.id}`,
        publishedISO: d.iso, publishedJalali: d.jalali,
        deadlineISO: deadline.iso, deadlineJalali: deadline.jalali,
        kind: detectKind(title),
        matchedQuery: q,
      });
    }
  }
  if (!apiOk) return { ok: false, items: [], error: errors.join(' | ') || 'REST API وردپرس در دسترس نبود', diagnostics: { api: 'wordpress', errors } };
  return { ok: true, items, diagnostics: { api: 'wordpress', queries: queryList.length, errors } };
}

/** تلاش برای یافتن مهلت در متن آگهی */
export function extractDeadline(text) {
  if (!text) return { iso: null, jalali: '' };
  const t = toAsciiDigits(normalizeFa(text));
  const re = /(?:مهلت|اخرین|آخرین|تا تاریخ|لغایت|پایان)[^\d]{0,40}(\d{4}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2})/g;
  const found = [];
  let m;
  while ((m = re.exec(t)) !== null) found.push(m[1]);
  if (!found.length) {
    const any = t.match(/(1[34]\d{2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2})/g) || [];
    if (!any.length) return { iso: null, jalali: '' };
    found.push(any[any.length - 1]);
  }
  const d = parseAnyDate(found[found.length - 1]);
  return { iso: d.iso, jalali: d.jalali };
}
