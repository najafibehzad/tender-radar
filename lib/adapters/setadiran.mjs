// lib/adapters/setadiran.mjs — سامانه تدارکات الکترونیکی دولت (ستاد ایران)
//
// پیاده‌سازی بر پایهٔ کد **آزموده و کارآمد** وب‌اپ دیده‌بان
// (`~/.zcode/workspace/default/tender-watch/tender_watch.mjs`) — نه حدس.
//
// درس‌های کلیدی آن کد:
//   ۱) **هیچ کوکی/سشنی لازم نیست.** فقط هدر `User-Agent` کافی است.
//      فرستادن Cookie/Referer/Origin اشتباه بود و پاسخ ۴۲۸ می‌داد.
//   ۲) **keep-alive**: یک اتصال TLS برای همهٔ درخواست‌ها (نسخهٔ قبلی برای هر صفحه TLS نو می‌زد).
//   ۳) **نرخ‌گیر سراسری ۲۰۰ms**: گارد ستاد بعد از ~۴۰ درخواست پشت‌سرهم `{"flag":true}` می‌دهد.
//   ۴) **fail-fast روی خطای شبکه** — تلاش مجدد در همان راند بی‌فایده است؛ راند بعدی می‌زند.
//   ۵) **`selectedCities` کدِ شهر می‌خواهد، نه کد استان** (کد استان = HTTP 400).
//   ۶) کاما در `sort=insertDate,desc` باید کدگذاری شود → همیشه `URLSearchParams`.
//   ۷) **شب‌ها (۲۳:۰۰–۰۷:۰۰) ستاد قطع است** → با یک درخواست سریع تشخیص بده و پیام شفاف بده.
//   ۸) شهر هدف را از `orgName + title` تشخیص بده، نه `cityName`
//      (زیرشهرهایی مثل ماهدشت/گلستان در cityName نمی‌آیند).
//
// ⚠️ دسترسی از IP غیرایرانی قطع است؛ برنامه باید داخل ایران اجرا شود.
import https from 'node:https';
import http from 'node:http';
import { normalizeFa, toAsciiDigits, parseAnyDate } from '../text.mjs';
import { extractItemsFromHtml } from './html.mjs';
import { fetchText } from '../fetcher.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const API_ORIGIN = process.env.SETAD_GW || 'https://gw.setadiran.ir';
const CARDS_PATH = '/api/centralboard/cards/';
const ETEND = 'https://etend.setadiran.ir/etend/centralBoardTenderDetails-execute.action';
const EPROC = 'https://eproc.setadiran.ir/eproc/purchaseNeedViewBoardIntegration.do';
const PAGE_SIZE = 10;      // سقف سرویس — بزرگ‌تر نگذارید
const MIN_GAP_MS = 200;    // نرخ‌گیر سراسری (گارد ستاد ~۴۰ درخواست پشت‌سرهم)
const MAX_PAGES = 40;      // سقف صفحه برای هر شهر (مثل دیده‌بان)

const norm = s => normalizeFa(String(s || '')).replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// یک اتصال keep-alive برای همهٔ درخواست‌ها (انتخاب ماژول بر پایهٔ پروتکل — برای آزمون محلی)
const AGENT_HTTPS = new https.Agent({ keepAlive: true, maxSockets: 4 });
const AGENT_HTTP = new http.Agent({ keepAlive: true, maxSockets: 4 });

function isNetErr(msg) {
  return /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ECONNRESET|socket hang up|timeout|اتمام زمان|خطای شبکه/i.test(String(msg || ''));
}

/**
 * GET یک نشانی و خواندن JSON.
 * نکتهٔ مهم (از دیده‌بان): `setTimeout` روی درخواستِ در حال اتصال در ویندوز کار نمی‌کند،
 * پس تایمر روی رویداد `close` پاک می‌شود.
 */
function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    let parsed;
    try { parsed = new URL(url); } catch (e) { return done({ ok: false, status: 0, error: 'نشانی نامعتبر' }); }
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const agent = isHttps ? AGENT_HTTPS : AGENT_HTTP;

    let r;
    try {
      r = mod.get(parsed, { agent, headers: { 'User-Agent': UA } }, x => {
        let d = '';
        x.setEncoding('utf8');
        x.on('data', c => d += c);
        x.on('end', () => {
          try { done({ ok: true, status: x.statusCode, json: JSON.parse(d), body: d }); }
          catch { done({ ok: false, status: x.statusCode, error: 'پاسخ JSON نامعتبر', body: d.slice(0, 300) }); }
        });
      });
    } catch (e) { return done({ ok: false, status: 0, error: String(e.message || e) }); }

    const timer = setTimeout(() => { try { r.destroy(new Error('timeout')); } catch { /* */ } done({ ok: false, status: 0, error: 'اتمام زمان انتظار' }); }, timeoutMs);
    r.on('close', () => clearTimeout(timer));
    r.on('error', e => { clearTimeout(timer); done({ ok: false, status: 0, error: String(e.message || e) }); });
  });
}

