#!/usr/bin/env node
// probe-paths.mjs — یافتن مسیر آگهی‌های مناقصه در یک سایت
import { fetchText } from '../lib/fetcher.mjs';
import { extractItemsFromHtml, absolutize } from '../lib/adapters/html.mjs';
import { discoverFromSitemap } from '../lib/adapters/sitemap.mjs';

const PATHS = [
  '/', '/مناقصه', '/مناقصات', '/مزایده', '/مزایدات', '/استعلام',
  '/?s=مناقصه', '/?s=مزایده', '/search?q=مناقصه',
  '/category/مناقصه', '/category/مناقصات', '/category/مناقصه-و-مزایده', '/category/tender',
  '/news/مناقصه', '/اخبار/مناقصه', '/آرشیو/مناقصه',
  '/مناقصه-و-مزایده', '/مناقصات-و-مزایدات', '/اعلانات/مناقصه',
  '/fa-IR/DouranPortal/5223/page/مناقصات-و-مزایدات',
  '/s/mfasuZ',
];

const targets = process.argv.slice(2);
for (const base0 of targets) {
  const base = base0.replace(/\/+$/, '');
  console.log(`\n########## ${base}`);
  const found = [];
  for (const p of PATHS) {
    const url = p === '/' ? base + '/' : base + p;
    const r = await fetchText(encodeURI(url), { timeout: 18000, retries: 0 });
    if (!r.ok) { continue; }
    const items = extractItemsFromHtml(r.body, r.url || url, {});
    if (items.length) {
      found.push({ url, count: items.length, sample: items.slice(0, 3).map(i => i.title.slice(0, 70)) });
      console.log(`  ✓ ${String(items.length).padStart(3)} | ${url}`);
      for (const s of found[found.length - 1].sample) console.log(`        - ${s}`);
    }
  }
  if (!found.length) {
    const sm = await discoverFromSitemap(base, { timeout: 20000 });
    console.log('  sitemap:', sm.ok ? `${sm.allCount} نشانی، ${sm.tenderCount} مناقصه‌ای` : sm.error);
    if (sm.ok && sm.tenderCount) console.log('   نمونه:', sm.urls.slice(0, 4).join('\n          '));
    else console.log('  ✗ مسیر آگهی پیدا نشد (احتمالاً محتوا با جاوااسکریپت بارگذاری می‌شود)');
  }
}
