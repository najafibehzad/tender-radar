#!/usr/bin/env node
// server.mjs — وب‌اپ رادار مناقصات
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadRegistry, saveRegistry, loadCache, saveCache, saveScanResult, appendLog, uniqueId, findSource, PATHS } from './lib/store.mjs';
import { scanAll } from './lib/scanner.mjs';
import { detectSource, normalizeUrl } from './lib/detect.mjs';
import { foldForSearch, normalizeFa, faNum, todayTehran, daysUntil, DEFAULT_TOPICS } from './lib/text.mjs';
import { provinceOf, isKnownCity } from './lib/cities.mjs';
import { runAssistant, runActions } from './lib/assistant.mjs';
import { diagnose } from './lib/diagnose.mjs';
import { health as aiHealth, loadConfig as loadAiConfig, saveConfig as saveAiConfig, invalidateHealth } from './lib/ai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const PORT = parseInt(process.env.PORT || '3731', 10);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ---------- وضعیت اسکن ----------
let scanState = { running: false, startedAt: null, done: 0, total: 0, current: '', ok: 0, items: 0, error: null, lastResult: null };
let timer = null;

async function runScan(opts = {}) {
  if (scanState.running) return { ok: false, error: 'اسکن در حال اجراست' };
  const reg = loadRegistry();
  scanState = { running: true, startedAt: new Date().toISOString(), done: 0, total: reg.sources.filter(s => !s._disabled).length, current: '', ok: 0, items: 0, error: null, lastResult: null };
  try {
    const res = await scanAll(reg, {
      onlySourceIds: opts.onlySourceIds || null,
      onProgress: p => {
        scanState.done = p.done; scanState.total = p.total; scanState.current = p.source; scanState.items += p.count;
        if (typeof opts.onProgress === 'function') { try { opts.onProgress(p); } catch { /* بی‌اهمیت */ } }
      },
    });
    saveScanResult(res, opts.onlySourceIds || null);
    appendLog({ at: res.scannedAt, total: res.stats.total, ok: res.sourcesOk, failed: res.sourcesFailed, ms: res.durationMs, partial: !!opts.onlySourceIds });
    scanState.lastResult = { total: res.stats.total, sourcesOk: res.sourcesOk, sourcesFailed: res.sourcesFailed, durationMs: res.durationMs };
    return { ok: true, ...scanState.lastResult, scannedNow: (res.items || []).length };
  } catch (e) {
    scanState.error = String(e && e.message || e);
    return { ok: false, error: scanState.error };
  } finally {
    scanState.running = false;
  }
}

function scheduleInterval() {
  if (timer) { clearInterval(timer); timer = null; }
  const reg = loadRegistry();
  const mins = Number(reg.settings?.scanIntervalMinutes || 0);
  if (mins > 0) {
    timer = setInterval(() => { runScan().catch(() => {}); }, mins * 60000);
    console.log(`⏱ اسکن خودکار هر ${mins} دقیقه فعال شد`);
  }
}

