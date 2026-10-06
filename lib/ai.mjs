// lib/ai.mjs — دروازهٔ هوش مصنوعی (سازگار با OpenAI)
//
// • کشف خودکار کلید از درگاه محلی (9Router) یا متغیر محیطی
// • زنجیرهٔ مدل جایگزین: اگر مدل اول جواب نداد، بعدی
// • پارس مقاوم پاسخ (درگاه محلی به بدنهٔ JSON پسوند «data: [DONE]» می‌چسباند)
// • استریم واقعی + عقب‌نشینی به حالت غیراستریم
// • بدون کلید/بدون شبکه هم برنامه کار می‌کند (assistant پاسخ قالبی می‌دهد)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'ai-config.json');

export const DEFAULT_MODELS = [
  'pt/ling-3.0-flash:free',
  'pt/deepseek-v4.1-flash:free',
  'af/gpt-oss-20b',
  'kc/nvidia/nemotron-3-super-120b-a12b:free',
  'hfr/zai-org/GLM-4.7-Flash',
  'hfr/Qwen/Qwen3-32B',
];

const DEFAULT_CONFIG = {
  enabled: true,
  baseUrl: 'http://localhost:20128/v1',
  apiKey: '',
  models: DEFAULT_MODELS,
  timeoutMs: 90000,
  maxTokens: 1400,
  temperature: 0.2,
  lastGoodModel: null,
};

// ---------- تنظیمات ----------
export function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* اولین اجرا */ }
  const envBase = process.env.NINEROUTER_URL ? process.env.NINEROUTER_URL.replace(/\/+$/, '') + '/v1' : '';
  const merged = { ...DEFAULT_CONFIG, ...cfg };
  if (!cfg.baseUrl && envBase) merged.baseUrl = envBase;
  if (!merged.models || !merged.models.length) merged.models = DEFAULT_MODELS;
  return merged;
}

export function saveConfig(patch) {
  const cur = loadConfig();
  const next = { ...cur, ...patch };
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  _healthCache = null;
  return next;
}

// ---------- کشف کلید ----------
const KEY_SQL = "const {DatabaseSync}=require('node:sqlite');" +
  "const p=require('path').join(process.env.APPDATA||'','9router','db','data.sqlite');" +
  "const db=new DatabaseSync(p,{readOnly:true});" +
  "const r=db.prepare('select key from apiKeys where isActive=1 order by createdAt limit 1').get();" +
  "process.stdout.write(r&&r.key?r.key:'')";

let _keyCache = null;