// نرخ‌گیر سراسری
let nextSlotAt = 0;
async function throttle() {
  const wait = nextSlotAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextSlotAt = Date.now() + MIN_GAP_MS;
}

/** نشانی برد آگهی‌ها — کاما در sort باید کدگذاری شود */
function cardsUrl(cityId, page) {
  const u = new URL(API_ORIGIN + CARDS_PATH);
  u.searchParams.set('searchTypeCode', '0');
  u.searchParams.set('selectedCities', String(cityId));
  u.searchParams.set('queryText', '');
  u.searchParams.set('pageNumber', String(page));
  u.searchParams.set('pageSize', String(PAGE_SIZE));
  u.searchParams.set('sort', 'insertDate,desc');
  return u.toString();
}

/**
 * یک صفحه از برد.
 * پاسخ گارد ستاد (`{"flag":true}` بدون totalElements/content) = محدودیت نرخ → صبر و تلاش مجدد.
 * خطای شبکه = بی‌فایده؛ بلافاصله بیرون بیا (راند بعدی اسکن دوباره می‌زند).
 *
 * مطابق دیده‌بان: بعد از ۳ تلاش مجدد، اگر همچنان گارد بود، صفر آگهی برمی‌گردانیم
 * (نه خطا). خطا فقط برای خطاهای واقعی شبکه/HTTP ثبت می‌شود.
 */
async function boardPage(cityId, page, { timeout, guardRetries = 4 } = {}) {
  for (let t = 0; t < guardRetries; t++) {
    await throttle();
    const r = await fetchJson(cardsUrl(cityId, page), timeout);
    if (!r.ok) {
      if (isNetErr(r.error)) return { ok: false, netError: true, error: r.error, status: r.status };
      if (r.status >= 500) { await sleep(1200); continue; }
      // خطاهای ۴۰۰ و غیرشبکه‌ای = بازنمی‌گردد، بلافاصله برمی‌گردد
      return r;
    }
    const j = r.json;
    const guarded = j && j.flag === true && j.totalElements === undefined && !(Array.isArray(j.content) && j.content.length);
    if (!guarded) return { ok: true, json: j };
    await sleep(1000 * (t + 1));
  }
  // همهٔ تلاش‌ها تمام شد و همچنان گارد — مطابق دیده‌بان: صفر آگهی، نه خطا
  return { ok: true, json: { flag: true, content: [] } };
}

/** تشخیص قطعی شبانهٔ ستاد (۲۳:۰۰–۰۷:۰۰) با یک درخواست سریع */
async function nightOutageCheck({ timeout }) {
  const h = new Date().getHours();
  if (h < 23 && h >= 7) return null;   // پنجرهٔ شبانه نیست
  await throttle();
  const r = await fetchJson(cardsUrl('19', 0), Math.min(timeout, 8000));
  if (!r.ok && isNetErr(r.error)) return 'سامانهٔ ستاد شب‌ها (۲۳:۰۰ تا ۰۷:۰۰) در دسترس نیست — صبح دوباره اسکن کنید';
  return null;
}

// ---------- نگاشت کارت به آیتم ----------
const PAGE_TYPE_KIND = { Tender: 'مناقصه', Auction: 'مزایده', Inquiry: 'استعلام', Bid: 'مناقصه' };
function kindOf(boardName) {
  const f = norm(boardName);
  if (f.includes('مزایده')) return 'مزایده';
  if (f.includes('استعلام')) return 'استعلام';
  if (f.includes('خرید')) return 'خرید';       // خرید کالا — دستهٔ جدا تا قابل فیلتر باشد
  if (f.includes('مناقصه')) return 'مناقصه';
  const k = PAGE_TYPE_KIND[f];
  return k || f || 'سایر';
}

