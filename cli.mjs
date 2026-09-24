#!/usr/bin/env node
// cli.mjs — ابزار خط فرمان رادار مناقصات
import { loadRegistry, saveRegistry, loadCache, saveScanResult, appendLog, uniqueId } from './lib/store.mjs';
import { scanAll } from './lib/scanner.mjs';
import { detectSource, normalizeUrl } from './lib/detect.mjs';
import { faNum } from './lib/text.mjs';

const cmd = process.argv[2] || 'help';
const args = process.argv.slice(3);

const flag = (name, def = null) => {
  const i = args.indexOf('--' + name);
  return i > -1 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
};

if (cmd === 'scan') {
  const reg = loadRegistry();
  const only = flag('only');
  const json = args.includes('--json');
  console.log(`اسکن ${reg.sources.filter(s => !s._disabled).length} منبع ...`);
  const res = await scanAll(reg, {
    onlySourceIds: only ? String(only).split(',') : null,
    onProgress: p => { if (!json) process.stderr.write(`  [${p.done}/${p.total}] ${p.source} → ${p.count} آیتم ${p.ok ? '' : '(خطا)'}\n`); },
  });
  saveScanResult(res, only ? String(only).split(',') : null);
  appendLog({ at: res.scannedAt, total: res.stats.total, ok: res.sourcesOk, failed: res.sourcesFailed, ms: res.durationMs });
  if (json) {
    console.log(JSON.stringify({ ok: true, scannedAt: res.scannedAt, total: res.stats.total, sourcesOk: res.sourcesOk, sourcesFailed: res.sourcesFailed, stats: res.stats }, null, 2));
  } else {
    console.log(`\n✅ ${faNum(res.stats.total)} آگهی از ${faNum(res.sourcesOk)} منبع سالم (${faNum(res.sourcesFailed)} خطا) در ${(res.durationMs / 1000).toFixed(1)} ثانیه`);
    console.log('\nمنابع:');
    for (const s of res.sources) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name.padEnd(34)} ${String(s.count).padStart(4)}  ${s.ok ? '' : (s.error || '').slice(0, 70)}`);
    console.log('\nموضوعات برتر:');
    for (const [k, v] of Object.entries(res.stats.byTopic).slice(0, 10)) console.log(`  ${k.padEnd(24)} ${v}`);
    console.log('\nشهرها:');
    for (const [k, v] of Object.entries(res.stats.byCity).slice(0, 12)) console.log(`  ${k.padEnd(24)} ${v}`);
  }
  process.exit(0);
}

if (cmd === 'setad-test') {
  const { diagnoseSetadiran } = await import('./lib/adapters/setadiran.mjs');
  const reg = loadRegistry();
  const src = reg.sources.find(s => s.id === 'setadiran') || null;
  console.log('در حال بررسی گام‌به‌گام سامانهٔ ستاد ایران ...\n');
  const r = await diagnoseSetadiran({ timeout: 30000, src });
  for (const s of r.steps) {
    console.log(`${s.ok === false ? '✗' : '✓'} ${s.step}`);
    for (const [k, v] of Object.entries(s)) {
      if (k === 'step' || k === 'ok' || v == null) continue;
      console.log(`     ${k}: ${Array.isArray(v) ? v.join(' · ') : v}`);
    }
  }
  console.log('\nنتیجه:', r.ok ? '✅ ستاد سالم است' : '❌ ستاد در دسترس نیست');
  if (r.hint) console.log('راهنما:', r.hint);
  process.exit(r.ok ? 0 : 1);
}

if (cmd === 'didehban-test') {
  const { diagnoseDidehban } = await import('./lib/adapters/didehban.mjs');
  const reg = loadRegistry();
  const src = reg.sources.find(s => s.adapter === 'didehban') || { didehbanUrl: 'http://127.0.0.1:3725' };
  console.log('در حال بررسی وب‌اپ دیده‌بان ...\n');
  const r = await diagnoseDidehban({ timeout: 15000, src });
  for (const s of r.steps) {
    console.log(`${s.ok === false ? '✗' : '✓'} ${s.step}`);
    for (const [k, v] of Object.entries(s)) {
      if (k === 'step' || k === 'ok' || v == null) continue;
      console.log(`     ${k}: ${Array.isArray(v) ? v.join(' · ') : v}`);
    }
  }
  console.log('\nنتیجه:', r.ok ? '✅ دیده‌بان سالم است' : '❌ دیده‌بان در دسترس نیست');
  process.exit(r.ok ? 0 : 1);
}

if (cmd === 'detect') {
  const url = args.find(a => !a.startsWith('--'));
  if (!url) { console.error('نشانی لازم است: node cli.mjs detect <url>'); process.exit(1); }
  const r = await detectSource(url);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

if (cmd === 'list') {
  const reg = loadRegistry();
  for (const s of reg.sources) {
    console.log(`${s._disabled ? '○' : '●'} ${s.id.padEnd(16)} ${s.name.padEnd(34)} ${s.province.padEnd(8)} ${s.adapter.padEnd(10)} ${s.url}`);
  }
  process.exit(0);
}

console.log(`رادار مناقصات — ابزار خط فرمان

دستورها:
  node cli.mjs scan [--json] [--only id1,id2]   اسکن همهٔ منابع
  node cli.mjs detect <url>                     شناسایی نوع سامانهٔ یک سایت
  node cli.mjs setad-test                       بررسی گام‌به‌گام اتصال به ستاد ایران
  node cli.mjs didehban-test                    بررسی وب‌اپ دیده‌بان (localhost:3725)
  node cli.mjs list                             فهرست منابع
`);
