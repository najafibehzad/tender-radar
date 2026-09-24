// lib/fetcher.mjs — لایهٔ شبکه با timeout، تلاش مجدد و کاربر-نمای مرورگر
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

export const DEFAULT_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

export class FetchError extends Error {
  constructor(msg, code, status) { super(msg); this.code = code; this.status = status; }
}

/**
 * دریافت یک نشانی با timeout و تلاش مجدد.
 * @returns {Promise<{status:number, ok:boolean, body:string, url:string, ms:number, error?:string}>}
 */
export async function fetchText(url, { timeout = 25000, retries = 1, headers = {}, method = 'GET', body = null } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: ac.signal,
        headers: { ...DEFAULT_HEADERS, ...headers },
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, body: text, url: res.url, ms: Date.now() - t0 };
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
      last = {
        status: 0, ok: false, body: '', url,
        ms: Date.now() - t0,
        error: aborted ? 'اتمام زمان انتظار' : friendlyNetError(e),
      };
      // خطاهای قطعی (دامنه پیدا نشد / اتصال رد شد) با تلاش مجدد درست نمی‌شوند
      // → اسکن را معطل نکن (هر تلاش = تمام مهلت)
      if (isFatalNetError(e)) break;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(600 * (attempt + 1));
  }
  return last;
}

/** خطای شبکه‌ای که تلاش مجدد فایده‌ای ندارد */
function isFatalNetError(e) {
  const m = String((e && (e.cause?.code || e.code || e.message)) || e);
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ERR_INVALID_URL|EHOSTUNREACH|ENETUNREACH/i.test(m);
}

export async function fetchJson(url, opts = {}) {
  const r = await fetchText(url, opts);
  if (!r.ok) return { ...r, json: null };
  try { return { ...r, json: JSON.parse(r.body) }; }
  catch { return { ...r, ok: false, json: null, error: 'پاسخ JSON نامعتبر' }; }
}

function friendlyNetError(e) {
  const m = String((e && e.message) || e);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return 'دامنه پیدا نشد (DNS)';
  if (/ECONNREFUSED/i.test(m)) return 'اتصال رد شد';
  if (/ECONNRESET|socket hang up/i.test(m)) return 'اتصال قطع شد';
  if (/CERT|TLS|SSL/i.test(m)) return 'خطای گواهی امنیتی';
  if (/ETIMEDOUT|timeout/i.test(m)) return 'اتمام زمان انتظار';
  return 'خطای شبکه';
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** اجرای هم‌زمان با محدودیت تعداد */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { __error: String(e && e.message || e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}