/** کلید درگاه محلی 9Router را از پایگاه‌دادهٔ خودش می‌خواند (فقط‌خواندنی) */
function readRouterKey() {
  const dbPath = path.join(process.env.APPDATA || '', '9router', 'db', 'data.sqlite');
  if (!fs.existsSync(dbPath)) return null;
  try {
    const out = execFileSync(process.execPath, ['--experimental-sqlite', '-e', KEY_SQL], {
      encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch { return null; }
}

/**
 * کلید مؤثر + منبع آن.
 * ترتیب: متغیر محیطی → فایل تنظیمات → درگاه محلی 9Router → OpenRouter
 */
export function resolveAuth() {
  if (_keyCache) return _keyCache;
  const cfg = loadConfig();
  if (process.env.NINEROUTER_KEY) { _keyCache = { key: process.env.NINEROUTER_KEY, source: 'env:NINEROUTER_KEY' }; return _keyCache; }
  if (cfg.apiKey) { _keyCache = { key: cfg.apiKey, source: 'config' }; return _keyCache; }
  const routerKey = readRouterKey();
  if (routerKey) {
    try { saveConfig({ apiKey: routerKey }); } catch { /* بی‌اهمیت */ }
    _keyCache = { key: routerKey, source: '9router-db' };
    return _keyCache;
  }
  if (process.env.OPENROUTER_API_KEY) { _keyCache = { key: process.env.OPENROUTER_API_KEY, source: 'env:OPENROUTER_API_KEY' }; return _keyCache; }
  _keyCache = { key: '', source: 'none' };
  return _keyCache;
}

// ---------- پارس مقاوم پاسخ ----------
export function extractCompletion(raw) {
  const t = String(raw || '');
  if (!t.trim()) return { error: 'پاسخ خالی از درگاه' };

  // ۱) JSON خالص
  try { return JSON.parse(t); } catch { /* ادامه */ }

  // ۲) JSON + دنبالهٔ SSE («data: [DONE]»)
  const m = t.match(/^([\s\S]*?})\s*data:/);
  if (m) { try { return JSON.parse(m[1]); } catch { /* ادامه */ } }

  // ۳) جریان SSE: تجمیع دلتاها
  const rows = [...t.matchAll(/^data:\s*(\{[\s\S]*?\})\s*$/gm)]
    .map(x => { try { return JSON.parse(x[1]); } catch { return null; } })
    .filter(Boolean);
  if (rows.length) {
    const full = rows.find(d => d.choices && d.choices[0] && d.choices[0].message && (d.choices[0].message.content || d.choices[0].message.tool_calls));
    if (full) return full;
    const content = rows.map(d => (d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content) || '').join('');
    if (content) return { choices: [{ message: { role: 'assistant', content } }] };
  }
  return { error: 'پاسخ درگاه قابل تفسیر نبود', raw: t.slice(0, 300) };
}

function messageOf(json) {
  if (!json) return { text: '', error: 'پاسخ نامعتبر' };
  if (json.error) {
    const e = json.error;
    return { text: '', error: typeof e === 'string' ? e : (e.message || JSON.stringify(e)).slice(0, 300) };
  }
  const ch = json.choices && json.choices[0];
  const msg = ch && (ch.message || ch.delta);
  const text = (msg && (msg.content || '')) || '';
  return { text: String(text), error: null, finish: ch && ch.finish_reason, usage: json.usage || null };
}

// ---------- فراخوانی ----------
function headers(cfg, auth) {
  const h = { 'Content-Type': 'application/json' };
  if (auth.key) h.Authorization = `Bearer ${auth.key}`;
  if (/openrouter/i.test(cfg.baseUrl)) { h['HTTP-Referer'] = 'http://127.0.0.1:3731'; h['X-Title'] = 'Tender Radar'; }
  return h;
}

/**
 * یک درخواست تک‌مدلی.
 * @returns {Promise<{ok:boolean,text:string,model:string,ms:number,status:number,error?:string}>}
 */
export async function chatOnce({ model, messages, cfg, auth, maxTokens, temperature, signal, stream }) {
  const t0 = Date.now();
  const body = {
    model,
    messages,
    temperature: temperature ?? cfg.temperature,
    max_tokens: maxTokens ?? cfg.maxTokens,
  };
  if (stream) body.stream = true;
  try {
    const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(cfg, auth),
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(cfg.timeoutMs),
    });
    const raw = await r.text();
    const json = extractCompletion(raw);
    const { text, error } = messageOf(json);
    if (!r.ok || error || !text) {
      return { ok: false, model, ms: Date.now() - t0, status: r.status, text: '', error: error || `HTTP ${r.status}` };
    }
    return { ok: true, model, ms: Date.now() - t0, status: r.status, text };
  } catch (e) {
    const aborted = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, model, ms: Date.now() - t0, status: 0, text: '', error: aborted ? 'اتمام مهلت درگاه هوش مصنوعی' : String(e && e.message || e) };
  }
}

/**
 * فراخوانی با زنجیرهٔ مدل جایگزین.
 * @param {{messages:Array, models?:string[], maxTokens?:number, temperature?:number, timeoutMs?:number}} opts
 */
export async function chat(opts) {
  const cfg = loadConfig();
  if (!cfg.enabled) return { ok: false, error: 'دستیار هوشمند خاموش است', tried: [] };
  const auth = resolveAuth();
  const models = (opts.models && opts.models.length ? opts.models : cfg.models)
    .slice()
    .sort((a, b) => (a === cfg.lastGoodModel ? -1 : b === cfg.lastGoodModel ? 1 : 0));
  const local = { ...cfg, timeoutMs: opts.timeoutMs || cfg.timeoutMs };
  const tried = [];
  const deadline = Date.now() + (opts.budgetMs || 150000);

  for (const model of models) {
    if (Date.now() > deadline) { tried.push({ model, error: 'بودجهٔ زمانی تمام شد' }); break; }
    const r = await chatOnce({ model, messages: opts.messages, cfg: local, auth, maxTokens: opts.maxTokens, temperature: opts.temperature, signal: opts.signal });
    tried.push({ model, ok: r.ok, ms: r.ms, error: r.error });
    if (r.ok) {
      if (cfg.lastGoodModel !== model) { try { saveConfig({ lastGoodModel: model }); } catch { /* بی‌اهمیت */ } }
      return { ...r, tried };
    }
  }
  return { ok: false, error: 'هیچ مدلی پاسخ نداد', tried, text: '' };
}

/**
 * استریم: متن را تکه‌تکه به onDelta می‌دهد. اگر استریم ممکن نبود،
 * به حالت غیراستریم عقب‌نشینی می‌کند و یک‌جا می‌فرستد.
 */
