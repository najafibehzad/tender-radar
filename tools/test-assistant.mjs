// tools/test-assistant.mjs — آزمون سرتاسری هستهٔ دستیار (بدون سرور)
import { loadRegistry, loadCache, saveRegistry } from '../lib/store.mjs';
import { detectSource } from '../lib/detect.mjs';
import { runAssistant } from '../lib/assistant.mjs';

const noAi = process.argv.includes('--no-ai');
const fresh = process.argv.includes('--fresh');
const queries = process.argv.slice(2).filter(a => !a.startsWith('--'));

const ctx = {
  registry: loadRegistry(),
  cache: loadCache(),
  reloadRegistry: () => loadRegistry(),
  reloadCache: () => loadCache(),
  saveRegistry: r => saveRegistry(r),
  detectSource,
  runScan: async () => ({ ok: true, total: 0, sourcesOk: 0, sourcesFailed: 0, durationMs: 0, scannedNow: 0 }),
  scheduleInterval: () => {},
  isScanning: () => false,
};

const list = queries.length ? queries : [
  'آسفالت کرج این هفته',
  'جدول‌گذاری فردیس',
  'منابع چه ایرادی دارن؟',
];

for (const text of list) {
  console.log('\n' + '█'.repeat(90));
  console.log('❓', text, noAi ? '(بدون مدل زبانی)' : '');
  console.log('█'.repeat(90));
  const t0 = Date.now();
  const r = await runAssistant({
    text,
    opts: { fresh, noAi },
    ctx,
    emit: ev => {
      if (ev.type === 'step') console.log(`   [${ev.status === 'run' ? '…' : ev.status === 'done' ? '✓' : '✗'}] ${ev.label}${ev.detail ? ' — ' + ev.detail : ''}`);
      else if (ev.type === 'intent') console.log('   قصد:', ev.summary.map(s => `${s.k}=${s.v}`).join(' | '));
      else if (ev.type === 'results') console.log(`   نتایج: ${ev.total}`);
      else if (ev.type === 'actions') console.log('   اقدام‌ها:', ev.actions.map(a => a.label).join(' · '));
      else if (ev.type === 'delta') process.stdout.write(ev.text);
    },
  });
  console.log('\n--- پاسخ نهایی ---');
  console.log(r.answer);
  console.log(`\n--- meta: ${JSON.stringify({ aiUsed: r.meta.aiUsed, model: r.meta.model, ms: r.meta.ms, results: r.meta.results, shown: r.meta.shown, cacheAge: r.meta.cacheAgeMinutes })} ---`);
}
