// lib/adapters/odata.mjs — استخراج از سامانه‌های OData (سامانه امور قراردادهای سازمان‌ها / دهیاری‌ها)
import { fetchJson } from '../fetcher.mjs';
import { parseAnyDate, detectKind, normalizeFa, toAsciiDigits } from '../text.mjs';
import { inferLocation } from '../cities.mjs';

/**
 * نوع آگهی از PageType سامانه تعیین می‌شود؛ اگر نبود از متن.
 * نکته: detectKind در نبود تطبیق «سایر» برمی‌گرداند (نه مقدار خالی)،
 * پس نمی‌توان از `|| 'مناقصه'` استفاده کرد.
 */
const PAGE_TYPE_KIND = { Tender: 'مناقصه', Auction: 'مزایده', Inquiry: 'استعلام', Enquiry: 'استعلام', Bid: 'مناقصه' };
function kindFromPageType(pageType, text) {
  const k = PAGE_TYPE_KIND[String(pageType || '').trim()];
  if (k) return k;
  const d = detectKind(text);
  return d === 'سایر' ? 'مناقصه' : d;
}

/**
 * سامانه‌های مبتنی بر OData (مثل «سامانه امور قراردادهای سازمان» در 93.114.107.36:81)
 * نقطهٔ پایانی: {url}/OData/deals?status=0&history=0&$top=N&$orderby=StartDate desc
 * فیلدها: ID, Name, Brief, StartDate, EndDate, Price, Category, Type, Number, PageType, Company
 */
export async function fetchOData(src, { timeout = 30000 } = {}) {
  const base = src.url.replace(/\/+$/, '');
  const odataPath = src.odataPath || '/OData/deals';
  const limit = Math.min(Number(src.odataTop || 300), 1000);
  const detailPattern = src.detailPattern || '#/deals/details/{id}';

  // تلاش برای دریافت سابقهٔ کامل (history=1) و فعال (history=0)
  const queries = [
    `${odataPath}?status=0&history=0&$top=${limit}&$orderby=StartDate desc`,
    `${odataPath}?status=0&history=1&$top=${limit}&$orderby=StartDate desc`,
  ];

  const items = [];
  const errors = [];
  const seen = new Set();
  let ok = false;

  for (const q of queries) {
    const r = await fetchJson(base + encodeURI(q).replace(/%24/g, '$').replace(/%20/g, '%20'), { timeout });
    if (!r.ok || !r.json || !Array.isArray(r.json.value)) {
      errors.push(`${q.split('?')[1]}: ${r.error || 'پاسخ نامعتبر'}`);
      continue;
    }
    ok = true;
    for (const v of r.json.value) {
      const id = String(v.ID || v.Number || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const title = normalizeFa(v.Name || '').trim();
      if (!title) continue;

      const start = parseAnyDate(v.StartDate);
      const end = parseAnyDate(v.EndDate);
      const org = normalizeFa(v.Company || '').trim();
      const loc = inferLocation(`${title} ${v.Brief || ''} ${org}`);

      const price = Number(v.Price) || 0;
      const brief = normalizeFa(v.Brief || '').trim();
      const detailUrl = detailPattern.includes('{id}')
        ? base + '/' + detailPattern.replace('{id}', encodeURIComponent(id)).replace(/^\//, '')
        : base;

      items.push({
        title,
        description: brief || (price ? `برآورد: ${toAsciiDigits(String(Math.round(price / 10000000)))} میلیون ریال` : ''),
        url: detailUrl,
        org: org || (loc ? loc.city : src.name),
        city: loc ? loc.city : '',
        province: loc ? loc.province : (src.province || ''),
        publishedISO: start.iso, publishedJalali: start.jalali,
        deadlineISO: end.iso, deadlineJalali: end.jalali,
        kind: kindFromPageType(v.PageType, `${v.Category || ''} ${title}`),
        number: v.Number ? String(v.Number) : '',
        price,
        locationRaw: v.Company || '',
        extra: { pageType: v.PageType, category: normalizeFa(v.Category || ''), type: v.Type },
      });
    }
  }

  if (!ok) return { ok: false, items: [], error: errors.join(' | ') || 'سامانهٔ OData پاسخ نداد', diagnostics: { api: 'odata', errors } };
  return { ok: true, items, diagnostics: { api: 'odata', count: items.length, errors } };
}