export async function chatStream(opts) {
  const cfg = loadConfig();
  if (!cfg.enabled) return { ok: false, error: 'دستیار هوشمند خاموش است', tried: [] };
  const auth = resolveAuth();
  const models = (opts.models && opts.models.length ? opts.models : cfg.models)
    .slice()
    .sort((a, b) => (a === cfg.lastGoodModel ? -1 : b === cfg.lastGoodModel ? 1 : 0));
  const tried = [];
  const budget = opts.budgetMs || 150000;
  const deadline = Date.now() + budget;

  for (const model of models) {
    if (Date.now() > deadline) { tried.push({ model, error: 'بودجهٔ زمانی تمام شد' }); break; }
    const t0 = Date.now();
    let acc = '';
    let ok = false;
    let err = null;
    try {
      const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: headers(cfg, auth),
        body: JSON.stringify({
          model, messages: opts.messages, stream: true,
          temperature: opts.temperature ?? cfg.temperature,
          max_tokens: opts.maxTokens ?? cfg.maxTokens,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs || cfg.timeoutMs),
      });
      if (!r.ok || !r.body) {
        const raw = await r.text().catch(() => '');
        const json = extractCompletion(raw);
        err = messageOf(json).error || `HTTP ${r.status}`;
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder('utf-8');
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n');
          buf = parts.pop();
          for (const line of parts) {
            const s = line.trim();
            if (!s || !s.startsWith('data:')) continue;
            const payload = s.slice(5).trim();
            if (payload === '[DONE]') continue;
            let j = null;
            try { j = JSON.parse(payload); } catch { continue; }
            if (j.error) { err = (j.error.message || JSON.stringify(j.error)).slice(0, 200); continue; }
            const d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message);
            const piece = d && d.content;
            if (piece) { acc += piece; ok = true; if (opts.onDelta) opts.onDelta(piece); }
          }
        }
      }
    } catch (e) {
      err = (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) ? 'اتمام مهلت درگاه هوش مصنوعی' : String(e && e.message || e);
    }

    tried.push({ model, ok, ms: Date.now() - t0, error: err || undefined });
    if (ok && acc.trim()) {
      if (cfg.lastGoodModel !== model) { try { saveConfig({ lastGoodModel: model }); } catch { /* بی‌اهمیت */ } }
      return { ok: true, text: acc, model, ms: Date.now() - t0, tried, streamed: true };
    }

    // عقب‌نشینی: درخواست غیراستریم
    const r2 = await chatOnce({ model, messages: opts.messages, cfg, auth, maxTokens: opts.maxTokens, temperature: opts.temperature });
    tried.push({ model: model + ' (non-stream)', ok: r2.ok, ms: r2.ms, error: r2.error });
    if (r2.ok && r2.text.trim()) {
      if (opts.onDelta) {
        // ارسال تکه‌ای برای تجربهٔ یکنواخت رابط
        const chunks = r2.text.match(/[\s\S]{1,40}/g) || [];
        for (const c of chunks) { opts.onDelta(c); await new Promise(r => setTimeout(r, 8)); }
      }
      if (cfg.lastGoodModel !== model) { try { saveConfig({ lastGoodModel: model }); } catch { /* بی‌اهمیت */ } }
      return { ok: true, text: r2.text, model, ms: r2.ms, tried, streamed: false };
    }
  }
  return { ok: false, error: 'هیچ مدلی پاسخ نداد', tried, text: '' };
}

// ---------- سلامت ----------
let _healthCache = null;
let _healthAt = 0;

/** آزمون زنجیرهٔ مدل‌ها (نتیجه ۵ دقیقه کش می‌شود) */
export async function health(force = false) {
  if (!force && _healthCache && Date.now() - _healthAt < 300000) return _healthCache;
  const cfg = loadConfig();
  const auth = resolveAuth();
  const result = {
    enabled: !!cfg.enabled,
    baseUrl: cfg.baseUrl,
    keySource: auth.source,
    hasKey: !!auth.key,
    models: cfg.models,
    lastGoodModel: cfg.lastGoodModel,
    working: [],
    failed: [],
    reachable: false,
    checkedAt: new Date().toISOString(),
  };
  if (!cfg.enabled) { _healthCache = result; _healthAt = Date.now(); return result; }

  const probe = { messages: [{ role: 'user', content: 'بگو: سلام' }], maxTokens: 16, temperature: 0 };
  const res = await Promise.all(cfg.models.map(async m => {
    const r = await chatOnce({ ...probe, model: m, cfg: { ...cfg, timeoutMs: 40000 }, auth });
    return { model: m, ok: r.ok, ms: r.ms, error: r.error };
  }));
  for (const r of res) (r.ok ? result.working : result.failed).push(r);
  result.reachable = result.working.length > 0;
  _healthCache = result;
  _healthAt = Date.now();
  return result;
}

export function invalidateHealth() { _healthCache = null; _healthAt = 0; }