// ---------- فیلتر و جستجو ----------
function filterItems(items, q) {
  const text = (q.get('q') || '').trim();
  const topic = q.get('topic') || '';
  const city = q.get('city') || '';
  const province = q.get('province') || '';
  const kind = q.get('kind') || '';
  const sourceId = q.get('source') || '';
  const days = q.get('days') ? Number(q.get('days')) : null;
  const onlyWithDeadline = q.get('hasDeadline') === '1';
  const onlyToday = q.get('today') === '1';
  // «فقط تهران و البرز» پیش‌فرض روشن است (settings.targetOnly) و با target=0 خاموش می‌شود
  const targetDefault = (loadRegistry().settings || {}).targetOnly !== false;
  const targetParam = q.get('target');
  const onlyTarget = targetParam === '1' || (targetDefault && targetParam !== '0');
  const sort = q.get('sort') || 'newest';
  const today = todayTehran().iso;

  const fText = foldForSearch(text);
  const terms = fText ? fText.split(/\s+/).filter(Boolean) : [];

  let out = items.filter(it => {
    if (topic && !(it.topicIds || []).includes(topic)) return false;
    if (city && it.city !== city) return false;
    if (province && it.province !== province) return false;
    if (kind && it.kind !== kind) return false;
    if (sourceId && it.sourceId !== sourceId) return false;
    if (onlyWithDeadline && !it.deadlineISO) return false;
    if (onlyToday && it.publishedISO !== today) return false;
    if (onlyTarget && !['تهران', 'البرز'].includes(it.province)) return false;
    if (days != null) {
      if (!it.publishedISO) return false;
      const d = daysUntil(today, it.publishedISO);
      if (d == null || d > days) return false;
    }
    if (terms.length) {
      const hay = foldForSearch(`${it.title} ${it.description} ${it.city} ${it.province} ${it.org} ${it.sourceName} ${(it.keywords || []).join(' ')}`);
      for (const t of terms) if (!hay.includes(t)) return false;
    }
    return true;
  });

  // کلید تازگی برای مرتب‌سازی: تاریخ انتشار؛ برای آگهی‌های بدون تاریخ انتشار (ستاد/etend
  // تاریخ انتشار نمی‌دهند) تاریخ اولین مشاهده در رادار — تا آگهی‌های تازه‌کشف‌شده
  // بالای فهرست بیایند، نه ته آن با ترتیب تصادفی اسکن.
  const recencyKey = it => String(it.publishedISO || String(it.firstSeenAt || '').slice(0, 10) || '');
  const cmp = {
    newest: (a, b) => recencyKey(b).localeCompare(recencyKey(a)),
    oldest: (a, b) => String(a.publishedISO || 'zzz').localeCompare(String(b.publishedISO || 'zzz')),
    deadline: (a, b) => String(a.deadlineISO || 'zzz').localeCompare(String(b.deadlineISO || 'zzz')),
    city: (a, b) => String(a.city || 'zzz').localeCompare(String(b.city || 'zzz'), 'fa'),
    source: (a, b) => String(a.sourceName || '').localeCompare(String(b.sourceName || ''), 'fa'),
  }[sort] || ((a, b) => 0);
  out = out.slice().sort(cmp);
  return out;
}

function buildFacets(items, registrySources) {
  // فقط منابع فعال (حاضر در registry و غیرخاموش)
  const activeIds = new Set((registrySources || []).filter(s => !s._disabled).map(s => s.id));
  const activeNames = new Set((registrySources || []).filter(s => !s._disabled).map(s => s.name));
  const facet = (key, normalize, nameKey) => {
    const m = new Map();
    for (const it of items) {
      let v = it[key];
      if (!v) continue;
      // فقط آیتم‌هایی از منابع فعال
      if (nameKey && !activeNames.has(v)) continue;
      if (normalize) v = normalize(v);
      m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  };
  // یکسان‌سازی نام شهر: حذف پیشوند «شهر » (مثلاً «شهر قدس» → «قدس»)
  const normCity = (c) => c.replace(/^شهر\s+/, '');
  return { city: facet('city', normCity), province: facet('province'), kind: facet('kind'), source: facet('sourceName', null, true) };
}

// ---------- پاسخ‌دهی ----------
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(buf);
}
function sendJson(res, data, status = 200) {
  const json = JSON.stringify(data);
  if (json.length > 1024 && /\bgzip\b/.test(String(res.req?.headers?.['accept-encoding'] || ''))) {
    const buf = zlib.gzipSync(Buffer.from(json, 'utf8'));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    return res.end(buf);
  }
  send(res, status, json);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// ---------- جریان رویداد (SSE) ----------
function sseStart(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
}
function sseSend(res, obj) {
  try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* قطع اتصال */ }
}

