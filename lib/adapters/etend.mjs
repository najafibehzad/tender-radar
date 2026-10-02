// lib/adapters/etend.mjs — سامانه مناقصه الکترونیکی دولت (etend.setadiran.ir)
// منبع بدون گارد gw و بدون کپچا (کشف ۲۰۲۶-۱۰-۰۲):
//   ۱) فهرست همهٔ مناقصه‌های فعال از درایپ‌داون «شماره مناقصه» فرم جستجوی پیشرفته —
//      یک درخواست، جفت‌های tenderId ← شمارهٔ رسمی ۱۵رقمی.
//   ۲) جزئیات کامل رسمی هر مناقصه از centralBoardTenderDetails (کارفرما، تضمین،
//      مهلت‌ها، رتبه، حوزهٔ فعالیت، استان/شهر) — عمومی.
// هرگز کوکی/سشن نفرست — مثل gw، بدون سشن کار می‌کند.
import https from 'node:https';
import { normalizeFa, parseAnyDate } from '../text.mjs';

const BASE = 'https://etend.setadiran.ir';
const SEARCH_URL = BASE + '/etend/advanceSearch-execute.action';
const DETAIL_URL = BASE + '/etend/centralBoardTenderDetails-execute.action?tenderId=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fetchText(url, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, { agent, headers: { 'User-Agent': UA, 'Accept-Language': 'fa,en;q=0.8' }, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        if (next !== url) return resolve(fetchText(next, { timeout }));
        return resolve({ ok: false, status: res.statusCode, error: 'حلقهٔ ریدایرکت' });
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
  });
}