/** نشانی جزئیات: مناقصه/مزایده → etend، خرید/استعلام → eproc */
function detailUrl(card) {
  const reqId = card.reqId;
  const tableId = card.tableId;
  const board = norm(card.boardName);
  const isPurchase = reqId && (board.includes('خرید') || board.includes('استعلام') || !tableId);
  if (isPurchase) return `${EPROC}?method=showNeedDetailInfo&requestId=${encodeURIComponent(reqId)}`;
  if (tableId) return `${ETEND}?tenderId=${encodeURIComponent(tableId)}`;
  if (reqId) return `${EPROC}?method=showNeedDetailInfo&requestId=${encodeURIComponent(reqId)}`;
  return 'https://etend.setadiran.ir/etend/centralboard-execute.action';
}

function mapCard(card) {
  const title = normalizeFa(card.title || '').trim();
  if (!title) return null;
  // قاعده: مهلت دریافت اسناد ملاک است، نه مهلت ارسال
  const docD = parseAnyDate(card.jalaliDocumentDeadlineDate);
  const sendD = parseAnyDate(card.jalaliSendDeadlineDate);
  const pub = parseAnyDate(card.jalaliLastEditDate || card.insertDate);
  const price = Number(card.basePrice) || 0;
  const org = normalizeFa(card.orgName || '').trim();

  return {
    title,
    description: [
      org ? `دستگاه: ${org}` : '',
      card.number ? `شمارهٔ فراخوان: ${toAsciiDigits(String(card.number))}` : '',
      price ? `برآورد: ${toAsciiDigits(String(Math.round(price / 10000000)))} میلیون ریال` : '',
    ].filter(Boolean).join(' | '),
    url: detailUrl(card),
    org: org || 'ستاد ایران',
    city: normalizeFa(card.cityName || ''),
    province: normalizeFa(card.provinceName || ''),
    publishedISO: pub.iso, publishedJalali: pub.jalali,
    deadlineISO: docD.iso || sendD.iso,
    deadlineJalali: docD.jalali || sendD.jalali,
    sendDeadlineISO: sendD.iso, sendDeadlineJalali: sendD.jalali,
    kind: kindOf(card.boardName),
    number: card.number ? String(card.number) : '',
    price,
    locationRaw: norm(`${card.orgName || ''} ${card.cityName || ''} ${card.provinceName || ''}`),
    extra: { board: card.boardName, needType: card.needType, tableId: card.tableId, reqId: card.reqId },
  };
}

/** مسیر پشتیبان HTML: تابلوی عمومی etend (میزبان جدا، بدون نیاز به سشن) */
async function htmlFallback(urls, { timeout = 30000 } = {}) {
  const items = [];
  const errors = [];
  const seen = new Set();
  const t = Math.min(timeout, 15000);
  for (const u of urls) {
    const r = await fetchText(u, { timeout: t, retries: 1 });
    if (!r.ok) { errors.push(`${u}: ${r.error || 'HTTP ' + r.status}`); continue; }
    for (const it of extractItemsFromHtml(r.body, r.url || u, {})) {
      const key = norm(it.title).replace(/\s+/g, '').slice(0, 90);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push({
        title: it.title,
        description: (it.context || '').slice(0, 400),
        url: it.url && it.url !== u ? it.url : u,
        org: 'ستاد ایران',
        publishedISO: it.publishedISO || null, publishedJalali: it.publishedJalali || '',
        deadlineISO: it.deadlineISO || null, deadlineJalali: it.deadlineJalali || '',
        kind: it.kind,
      });
    }
  }
  return { items, errors };
}

/**
 * آداپتر ستاد.
 * src.setadCities:    [{province, city, id}] — کدهای تأییدشدهٔ شهر (روش توصیه‌شده)
 * src.setadProvinces: نام استان‌ها — فقط اگر کد شهر نداشتیم (پشتیبان)
 * src.setadMaxPages:  سقف صفحه برای هر شهر (پیش‌فرض ۴۰)
 * src.setadHtmlFallback: نشانی‌های مسیر پشتیبان HTML
 */
/**
 * اسکن یک بار همهٔ شهرها. مانند `scanAllOnce` در دیده‌بان:
 * - گارد/صفر آگهی = موفق (نه خطا)
 * - خطای شبکه = ثبت در failed
 * - setadKinds: فقط انواع خاصی از آگهی (مثلاً فقط 'مناقصه')
 */
