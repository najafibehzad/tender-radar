// diag-wp.mjs — بررسی خروجی خام آداپتر وردپرس و اثر فیلتر بازهٔ زمانی
import fs from 'node:fs';
import { fetchWordPress } from '../lib/adapters/wordpress.mjs';

const reg = JSON.parse(fs.readFileSync('data/sources.json', 'utf8'));
const lookback = reg.settings.lookbackDays;
const cutoff = new Date(Date.now() - lookback * 86400000).toISOString().slice(0, 10);
console.log('lookbackDays =', lookback, '| cutoff =', cutoff);

const queries = ['مناقصه', 'مزایده', 'استعلام', 'آسفالت', 'قیر', 'لکه گیری', 'جدول', 'تخریب'];
const ids = process.argv.slice(2);

for (const id of ids) {
  const src = reg.sources.find(s => s.id === id);
  if (!src) { console.log('NOT FOUND', id); continue; }
  const r = await fetchWordPress(src, { queries, timeout: 30000 });
  const dates = r.items.map(i => i.publishedISO).filter(Boolean).sort();
  const kept = r.items.filter(i => !i.publishedISO || i.publishedISO >= cutoff);
  console.log(`\n${id} | ok=${r.ok} | raw=${r.items.length} | kept-after-lookback=${kept.length}`);
  if (dates.length) console.log('   date range:', dates[0], '→', dates[dates.length - 1]);
  console.log('   no-date:', r.items.filter(i => !i.publishedISO).length);
  console.log('   errors:', (r.diagnostics.errors || []).slice(0, 4).join(' | ') || 'none');
  for (const it of kept.slice(0, 4)) console.log('     ✓', (it.publishedISO || 'بیتاریخ'), '|', it.title.slice(0, 62));
  for (const it of r.items.filter(i => i.publishedISO && i.publishedISO < cutoff).slice(0, 3)) {
    console.log('     ✗ (قدیمی)', it.publishedISO, '|', it.title.slice(0, 55));
  }
}