/** جفت‌های tenderId ← شمارهٔ رسمی از درایپ‌داون فرم جستجو */
export function parseActiveList(html) {
  const seen = new Set();
  const items = [];
  for (const m of html.matchAll(/value="(\d{5,9})"[^>]*>(\d{15,17})</g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    items.push({ tenderId: m[1], number: m[2] });
  }
  return items;
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#x?[0-9a-f]+;/gi, ' ').trim();

/**
 * پارس صفحهٔ جزئیات رسمی.
 * سلکت‌ها: گزینهٔ selected با متنش درمی‌آید (نوع برگزاری، استان، شهر) —
 * پنجرهٔ ۴۰هزار کاراکتری چون سلکت شهر لیست طولانی دارد.
 */
export function parseDetail(html, tenderId) {
  const v = {};
  for (const m of html.matchAll(/<input[^>]*name="(tenderDto[^"]+)"[^>]*value="([^"]*)"/g)) v[m[1]] = m[2];
  for (const m of html.matchAll(/<input[^>]*value="([^"]*)"[^>]*name="(tenderDto[^"]+)"/g)) if (!(m[2] in v)) v[m[2]] = m[1];
  for (const m of html.matchAll(/<textarea[^>]*name="(tenderDto[^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) v[m[1]] = decode(m[2].replace(/<[^>]+>/g, ''));

  const sel = {};
  for (const m of html.matchAll(/<select[^>]*name="([^"]+)"([\s\S]{0,40000}?)<\/select>/g)) {
    const sm = m[2].match(/<option value="([^"]*)"[^>]*selected[^>]*>([^<]*)</i);
    if (sm) sel[m[1]] = { value: sm[1], text: decode(sm[2]) };
  }
  const g = (k) => (v[k] !== undefined ? decode(v[k]) : '');
  return {
    tenderId: String(tenderId),
    title: g('tenderDto.tender.title'),
    number: g('tenderDto.tender.number'),
    setupType: sel['tenderDto.tender.setupType']?.text || '',
    organization: g('tenderDto.tender.organization.name'),
    province: sel['tenderDto.tender.tenderAdditionalInfo.operationProvinceId']?.text || '',
    city: sel['tenderDto.tender.tenderAdditionalInfo.operationCityId']?.text || '',
    address: g('tenderDto.tender.address'),
    description: g('tenderDto.tender.description'),
    domains: g('tenderDto.tender.domainsDescription'),
    subject: g('tenderDto.tender.subjectAllowedName'),
    minRating: g('tenderDto.tender.minAcceptableRating'),
    guarantyPrice: g('tenderDto.tender.guarantyPrice'),
    docsDeadline: g('tenderDto.documentsDeadlineDateEx') + ' ' + g('tenderDto.documentsDeadlineTimeEx'),
    proposalDeadline: g('tenderDto.proposalDeadlineDateEx') + ' ' + g('tenderDto.proposalDeadlineTimeEx'),
    opening: g('tenderDto.openingDateEx') + ' ' + g('tenderDto.openingTimeEx'),
    renewed: v['tenderDto.tender.renewed'] === 'true',
  };
}

/**
 * اسکن منبع etend.
 * src.maxItems   — جزئیات چند مناقصهٔ آخر (جدیدترین شناسه‌ها) گرفته شود (پیش‌فرض ۲۵۰)
 * src.throttleMs — فاصلهٔ درخواست‌های جزئیات (پیش‌فرض ۳۰۰)
 * فهرست فعال یک درخواست است؛ جزئیات فقط N آگهی آخر گرفته می‌شود تا اسکن سبک بماند.
 */
export async function fetchEtend(src, { timeout = 30000, lookbackDays = 0 } = {}) {
  void lookbackDays; // جدیدترین‌ها با شناسهٔ بالاتر شناسایی می‌شوند، نه تاریخ
  const t0 = Date.now();
  const diagnostics = { errors: [] };

  const lr = await fetchText(SEARCH_URL, { timeout });
  if (!lr.ok) {
    diagnostics.errors.push(`فهرست: HTTP ${lr.status} ${lr.error || ''}`);
    return { ok: false, items: [], error: `فهرست فعال‌ها نیامد (${lr.status || lr.error})`, diagnostics };
  }
  const active = parseActiveList(lr.body);
  if (!active.length) {
    return { ok: false, items: [], error: 'لیست شناسه‌ها در فرم خالی بود (احتمالاً مسیر عوض شده)', diagnostics };
  }
  diagnostics.totalActive = active.length;

  const maxItems = Math.min(Number(src.maxItems) || 250, active.length);
  const throttle = Math.max(Number(src.throttleMs) || 300, 100);
  const targets = [...active].sort((a, b) => (+b.tenderId) - (+a.tenderId)).slice(0, maxItems);

  const items = [];
  let failed = 0;
  for (const t of targets) {
    let d = null;
    for (let attempt = 0; attempt < 2 && !d; attempt++) {
      if (attempt) await sleep(1200);
      const r = await fetchText(DETAIL_URL + t.tenderId, { timeout });
      if (r.ok && r.body.includes('tenderDto')) d = parseDetail(r.body, t.tenderId);
    }
    if (!d || !d.title) { failed++; continue; }

    // ملاک مهلت: مهلت دریافت اسناد (هماهنگ با دیده‌بان)؛ اگر خالی بود مهلت ارسال
    const docD = parseAnyDate(d.docsDeadline);
    const sendD = parseAnyDate(d.proposalDeadline);
    const deadline = docD.iso ? docD : sendD;

    items.push({
      title: d.title,
      description: [
        d.description,
        d.domains && ('حوزه فعالیت: ' + d.domains),
        d.subject && ('موضوع: ' + d.subject),
        d.minRating && ('حداقل رتبه: ' + d.minRating),
      ].filter(Boolean).join(' | ').slice(0, 900),
      url: DETAIL_URL + t.tenderId,
      org: d.organization || 'ستاد ایران',
      publishedISO: null, publishedJalali: '',
      deadlineISO: deadline.iso, deadlineJalali: deadline.jalali,
      kind: 'مناقصه',
      number: d.number || t.number,
      price: d.guarantyPrice ? { guaranty: d.guarantyPrice } : null,
      locationRaw: normalizeFa([d.organization, d.address].filter(Boolean).join(' ')),
      province: normalizeFa(d.province),
      city: normalizeFa(d.city),
      extra: {
        tenderId: t.tenderId, renewed: d.renewed, setupType: d.setupType,
        docsDeadline: d.docsDeadline, proposalDeadline: d.proposalDeadline,
        opening: d.opening, guarantyPrice: d.guarantyPrice,
        subject: d.subject, minRating: d.minRating,
      },
    });
    await sleep(throttle);
  }

  diagnostics.detailFetched = items.length;
  diagnostics.detailFailed = failed;
  return {
    ok: items.length > 0,
    items,
    error: failed === targets.length ? 'هیچ جزئیاتی گرفته نشد' : null,
    diagnostics,
    ms: Date.now() - t0,
  };
}
