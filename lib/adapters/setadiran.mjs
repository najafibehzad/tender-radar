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
//   ۹) **preFlight مثل دیده‌بان (۱۴۰۵-۰۷-۰۳)**: قبل از اسکن کامل یک درخواست ۸ ثانیه‌ای
//      (pageSize=1)؛ اگر گارد/قطع بود تا ۳ بار با فاصلهٔ ۲ث/۴ث — بعدش کل پیمایش شهرها
//      را رها کن، نه اینکه ۶ شهر × ۲۵ صفحه بیهوده بزنیم.
//  ۱۰) گارد وسط اسکن = شهر «گاردشده» علامت می‌خورد (نه صفرِ بی‌سروصدا)؛ راند بعد فقط
//      همان شهرها دوباره تلاش می‌کنند + هر ۳۰ درخواست یک نفس ۶ث می‌گیریم تا گارد اصلاً داغ نشود.
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
const GUARD_COOLDOWN_MS = 8000; // نفس بعد از شهری که گارد خورد

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

// نرخ‌گیر سراسری + نفس‌های دوره‌ای:
// گارد ستاد بعد از ~۴۰ درخواست پشت‌سرهم می‌بندد؛ اسکن کامل رادار (۶ شهر × تا ۲۵ صفحه)
// از آن عبور می‌کند، پس هر ۳۰ درخواست یک نفس ۶ ثانیه‌ای می‌گیریم تا گارد اصلاً داغ نشود.
let nextSlotAt = 0;
let reqCount = 0;
const BREATH_EVERY = 30;
const BREATH_MS = 6000;
async function throttle() {
  const wait = nextSlotAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextSlotAt = Date.now() + MIN_GAP_MS;
  reqCount++;
  if (reqCount % BREATH_EVERY === 0) await sleep(BREATH_MS);
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
  // همهٔ تلاش‌ها تمام شد و همچنان گارد — «گاردشده» علامت می‌خوریم تا راند بعدی فقط
  // همین شهر دوباره تلاش کند؛ صفرِ بی‌سروصدا = گزارش ناقص با ok:true (باگ قبلی)
  return { ok: true, guarded: true, json: { flag: true, content: [] } };
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

/**
 * پیش‌بررسی تک‌درخواستیِ سریع — عین `preFlight` دیده‌بان (tender_watch.mjs):
 * یک درخواست ۸ ثانیه‌ای (pageSize=1). گارد ستاد گاهی موقتی است — تا ۳ بار با فاصلهٔ
 * ۲ث/۴ث دوباره می‌زنیم تا پنجرهٔ باز شدن را بگیریم؛ اگر نشد، کل پیمایش شهرها را رها می‌کنیم
 * (نه اینکه ۶ شهر × ۲۵ صفحه در گاردِ داغ بیهوده بزنیم و گارد را داغ‌تر کنیم).
 */
async function preFlight(src, { timeout }) {
  const cities = (src && src.setadCities) || [];
  const first = cities.find(c => c && c.id != null && String(c.id).trim() !== '');
  if (!first) return { alive: true, err: null }; // بدون کد شهر — جریان عادی خودش پیام می‌دهد
  const u = new URL(API_ORIGIN + CARDS_PATH);
  u.searchParams.set('searchTypeCode', '0');
  u.searchParams.set('selectedCities', String(first.id));
  u.searchParams.set('queryText', '');
  u.searchParams.set('pageNumber', '0');
  u.searchParams.set('pageSize', '1');
  u.searchParams.set('sort', 'insertDate,desc');
  const probeTimeout = Math.min(Math.max(timeout, 5000), 8000);
  for (let t = 0; t < 3; t++) {
    await throttle();
    const r = await fetchJson(u.toString(), probeTimeout);
    if (r.ok && r.json && (r.json.totalElements !== undefined || (Array.isArray(r.json.content) && r.json.content.length))) {
      return { alive: true, err: null };
    }
    const guarded = r.ok && r.json && r.json.flag === true;
    // خطای HTTP غیرگارد (۴۰۰ و… ) = مشکل پرس‌وجوست نه گارد — بگذار جریان عادی تصمیم بگیرد
    if (r.ok && !guarded) return { alive: true, err: null };
    if (t < 2) await sleep(2000 * (t + 1));
  }
  return { alive: false, err: 'گارد ستاد یا قطعی موقت' };
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
async function scanAllOnce(targets, { timeout, maxPages, lookbackDays, kindFilter = null, deadline = 0 }) {
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
  const guardedTargets = [];
  let netFailStreak = 0;
  let stoppedEarly = false;

  for (const t of targets) {
    let got = 0;
    let fetched = 0;
    let total = null;
    let lastErr = null;
    let cityGuarded = false;

    for (let p = 0; p < maxPages; p++) {
      if (deadline && Date.now() > deadline) { lastErr = 'اتمام بودجهٔ زمان اسکن'; break; }
      const r = await boardPage(t.sel, p, { timeout });
      if (!r.ok) {
        lastErr = r.error;
        if (r.netError) netFailStreak++;
        else failed.push(`${t.label}: ${r.error}`);
        break;
      }
      if (r.guarded) { cityGuarded = true; break; } // نیمه‌کاره‌ها می‌ماند؛ راند بعد فقط همین شهر
      const content = (r.json && Array.isArray(r.json.content)) ? r.json.content : [];
      if (!content.length) break; // واقعاً صفر — پایان شهر
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

    pagesInfo.push({ target: t.label, count: got, total, guarded: cityGuarded || undefined, error: lastErr });
    if (cityGuarded) {
      guardedTargets.push(t);
      // نفس بعد از گارد — پنجرهٔ گارد معمولاً چند ثانیه‌ای است؛ اگر بودجه اجازه ندهد فوراً ادامه
      if (deadline && Date.now() + GUARD_COOLDOWN_MS > deadline) continue;
      await sleep(GUARD_COOLDOWN_MS);
    }
    if (netFailStreak >= 3 && items.length === 0) break; // ستاد قطع است
    if (!lastErr) netFailStreak = 0;
  }

  return {
    items, pagesInfo, failed, guarded: guardedTargets, stoppedEarly,
    netDown: netFailStreak >= 3 && items.length === 0,
  };
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

  // ۲) پیش‌بررسی تک‌درخواستی مثل دیده‌بان — اگر گارد داغ بود، همان‌جا تمام؛ نه ۱۵۰ درخواست بیهوده
  const pre = await preFlight(src, { timeout });
  if (!pre.alive) {
    const fb = await htmlFallback(fallbackUrls, { timeout });
    if (fb.items.length) {
      return { ok: true, items: fb.items, diagnostics: { api: 'setadiran', mode: 'html-fallback', preFlight: pre.err, count: fb.items.length } };
    }
    return {
      ok: false,
      items: [],
      error: 'ستاد فعلاً پاسخ نمی‌دهد (' + pre.err + ') — چند دقیقه بعد دوباره «اسکن» بزنید؛ گارد ستاد موقتی است',
      diagnostics: { api: 'setadiran', mode: 'preFlight-fail', preFlight: pre.err },
    };
  }

  // ۳) پیمایش شهرها — راند تکرار فقط روی شهرهای گاردشده (و قطعِ کامل شبکه)
  // درس اجرای واقعی: پنجرهٔ گارد چند دقیقه‌ای است → تلاش مجدد گارد باید با فاصلهٔ
  // نمایی باشد (۳۰ث، ۶۰ث) نه هر ۱۰ث؛ هر درخواست در پنجرهٔ بسته، پنجره را دوباره گرم می‌کند.
  const MAX_ROUNDS = 3;
  const RETRY_WAIT_MS = 10 * 1000;        // قطع کامل شبکه
  const GUARD_RETRY_WAIT_MS = 30 * 1000;  // گارد — ضربدر شمارهٔ راند → ۳۰ث/۶۰ث
  const SCAN_BUDGET_MS = 480 * 1000;      // سقف کل اسکن ستاد ۸ دقیقه — سرور رادار بلاک‌کننده نیست
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const allItems = [];
  const allPages = [];
  let lastResult = null;
  let pending = targets;

  for (let round = 1; round <= MAX_ROUNDS && pending.length; round++) {
    const kindFilter = Array.isArray(src.setadKinds) && src.setadKinds.length ? src.setadKinds : null;
    const result = await scanAllOnce(pending, { timeout, maxPages, lookbackDays, kindFilter, deadline });
    lastResult = result;
    allItems.push(...result.items);
    allPages.push(...result.pagesInfo);
    const stillGuarded = result.guarded || [];
    const allNet = allItems.length === 0 && !stillGuarded.length
      && pending.length > 0 && result.failed.length >= pending.length; // قطع کامل شبکه
    if (!stillGuarded.length && !allNet) break;
    if (round >= MAX_ROUNDS || Date.now() > deadline - RETRY_WAIT_MS) break;
    const waitMs = stillGuarded.length ? GUARD_RETRY_WAIT_MS * round : RETRY_WAIT_MS;
    errors.push(stillGuarded.length
      ? `گارد ستاد روی ${stillGuarded.length} شهر (راند ${round}/${MAX_ROUNDS}) — ${waitMs / 1000}s صبر و فقط همان شهرها دوباره`
      : `قطع کامل (راند ${round}/${MAX_ROUNDS}) — ${RETRY_WAIT_MS / 1000}s صبر و دوباره`);
    await sleep(waitMs);
    pending = stillGuarded.length ? stillGuarded : pending;
  }

  // ۴) مسیر پشتیبان HTML اگر API چیزی نداد
  let usedFallback = false;
  let items = allItems;
  if (items.length === 0) {
    const fb = await htmlFallback(fallbackUrls, { timeout });
    if (fb.items.length) { items = fb.items; usedFallback = true; }
    for (const e of fb.errors) errors.push(e);
  }

  const ok = items.length > 0;
  const guardedCities = allPages.filter(p => p.guarded).map(p => p.target);
  return {
    ok,
    items,
    error: ok ? null : (errors.slice(0, 3).join(' | ') || 'آگهی فعالی در شهرهای هدف ستاد نیست'),
    diagnostics: {
      api: 'setadiran',
      mode: usedFallback ? 'html-fallback' : 'explicit-city-ids',
      lookbackDays: lookbackDays || null,
      stoppedEarly: lastResult ? lastResult.stoppedEarly : false,
      netDown: allItems.length === 0 && !!(lastResult && lastResult.netDown),
      targets: targets.length,
      guardedCities,
      pages: allPages,
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
