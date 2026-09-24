// lib/store.mjs — مدیریت رجیستری منابع و حافظهٔ نتایج
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TOPICS, todayTehran } from './text.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, 'data');

export const PATHS = {
  data: DATA,
  sources: path.join(DATA, 'sources.json'),
  cache: path.join(DATA, 'cache.json'),
  history: path.join(DATA, 'history.json'),
  log: path.join(DATA, 'scan-log.json'),
};

function ensureDir() { if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true }); }

export function readJson(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}
export function writeJson(p, obj) {
  ensureDir();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

const DEFAULT_REGISTRY = {
  version: 1,
  updatedAt: new Date().toISOString(),
  settings: {
    scanIntervalMinutes: 0,
    requestTimeoutMs: 30000,
    maxItemsPerSource: 300,
    lookbackDays: 120,
    autoScanOnStart: false,
  },
  topics: DEFAULT_TOPICS,
  sources: [],
};

export function loadRegistry() {
  const r = readJson(PATHS.sources, null);
  if (!r || !Array.isArray(r.sources)) {
    ensureDir();
    writeJson(PATHS.sources, DEFAULT_REGISTRY);
    return structuredClone(DEFAULT_REGISTRY);
  }
  if (!r.topics || !r.topics.length) r.topics = DEFAULT_TOPICS;
  if (!r.settings) r.settings = structuredClone(DEFAULT_REGISTRY.settings);
  return r;
}

export function saveRegistry(reg) {
  reg.updatedAt = new Date().toISOString();
  writeJson(PATHS.sources, reg);
  return reg;
}

export function loadCache() {
  return readJson(PATHS.cache, { scannedAt: null, items: [], sources: [], stats: null });
}
export function saveCache(c) { writeJson(PATHS.cache, c); }

function countBy(arr, fn) {
  const m = {};
  for (const x of arr) { const k = fn(x) || 'نامشخص'; m[k] = (m[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

/** محاسبهٔ آمار از فهرست آیتم‌ها */
export function computeStats(items) {
  const today = todayTehran().iso;
  return {
    total: items.length,
    byKind: countBy(items, i => i.kind),
    byProvince: countBy(items, i => i.province || 'نامشخص'),
    byCity: countBy(items, i => i.city || 'نامشخص'),
    byTopic: countBy(items.flatMap(i => (i.topics && i.topics.length) ? i.topics : ['بدون موضوع']), x => x),
    withDeadline: items.filter(i => i.deadlineISO).length,
    urgent: items.filter(i => i.daysLeft != null && i.daysLeft >= 0 && i.daysLeft <= 3).length,
    today: items.filter(i => i.publishedISO === today).length,
  };
}

/**
 * ذخیرهٔ نتیجهٔ اسکن.
 * اسکن جزئی (`onlySourceIds`) بقیهٔ منابع را از حافظه پاک نمی‌کند — فقط همان منابع را جایگزین می‌کند.
 */
export function saveScanResult(res, onlySourceIds) {
  const full = !onlySourceIds || !onlySourceIds.length;
  if (full) {
    const cache = {
      scannedAt: res.scannedAt, items: res.items, sources: res.sources, stats: res.stats,
      durationMs: res.durationMs, sourcesOk: res.sourcesOk, sourcesFailed: res.sourcesFailed,
      sourcesTotal: res.sourcesTotal,
    };
    writeJson(PATHS.cache, cache);
    return cache;
  }

  const prev = loadCache();
  const set = new Set(onlySourceIds);
  const items = [
    ...(prev.items || []).filter(it => !set.has(it.sourceId)),
    ...(res.items || []),
  ].sort((a, b) => String(b.publishedISO || '').localeCompare(String(a.publishedISO || '')));
  const sources = [
    ...(prev.sources || []).filter(s => !set.has(s.id)),
    ...(res.sources || []),
  ];
  const cache = {
    scannedAt: new Date().toISOString(),
    items, sources, stats: computeStats(items),
    durationMs: res.durationMs,
    sourcesOk: sources.filter(s => s.ok).length,
    sourcesFailed: sources.filter(s => !s.ok).length,
    sourcesTotal: sources.length,
    partial: true, lastPartialIds: onlySourceIds,
  };
  writeJson(PATHS.cache, cache);
  return cache;
}

export function loadLog() { return readJson(PATHS.log, []); }
export function appendLog(entry) {
  const log = loadLog();
  log.unshift(entry);
  writeJson(PATHS.log, log.slice(0, 200));
}

/** شناسهٔ امن از نام/شهر */
export function slugId(s) {
  const base = String(s || '').trim().toLowerCase()
    .replace(/[\s\u200c]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .slice(0, 40);
  return base || 'source-' + Math.random().toString(36).slice(2, 8);
}

export function uniqueId(reg, wanted) {
  let id = slugId(wanted);
  let n = 2;
  while (reg.sources.some(s => s.id === id)) { id = `${slugId(wanted)}-${n++}`; }
  return id;
}

export function findSource(reg, id) { return reg.sources.find(s => s.id === id); }