/** زمینهٔ مشترک ابزارهای دستیار */
function assistantCtx() {
  return {
    registry: loadRegistry(),
    cache: loadCache(),
    reloadRegistry: () => loadRegistry(),
    reloadCache: () => loadCache(),
    saveRegistry: (r) => saveRegistry(r),
    detectSource,
    runScan,
    scheduleInterval,
    isScanning: () => !!scanState.running,
  };
}

// ---------- CSV ----------
function toCsv(items) {
  const esc = v => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return `"${s}"`;
  };
  const head = ['ردیف', 'عنوان', 'نوع', 'شهر', 'استان', 'سازمان', 'منبع', 'تاریخ انتشار', 'مهلت', 'موضوعات', 'نشانی'];
  const rows = items.map((it, i) => [
    i + 1, it.title, it.kind, it.city, it.province, it.org, it.sourceName,
    it.publishedJalali || it.publishedISO || '', it.deadlineJalali || it.deadlineISO || '',
    (it.topics || []).join('، '), it.url,
  ].map(esc).join(','));
  return '\uFEFF' + [head.map(esc).join(','), ...rows].join('\r\n');
}

// ---------- سرور ----------
const server = http.createServer(async (req, res) => {
  res.req = req;
  const url = new URL(req.url, `http://${req.headers.host || HOST + ':' + PORT}`);
  const p = url.pathname;
  const q = url.searchParams;

  try {
    // --- وضعیت ---
    if (p === '/api/status' && req.method === 'GET') {
      const reg = loadRegistry();
      const cache = loadCache();
      return sendJson(res, {
        ok: true,
        registry: reg,
        scannedAt: cache.scannedAt,
        itemCount: (cache.items || []).length,
        stats: cache.stats || null,
        sourcesReport: cache.sources || [],
        sourcesOk: cache.sourcesOk ?? (cache.sources || []).filter(s => s.ok).length,
        sourcesFailed: cache.sourcesFailed ?? (cache.sources || []).filter(s => !s.ok).length,
        sourcesTotal: cache.sourcesTotal ?? (reg.sources || []).length,
        durationMs: cache.durationMs || 0,
        scan: scanState,
      });
    }

    // --- اسکن ---
    if (p === '/api/scan' && req.method === 'POST') {
      const body = await readBody(req);
      const r = await runScan({ onlySourceIds: body.onlySourceIds || null });
      return sendJson(res, r);
    }
    if (p === '/api/scan/status' && req.method === 'GET') {
      // ⚠️ scanState خودش کلید `ok` دارد (شمارندهٔ آیتم‌ها) — پس `ok: true` باید **بعد** از
      // گسترش بیاید وگرنه مقدار درست را بازنویسی می‌کند.
      return sendJson(res, { ...scanState, ok: true, scannedItems: scanState.ok });
    }

    // --- آیتم‌ها ---
    if (p === '/api/items' && req.method === 'GET') {
      const cache = loadCache();
      const reg = loadRegistry();
      const items = filterItems(cache.items || [], q);
      const limit = Math.min(Number(q.get('limit') || 500), 2000);
      const offset = Number(q.get('offset') || 0);
      return sendJson(res, {
        ok: true,
        total: items.length,
        offset, limit,
        items: items.slice(offset, offset + limit),
        facets: buildFacets(cache.items || [], reg.sources),
        scannedAt: cache.scannedAt,
      });
    }

    // --- برون‌بری ---
    if (p === '/api/export.csv' && req.method === 'GET') {
      const cache = loadCache();
      const items = filterItems(cache.items || [], q);
      const csv = toCsv(items);
      const name = `tenders-${todayTehran().iso}.csv`;
      return send(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${name}"` });
    }
    if (p === '/api/export.json' && req.method === 'GET') {
      const cache = loadCache();
      const items = filterItems(cache.items || [], q);
      return send(res, 200, JSON.stringify({ exportedAt: new Date().toISOString(), count: items.length, items }, null, 2), 'application/json; charset=utf-8', {
        'Content-Disposition': `attachment; filename="tenders-${todayTehran().iso}.json"`,
      });
    }

    // --- شناسایی سایت ---
    if (p === '/api/detect' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.url) return sendJson(res, { ok: false, error: 'نشانی لازم است' }, 400);
      const r = await detectSource(body.url, { timeout: 25000 });
      return sendJson(res, { ok: true, report: r });
    }

    // --- منابع ---
    if (p === '/api/sources' && req.method === 'GET') return sendJson(res, { ok: true, sources: loadRegistry().sources });

    if (p === '/api/sources' && req.method === 'POST') {
      const b = await readBody(req);
      const reg = loadRegistry();
      const name = normalizeFa(b.name || '').trim();
      const url = normalizeUrl(b.url || '');
      if (!name) return sendJson(res, { ok: false, error: 'نام منبع لازم است' }, 400);
      if (!url) return sendJson(res, { ok: false, error: 'نشانی معتبر لازم است' }, 400);
      if (reg.sources.some(s => s.url.replace(/\/+$/, '') === url.replace(/\/+$/, ''))) {
        return sendJson(res, { ok: false, error: 'این نشانی قبلاً ثبت شده است' }, 400);
      }
      const city = normalizeFa(b.city || '').trim();
      const src = {
        id: uniqueId(reg, b.id || city || name),
        name,
        city,
        province: normalizeFa(b.province || provinceOf(city) || '').trim(),
        type: b.type || 'شهرداری',
        url,
        adapter: ['wordpress', 'rss', 'html', 'sitemap', 'odata', 'setadiran'].includes(b.adapter) ? b.adapter : 'html',
        pages: Array.isArray(b.pages) ? b.pages.filter(Boolean) : undefined,
        feeds: Array.isArray(b.feeds) ? b.feeds.filter(Boolean) : undefined,
        // فیلدهای مخصوص هر آداپتر
        odataPath: typeof b.odataPath === 'string' ? b.odataPath : undefined,
        odataTop: Number.isFinite(+b.odataTop) ? +b.odataTop : undefined,
        detailPattern: typeof b.detailPattern === 'string' ? b.detailPattern : undefined,
        setadProvinces: Array.isArray(b.setadProvinces) ? b.setadProvinces.filter(Boolean) : undefined,
        setadCities: Array.isArray(b.setadCities)
          ? b.setadCities.filter(c => c && String(c.id || '').trim() !== '')
              .map(c => ({ province: String(c.province || '').trim(), city: String(c.city || '').trim(), id: String(c.id).trim() }))
          : undefined,
        setadQueries: Array.isArray(b.setadQueries) ? b.setadQueries.filter(Boolean) : undefined,
        setadHtmlFallback: Array.isArray(b.setadHtmlFallback) ? b.setadHtmlFallback.filter(Boolean) : undefined,
        setadMaxPages: Number.isFinite(+b.setadMaxPages) ? +b.setadMaxPages : undefined,
        _disabled: false,
        verified: !!b.verified,
        note: normalizeFa(b.note || '').trim(),
        addedAt: new Date().toISOString(),
      };
      reg.sources.push(src);
      saveRegistry(reg);
      return sendJson(res, { ok: true, source: src });
    }

    const srcMatch = p.match(/^\/api\/sources\/([^/]+)$/);
    if (srcMatch) {
      const id = decodeURIComponent(srcMatch[1]);
      const reg = loadRegistry();
      const src = findSource(reg, id);
      if (!src) return sendJson(res, { ok: false, error: 'منبع پیدا نشد' }, 404);

      if (req.method === 'PUT' || req.method === 'PATCH') {
        const b = await readBody(req);
        const allowed = ['name', 'city', 'province', 'type', 'adapter', 'note', '_disabled', 'url'];
        for (const k of allowed) {
          if (b[k] === undefined) continue;
          if (k === 'url') { const u = normalizeUrl(b[k]); if (u) src.url = u; continue; }
          if (k === '_disabled') { src._disabled = !!b[k]; continue; }
          if (k === 'adapter') { if (['wordpress', 'rss', 'html', 'sitemap', 'odata', 'setadiran'].includes(b[k])) src.adapter = b[k]; continue; }
          src[k] = typeof b[k] === 'string' ? normalizeFa(b[k]).trim() : b[k];
        }
        if (b.pages !== undefined) src.pages = Array.isArray(b.pages) ? b.pages.filter(Boolean) : undefined;
        if (b.feeds !== undefined) src.feeds = Array.isArray(b.feeds) ? b.feeds.filter(Boolean) : undefined;
        if (b.setadCities !== undefined) {
          src.setadCities = Array.isArray(b.setadCities)
            ? b.setadCities.filter(c => c && String(c.id || '').trim() !== '')
                .map(c => ({ province: String(c.province || '').trim(), city: String(c.city || '').trim(), id: String(c.id).trim() }))
            : undefined;
        }
        if (b.setadProvinces !== undefined) src.setadProvinces = Array.isArray(b.setadProvinces) ? b.setadProvinces.filter(Boolean) : undefined;
        if (b.setadHtmlFallback !== undefined) src.setadHtmlFallback = Array.isArray(b.setadHtmlFallback) ? b.setadHtmlFallback.filter(Boolean) : undefined;
        if (b.setadMaxPages !== undefined && Number.isFinite(+b.setadMaxPages)) src.setadMaxPages = +b.setadMaxPages;
        if (b.odataPath !== undefined) src.odataPath = String(b.odataPath);
        if (!src.province && src.city) src.province = provinceOf(src.city);
        saveRegistry(reg);
        return sendJson(res, { ok: true, source: src });
      }
      if (req.method === 'DELETE') {
        reg.sources = reg.sources.filter(s => s.id !== id);
        saveRegistry(reg);
        return sendJson(res, { ok: true, removed: id });
      }
      if (req.method === 'GET') return sendJson(res, { ok: true, source: src });
    }

    const toggleMatch = p.match(/^\/api\/sources\/([^/]+)\/toggle$/);
    if (toggleMatch && req.method === 'POST') {
      const reg = loadRegistry();
      const src = findSource(reg, decodeURIComponent(toggleMatch[1]));
      if (!src) return sendJson(res, { ok: false, error: 'منبع پیدا نشد' }, 404);
      src._disabled = !src._disabled;
      saveRegistry(reg);
      return sendJson(res, { ok: true, source: src });
    }

    // --- موضوعات ---
    if (p === '/api/topics' && req.method === 'GET') return sendJson(res, { ok: true, topics: loadRegistry().topics });

    if (p === '/api/topics' && req.method === 'POST') {
      const b = await readBody(req);
      const reg = loadRegistry();
      const name = normalizeFa(b.name || '').trim();
      if (!name) return sendJson(res, { ok: false, error: 'نام موضوع لازم است' }, 400);
      const words = (Array.isArray(b.words) ? b.words : String(b.words || '').split(/[,،]/))
        .map(w => normalizeFa(w).trim()).filter(Boolean);
      if (!words.length) return sendJson(res, { ok: false, error: 'حداقل یک کلیدواژه لازم است' }, 400);
      if (reg.topics.some(t => t.name === name)) return sendJson(res, { ok: false, error: 'این موضوع وجود دارد' }, 400);
      const id = uniqueId({ sources: reg.topics.map(t => ({ id: t.id })) }, b.id || name);
      const t = { id, name, words, custom: true };
      reg.topics.push(t);
      saveRegistry(reg);
      return sendJson(res, { ok: true, topic: t });
    }

    const topMatch = p.match(/^\/api\/topics\/([^/]+)$/);
    if (topMatch) {
      const reg = loadRegistry();
      const id = decodeURIComponent(topMatch[1]);
      const t = reg.topics.find(x => x.id === id);
      if (!t) return sendJson(res, { ok: false, error: 'موضوع پیدا نشد' }, 404);
      if (req.method === 'DELETE') {
        reg.topics = reg.topics.filter(x => x.id !== id);
        saveRegistry(reg);
        return sendJson(res, { ok: true, removed: id });
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const b = await readBody(req);
        if (b._disabled !== undefined) t._disabled = !!b._disabled;
        if (b.name) t.name = normalizeFa(b.name).trim();
        if (b.words !== undefined) {
          t.words = (Array.isArray(b.words) ? b.words : String(b.words).split(/[,،]/)).map(w => normalizeFa(w).trim()).filter(Boolean);
        }
        saveRegistry(reg);
        return sendJson(res, { ok: true, topic: t });
      }
    }

    // --- تنظیمات ---
    if (p === '/api/settings' && req.method === 'POST') {
      const b = await readBody(req);
      const reg = loadRegistry();
      const cur = reg.settings || {};
      // اعتبارسنجی و کلمپ — جلوگیری از مقدارهای نابخردانه (۰، منفی، خارج از بازه)
      const clamp = (v, lo, hi, prev) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return prev;
        return Math.min(hi, Math.max(lo, Math.round(n)));
      };
      const next = { ...cur };
      if (b.scanIntervalMinutes !== undefined) next.scanIntervalMinutes = clamp(b.scanIntervalMinutes, 0, 1440, cur.scanIntervalMinutes ?? 0);
      if (b.lookbackDays !== undefined) next.lookbackDays = clamp(b.lookbackDays, 7, 730, cur.lookbackDays ?? 150);
      if (b.requestTimeoutMs !== undefined) next.requestTimeoutMs = clamp(b.requestTimeoutMs, 5000, 120000, cur.requestTimeoutMs ?? 30000);
      if (b.maxItemsPerSource !== undefined) next.maxItemsPerSource = clamp(b.maxItemsPerSource, 20, 2000, cur.maxItemsPerSource ?? 300);
      if (b.autoScanOnStart !== undefined) next.autoScanOnStart = !!b.autoScanOnStart;
      if (b.targetOnly !== undefined) next.targetOnly = !!b.targetOnly;
      reg.settings = next;
      saveRegistry(reg);
      scheduleInterval();
      return sendJson(res, { ok: true, settings: reg.settings });
    }

    if (p === '/api/reset-cache' && req.method === 'POST') {
      saveCache({ scannedAt: null, items: [], sources: [], stats: null });
      return sendJson(res, { ok: true });
    }

    if (p === '/api/health') return sendJson(res, { ok: true, ts: new Date().toISOString(), scan: scanState });

    // ================= دستیار هوشمند =================

    // گفت‌وگو (جریان رویداد)
    if (p === '/api/assistant' && req.method === 'POST') {
      const body = await readBody(req);
      const text = normalizeFa(body.text || '').trim();
      if (!text) return sendJson(res, { ok: false, error: 'متن درخواست لازم است' }, 400);
      sseStart(res);
      let closed = false;
      req.on('close', () => { closed = true; });
      const emit = ev => { if (!closed) sseSend(res, ev); };
      try {
        const r = await runAssistant({
          text,
          opts: {
            fresh: body.fresh,
            noAi: body.noAi,
            diagnose: body.diagnose,
            freshMinutes: body.freshMinutes,
          },
          ctx: assistantCtx(),
          emit,
        });
        emit({ type: 'final', answer: r.answer, meta: r.meta });
      } catch (e) {
        emit({ type: 'error', error: String(e && e.message || e) });
      }
      if (!closed) res.end();
      return;
    }

    // سلامت دروازهٔ هوش مصنوعی
    if (p === '/api/assistant/health' && req.method === 'GET') {
      const h = await aiHealth(q.get('force') === '1');
      return sendJson(res, { ok: true, ...h });
    }

    // تنظیمات هوش مصنوعی
    if (p === '/api/assistant/config' && req.method === 'GET') {
      const cfg = loadAiConfig();
      return sendJson(res, { ok: true, config: { ...cfg, apiKey: cfg.apiKey ? cfg.apiKey.slice(0, 10) + '…' : '' }, hasKey: !!cfg.apiKey });
    }
    if (p === '/api/assistant/config' && req.method === 'POST') {
      const b = await readBody(req);
      const patch = {};
      if (b.enabled !== undefined) patch.enabled = !!b.enabled;
      if (b.baseUrl !== undefined) patch.baseUrl = String(b.baseUrl).replace(/\/+$/, '');
      if (b.apiKey !== undefined && b.apiKey !== '' && !String(b.apiKey).includes('…')) patch.apiKey = String(b.apiKey);
      if (Array.isArray(b.models)) patch.models = b.models.map(m => String(m).trim()).filter(Boolean);
      if (b.timeoutMs !== undefined) patch.timeoutMs = Math.min(300000, Math.max(10000, Number(b.timeoutMs) || 90000));
      if (b.maxTokens !== undefined) patch.maxTokens = Math.min(4000, Math.max(200, Number(b.maxTokens) || 1400));
      if (b.temperature !== undefined) patch.temperature = Math.min(1.5, Math.max(0, Number(b.temperature) || 0.2));
      const cfg = saveAiConfig(patch);
      invalidateHealth();
      const h = await aiHealth(true);
      return sendJson(res, { ok: true, config: { ...cfg, apiKey: cfg.apiKey ? cfg.apiKey.slice(0, 10) + '…' : '' }, health: h });
    }

    // تشخیص ایراد منابع
    if (p === '/api/assistant/diagnose' && req.method === 'POST') {
      const d = diagnose(loadRegistry(), loadCache());
      return sendJson(res, { ok: true, report: d });
    }

    // اجرای اقدام‌های درمان (جریان رویداد)
    if (p === '/api/assistant/action' && req.method === 'POST') {
      const body = await readBody(req);
      let actions = Array.isArray(body.actions) ? body.actions : [];
      if (body.mode === 'auto') {
        const d = diagnose(loadRegistry(), loadCache());
        actions = d.actions.filter(a => a.severity === 'high').slice(0, 8);
        if (!actions.length) actions = d.actions.slice(0, 5);
      }
      if (!actions.length) return sendJson(res, { ok: false, error: 'اقدامی برای اجرا نیست' }, 400);
      sseStart(res);
      let closed = false;
      req.on('close', () => { closed = true; });
      const emit = ev => { if (!closed) sseSend(res, ev); };
      try {
        const results = await runActions(actions, assistantCtx(), emit);
        emit({ type: 'repair-done', results });
      } catch (e) {
        emit({ type: 'error', error: String(e && e.message || e) });
      }
      if (!closed) res.end();
      return;
    }

    // --- فایل‌های ایستا ---
    let rel = p === '/' ? '/index.html' : p;
    const filePath = path.join(PUBLIC, decodeURIComponent(rel));
    if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      return send(res, 200, fs.readFileSync(filePath), MIME[ext] || 'application/octet-stream');
    }

    send(res, 404, 'یافت نشد', 'text/plain; charset=utf-8');
  } catch (e) {
    console.error('API error:', e);
    sendJson(res, { ok: false, error: String(e && e.message || e) }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🎯 رادار مناقصات — وب‌اپ روی پورت ${PORT} آماده است`);
  console.log(`     http://${HOST}:${PORT}\n`);
  const reg = loadRegistry();
  scheduleInterval();
  if (reg.settings?.autoScanOnStart) {
    const cache = loadCache();
    if (!cache.scannedAt) {
      console.log('  ⏳ اسکن خودکار آغاز شد ...');
      runScan().then(r => console.log(r.ok ? `  ✅ ${faNum(r.total)} آگهی` : `  ⚠ ${r.error}`)).catch(() => {});
    }
  }
});

process.on('uncaughtException', e => console.error('Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('Unhandled:', e));
