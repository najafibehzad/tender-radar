// lib/adapters/didehban.mjs — پروکسی به وب‌اپ دیده‌بان (localhost:3725)
//
// وقتی اتصال مستقیم به ستاد با گارد/WAF بسته است، این آداپتر از وب‌اپ دیده‌بان
// که روی همان ماشین اجرا می‌شود داده می‌گیرد. دیده‌بان خودش مدیریت گارد،
// تکرار، و اسکن دوره‌ای را انجام می‌دهد.
//
// منبع: http://localhost:3725 (تنظیم‌شده در src.didehbanUrl)

import { normalizeFa, toAsciiDigits, parseAnyDate } from '../text.mjs';

const DEFAULT_URL = 'http://127.0.0.1:3725';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) {
  return normalizeFa(String(s || '')).replace(/\s+/g, ' ').trim();
}

async function fetchJson(url, { timeoutMs = 15000, method = 'GET' } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, signal: ac.signal, headers: { 'Accept': 'application/json' } });
    const text = await res.text();
    try { return { ok: res.ok, status: res.status, json: JSON.parse(text) }; }
    catch { return { ok: false, status: res.status, error: 'پاسخ JSON نامعتبر' }; }
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
    return { ok: false, status: 0, error: aborted ? 'اتمام زمان انتظار' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function mapDidehbanItem(it) {
  const title = normalizeFa(it.title || '').trim();
  if (!title) return null;
  const dl = parseAnyDate(it.documentDeadline || it.deadline || it.sendDeadline);
  const city = normalizeFa(it.city || '');
  const org = normalizeFa(it.org || '').trim();
  const kind = 'مناقصه'; // دیده‌بان فقط مناقصه را فیلتر می‌کند
  const number = String(it.number || '');
  return {
    title,
    description: [
      org ? `دستگاه: ${org}` : '',
      number ? `شمارهٔ فراخوان: ${toAsciiDigits(number)}` : '',
      it.tag ? `موضوع: ${it.tag}` : '',
    ].filter(Boolean).join(' | '),
    url: it.link || 'https://etend.setadiran.ir/etend/centralboard-execute.action',
    org: org || 'ستاد ایران',
    city,
    province: '', // دیده‌بان استان را در خروجی ندارد
    publishedISO: null, publishedJalali: '',
    deadlineISO: dl.iso, deadlineJalali: dl.jalali,
    sendDeadlineISO: dl.iso, sendDeadlineJalali: dl.jalali,
    kind,
    number,
    price: 0,
    locationRaw: norm(`${org} ${city}`),
    extra: { tag: it.tag || '', source: 'didehban' },
  };
}

/** وضعیت وب‌اپ را می‌گیرد (سریع، بدون اسکن) */
async function getStatus(baseUrl, timeout) {
  const r = await fetchJson(`${baseUrl}/api/status`, { timeoutMs: timeout });
  if (!r.ok) return { ok: false, error: r.error || `HTTP ${r.status}` };
  return { ok: true, data: r.json };
}

/** اسکن را از طریق وب‌اپ شروع می‌کند و نتیجه را منتظر می‌ماند */
async function triggerAndWait(baseUrl, timeout) {
  const start = await fetchJson(`${baseUrl}/api/scan`, { timeoutMs: 10000, method: 'POST' });
  if (!start.ok) return { ok: false, error: start.error || `HTTP ${start.status}` };
  // صبر تا اسکن تمام شود (حداکثر timeout)
  const t0 = Date.now();
  const maxWait = Math.max(timeout - 5000, 10000);
  while (Date.now() - t0 < maxWait) {
    await sleep(3000);
    const st = await fetchJson(`${baseUrl}/api/status`, { timeoutMs: 8000 });
    if (!st.ok) continue;
    if (!st.json.scanRunning) {
      const d = st.json.lastScanData;
      if (d && d.ok && Array.isArray(d.items)) {
        return { ok: true, items: d.items, fromCache: false };
      }
      if (d && d.message) {
        return { ok: false, error: d.message };
      }
      return { ok: false, error: 'اسکن وب‌اپ بدون نتیجه تمام شد' };
    }
  }
  return { ok: false, error: 'زمان انتظار برای اسکن وب‌اپ تمام شد' };
}

/**
 * آداپتر دیده‌بان.
 * src.didehbanUrl: نشانی وب‌اپ (پیش‌فرض: http://127.0.0.1:3725)
 * src.didehbanTrigger: اگر true، اسکن جدید شروع می‌کند (کند)
 */
export async function fetchDidehban(src, { timeout = 30000 } = {}) {
  const baseUrl = (src.didehbanUrl || DEFAULT_URL).replace(/\/$/, '');
  const trigger = src.didehbanTrigger === true;

  // ۱) خواندن وضعیت فعلی
  const status = await getStatus(baseUrl, Math.min(timeout, 15000));
  if (!status.ok) {
    return {
      ok: false, items: [],
      error: `وب‌اپ دیده‌بان در دسترس نیست: ${status.error}`,
      diagnostics: { api: 'didehban', url: baseUrl },
    };
  }

  const st = status.data;
  const cfg = st.config || {};
  const lastScanData = st.lastScanData || null;
  const scanCached = st.scanCached === true;

  // ۲) اگر کش تازه دارد و نیازی به اسکن جدید نیست
  let rawItems = null;
  if (!trigger && scanCached && lastScanData && lastScanData.ok && Array.isArray(lastScanData.items)) {
    rawItems = lastScanData.items;
  }

  // ۳) اگر کش ندارد یا trigger=true، اسکن جدید
  if (rawItems === null) {
    if (st.scanRunning) {
      // صبر تا اسکن فعلی تمام شود
      const scanResult = await triggerAndWait(baseUrl, timeout);
      if (scanResult.ok) rawItems = scanResult.items;
      else {
        return {
          ok: false, items: [],
          error: scanResult.error,
          diagnostics: { api: 'didehban', url: baseUrl, scanRunning: true },
        };
      }
    } else {
      const scanResult = await triggerAndWait(baseUrl, timeout);
      if (scanResult.ok) rawItems = scanResult.items;
      else {
        // اگر اسکن شکست خورد ولی lastScanData قدیمی داریم، از آن استفاده کن
        if (lastScanData && Array.isArray(lastScanData.items)) {
          rawItems = lastScanData.items;
        } else {
          return {
            ok: false, items: [],
            error: scanResult.error,
            diagnostics: { api: 'didehban', url: baseUrl },
          };
        }
      }
    }
  }

  // ۴) تبدیل به فرمت tender-radar
  const items = [];
  const seen = new Set();
  for (const it of (rawItems || [])) {
    const mapped = mapDidehbanItem(it);
    if (!mapped) continue;
    const key = norm(mapped.title).replace(/\s+/g, '').slice(0, 90);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(mapped);
  }

  return {
    ok: items.length > 0,
    items,
    error: items.length > 0 ? null : 'وب‌اپ دیده‌بان آگهی فعالی ندارد',
    diagnostics: {
      api: 'didehban',
      url: baseUrl,
      cached: scanCached,
      activeCities: (cfg.districts || []).filter(d => !d._disabled).length,
      seenCount: (st.state && st.state.seenCount) || 0,
    },
  };
}

/** تشخیص گام‌به‌گام */
export async function diagnoseDidehban({ timeout = 15000, src = null } = {}) {
  const baseUrl = ((src && src.didehbanUrl) || DEFAULT_URL).replace(/\/$/, '');
  const steps = [];

  steps.push({ step: 'نشانی وب‌اپ', ok: true, url: baseUrl });

  const r = await fetchJson(`${baseUrl}/api/status`, { timeoutMs: timeout });
  steps.push({
    step: 'وضعیت وب‌اپ',
    ok: r.ok,
    status: r.status,
    error: r.ok ? null : (r.error || `HTTP ${r.status}`),
  });

  if (r.ok && r.json) {
    steps.push({
      step: 'پیکربندی',
      ok: true,
      districts: (r.json.config && r.json.config.districts) ? r.json.config.districts.length : 0,
      scanCached: !!r.json.scanCached,
      scanRunning: !!r.json.scanRunning,
    });
    const d = r.json.lastScanData;
    if (d) {
      steps.push({
        step: 'آخرین اسکن',
        ok: d.ok,
        newCount: d.newCount,
        itemCount: Array.isArray(d.items) ? d.items.length : 0,
        error: d.ok ? null : (d.message || 'اسکن ناموفق'),
      });
    }
  }

  const ok = steps.some(s => s.step === 'وضعیت وب‌اپ' && s.ok);
  return { ok, steps };
}