async function scanAllOnce(targets, { timeout, maxPages, lookbackDays, kindFilter = null }) {
  const cutoffISO = lookbackDays > 0
    ? new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10)
    : null;
  const isOld = (card) => {
    if (!cutoffISO) return false;
    const d = parseAnyDate(card.jalaliLastEditDate || card.insertDate);
    return !!(d.iso && d.iso < cutoffISO);
  };

  const items = [];
  const seen = new Set();
  const pagesInfo = [];
  const failed = [];
  let netFailStreak = 0;
  let stoppedEarly = false;

  for (const t of targets) {
    let got = 0;
    let fetched = 0;
    let total = null;
    let lastErr = null;

    for (let p = 0; p < maxPages; p++) {
      const r = await boardPage(t.sel, p, { timeout });
      if (!r.ok) {
        lastErr = r.error;
        if (r.netError) netFailStreak++;
        else failed.push(`${t.label}: ${r.error}`);
        break;
      }
      const content = (r.json && Array.isArray(r.json.content)) ? r.json.content : [];
      if (!content.length) break; // گارد یا واقعاً صفر — هر دو = پایان شهر
      fetched += content.length;
      if (total == null) {
        const n = Number(r.json && r.json.totalElements);
        if (Number.isFinite(n)) total = n;
      }
      for (const card of content) {
        const key = String(card.number || card.tableId || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const it = mapCard(card);
        if (!it) continue;
        // فیلتر نوع آگهی (مثلاً فقط مناقصه)
        if (kindFilter && kindFilter.length && !kindFilter.includes(it.kind)) continue;
        if (!it.province && t.province) it.province = t.province;
        if (!it.city && t.city) it.city = t.city;
        items.push(it);
        got++;
      }
      if (cutoffISO && content.every(isOld)) { stoppedEarly = true; break; }
      if (total != null && fetched >= total) break;
    }

    pagesInfo.push({ target: t.label, count: got, total, error: lastErr });
    if (netFailStreak >= 3 && items.length === 0) break; // ستاد قطع است
    if (!lastErr) netFailStreak = 0;
  }

  return { items, pagesInfo, failed, stoppedEarly, netDown: netFailStreak >= 3 && items.length === 0 };
}

/**
 * آداپتر ستاد.
 * src.setadCities:    [{province, city, id}] — کدهای تأییدشدهٔ شهر (روش توصیه‌شده)
 * src.setadProvinces: نام استان‌ها — فقط اگر کد شهر نداشتیم (پشتیبان)
 * src.setadMaxPages:  سقف صفحه برای هر شهر (پیش‌فرض ۴۰)
 * src.setadHtmlFallback: نشانی‌های مسیر پشتیبان HTML
 * src.setadKinds:     ['مناقصه'] — فقط این انواع آگهی را نگه دار (اختیاری)
 */
