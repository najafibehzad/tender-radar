// tools/test-search.mjs — آزمون موتور تحلیل درخواست و جستجو
import { loadRegistry, loadCache } from '../lib/store.mjs';
import { parseQuery, searchItems, intentSummary, analyze } from '../lib/search.mjs';
import { faNum } from '../lib/text.mjs';

const reg = loadRegistry();
const cache = loadCache();
const items = cache.items || [];

const queries = process.argv.slice(2).length ? process.argv.slice(2) : [
  'آسفالت کرج',
  'مناقصه جدول‌گذاری فردیس این هفته',
  'asphalt karaj',
  'لکه گیری معابر شهریار',
  'مزایده',
  'پروژه‌های مهلت‌دار فوری تهران',
  'اسفالت',
  'خرید لوله پلی اتیلن',
  'آگهی‌های فضای سبز مهر',
  'چند تا آگهی تخریب و بازسازی داریم؟',
  'منابع ایراد دارن؟',
  'قیرپاشی ملارد',
];

for (const q of queries) {
  const t0 = Date.now();
  const intent = parseQuery(q, reg);
  const res = searchItems(items, intent, { limit: 5 });
  console.log('\n' + '─'.repeat(100));
  console.log(`❓ ${q}`);
  console.log(`   قصد: ${intentSummary(intent).map(s => `${s.k} = ${s.v}`).join(' | ') || '—'}${intent.kinds.length ? ' | نوع=' + intent.kinds.join(',') : ''}${intent.days ? ` | روز=${intent.days}` : ''}${intent.dateFrom ? ` | از=${intent.dateFrom}` : ''}${intent.dateTo ? ` | تا=${intent.dateTo}` : ''}`);
  console.log(`   واژه‌ها: [${intent.freeTerms.join(', ')}]  بسط‌یافته: ${intent.expanded.length}  گروه‌ها: [${intent.synonymGroups.join(',')}]`);
  console.log(`   نیّت: تحلیل=${intent.wantsAnalysis ? '✓' : '—'} تازه‌سازی=${intent.wantsFresh ? '✓' : '—'} رفع‌ایراد=${intent.wantsRepair ? '✓' : '—'}`);
  console.log(`   نتیجه: ${faNum(res.total)} از ${faNum(items.length)} (حذف‌شده: ${JSON.stringify(res.dropped)}) در ${Date.now() - t0}ms`);
  for (const it of res.items.slice(0, 4)) {
    console.log(`   • [${it._score}] ${it.title.slice(0, 70)}  ⟵ ${it.city || '—'}/${it.province || '—'} | ${it.kind} | ${it.publishedJalali || it.publishedISO || '—'} | ${it.deadlineJalali || '—'}`);
    if (it._reasons.length) console.log(`        دلیل: ${it._reasons.join(' · ')}`);
  }
}

// آزمون تحلیل
const intent = parseQuery('آسفالت کرج', reg);
const res = searchItems(items, intent, { limit: 60 });
const a = analyze(res.all);
console.log('\n' + '═'.repeat(100));
console.log('تحلیل «آسفالت کرج»:', JSON.stringify({ total: a.total, byCity: a.byCity.slice(0, 4), byKind: a.byKind, urgent: a.urgent.length, withDeadline: a.withDeadline }));
