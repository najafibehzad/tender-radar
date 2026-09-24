// test-browser.mjs — آزمون آداپتر مرورگر روی سایت‌های جاوااسکریپتی
import { execFileSync } from 'node:child_process';
import { extractItemsFromHtml } from '../lib/adapters/html.mjs';
import path from 'node:path';

const CH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROF = path.resolve('tools', '_tmp', 'cprofile');

export function dumpDom(url, { budget = 15000, timeout = 90000 } = {}) {
  return execFileSync(CH, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + PROF,
    '--virtual-time-budget=' + budget,
    '--dump-dom', url,
  ], { maxBuffer: 80 * 1024 * 1024, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const urls = process.argv.slice(2);
for (const u of urls) {
  let dom = '';
  try { dom = dumpDom(u); }
  catch (e) { console.log('✗ EXEC FAIL |', u.slice(0, 70), '|', String(e.message).slice(0, 90)); continue; }
  const items = extractItemsFromHtml(dom, u, {});
  console.log(`✓ ${items.length} items | dom=${(dom.length / 1024).toFixed(0)}KB | ${u.slice(0, 70)}`);
  for (const it of items.slice(0, 6)) console.log('     -', it.title.slice(0, 90), '|', it.publishedJalali || '');
}