export async function fetchSetadiran(src, { timeout = 15000, lookbackDays = 0 } = {}) {
  // سقف مهلت هر صفحه — مثل دیده‌بان (۱۵s). مقدار بزرگ‌تر فقط اسکن را معطل می‌کند.
  const pageTimeout = Math.min(Math.max(Number(timeout) || 15000, 5000), 20000);
  timeout = pageTimeout;
  const maxPages = Math.min(Number(src.setadMaxPages || MAX_PAGES), 200);
  const errors = [];

  const fallbackUrls = (src.setadHtmlFallback && src.setadHtmlFallback.length)
    ? src.setadHtmlFallback
    : ['https://etend.setadiran.ir/etend/index.action'];

  // ۰) پنجرهٔ قطعی شبانه
  const night = await nightOutageCheck({ timeout });
  if (night) {
    const fb = await htmlFallback(fallbackUrls, { timeout });
    if (fb.items.length) {
      return { ok: true, items: fb.items, diagnostics: { api: 'setadiran', mode: 'html-fallback', nightOutage: true, count: fb.items.length } };
    }
    return { ok: false, items: [], error: night, diagnostics: { api: 'setadiran', nightOutage: true } };
  }

  // ۱) اهداف: کدهای صریح شهر
  const targets = [];
  const explicit = (src.setadCities || []).filter(c => c && c.id != null && String(c.id).trim() !== '');
  if (explicit.length) {
    for (const c of explicit) {
      targets.push({ sel: String(c.id), label: [c.province, c.city].filter(Boolean).join('/') || String(c.id), province: c.province || '', city: c.city || '' });
    }
  } else {
    for (const pName of ((src.setadProvinces && src.setadProvinces.length) ? src.setadProvinces : ['تهران', 'البرز'])) {
      errors.push(`استان «${pName}»: بدون کد شهر نمی‌توان پرس‌وجو کرد — setadCities را تنظیم کنید`);
    }
  }

  if (!targets.length) {
    const fb = await htmlFallback(fallbackUrls, { timeout });
    if (fb.items.length) {
      return { ok: true, items: fb.items, diagnostics: { api: 'setadiran', mode: 'html-fallback', count: fb.items.length, errors: fb.errors.slice(0, 5) } };
    }
    return { ok: false, items: [], error: errors.join(' | ') || 'کد شهری تنظیم نشده است', diagnostics: { api: 'setadiran', targets: 0 } };
  }

  // ۲) پیمایش شهرها — با راند تکرار مانند دیده‌بان
  // اگر همهٔ شهرها خطای شبکه بدهند، ۱۰ ثانیه صبر و دوباره (تا ۳ راند)
  const MAX_ROUNDS = 3;
  const RETRY_WAIT_MS = 10 * 1000;
  const SCAN_BUDGET_MS = 130 * 1000;
  const deadline = Date.now() + SCAN_BUDGET_MS;
  let lastResult = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const kindFilter = Array.isArray(src.setadKinds) && src.setadKinds.length ? src.setadKinds : null;
    const result = await scanAllOnce(targets, { timeout, maxPages, lookbackDays, kindFilter });
    lastResult = result;
    if (result.items.length > 0) break;
    if (!result.failed.length) break; // همه صفر آگهی (گارد) — نیازی به تکرار نیست
    if (result.failed.length < targets.length) break; // بعضی شهرها سالم بودند
    if (round >= MAX_ROUNDS || Date.now() > deadline - RETRY_WAIT_MS) break;
    errors.push(`قطع کامل (round ${round}/${MAX_ROUNDS}) — ${RETRY_WAIT_MS / 1000}s صبر و دوباره`);
    await sleep(RETRY_WAIT_MS);
  }

  // ۳) مسیر پشتیبان HTML اگر API چیزی نداد
  let usedFallback = false;
  let items = lastResult ? lastResult.items : [];
  if (items.length === 0) {
    const fb = await htmlFallback(fallbackUrls, { timeout });
    if (fb.items.length) { items = fb.items; usedFallback = true; }
    for (const e of fb.errors) errors.push(e);
  }

  const ok = items.length > 0;
  const pagesInfo = lastResult ? lastResult.pagesInfo : [];
  return {
    ok,
    items,
    error: ok ? null : (errors.slice(0, 3).join(' | ') || 'آگهی فعالی در شهرهای هدف ستاد نیست'),
    diagnostics: {
      api: 'setadiran',
      mode: usedFallback ? 'html-fallback' : 'explicit-city-ids',
      lookbackDays: lookbackDays || null,
      stoppedEarly: lastResult ? lastResult.stoppedEarly : false,
      netDown: lastResult ? lastResult.netDown : false,
      targets: targets.length,
      pages: pagesInfo,
      errors: errors.slice(0, 10),
    },
  };
}

/** تشخیص گام‌به‌گام — برای اشکال‌زدایی روی ماشین کاربر */
export async function diagnoseSetadiran({ timeout = 15000, src = null } = {}) {
  const steps = [];
  const cities = (src && src.setadCities) || [];
  const test = cities.find(c => c && c.id != null) || { id: '19', city: 'تهران', province: 'تهران' };

  steps.push({ step: 'شهر آزمایشی', ok: true, id: String(test.id), label: [test.province, test.city].filter(Boolean).join('/') });
  steps.push({ step: 'حالت درخواست', ok: true, cookie: 'بدون کوکی (مطابق دیده‌بان)', header: 'User-Agent فقط', keepAlive: true });

  const r = await boardPage(String(test.id), 0, { timeout });
  steps.push({
    step: 'دریافت صفحهٔ اول آگهی‌ها',
    ok: !!r.ok,
    error: r.error,
    status: r.status,
    netError: r.netError === true ? 'بله — شبکه/جغرافیا' : undefined,
    total: r.ok ? r.json.totalElements : null,
    got: r.ok && Array.isArray(r.json.content) ? r.json.content.length : 0,
  });
  if (r.ok && Array.isArray(r.json.content) && r.json.content.length) {
    steps.push({ step: 'نمونهٔ آگهی‌ها', ok: true, items: r.json.content.slice(0, 3).map(x => normalizeFa(x.title || '').slice(0, 60)) });
  }

  const ok = steps.some(s => s.step === 'دریافت صفحهٔ اول آگهی‌ها' && s.ok === true);
  const out = { ok, steps };
  if (!ok) {
    const h = new Date().getHours();
    if (h >= 23 || h < 7) out.hint = 'الان در پنجرهٔ قطعی شبانهٔ ستاد (۲۳:۰۰–۰۷:۰۰) هستید — صبح دوباره امتحان کنید.';
    else out.hint = 'اگر «خطای شبکه» است: دسترسی از IP غیرایرانی بسته است یا شبکه/VPN مسیر ستاد را می‌بندد.';
  }
  return out;
}
