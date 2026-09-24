// smoke-test.mjs — آزمون دودی همهٔ نقطه‌های پایانی API
const BASE = process.env.BASE || 'http://127.0.0.1:3731';
let pass = 0, fail = 0;

async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* */ }
  return { status: r.status, json: j };
}
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

console.log('== وضعیت و آیتم‌ها ==');
{
  const s = await call('GET', '/api/status');
  check('GET /api/status', s.json?.ok === true, `items=${s.json?.itemCount} ok=${s.json?.sourcesOk} failed=${s.json?.sourcesFailed}`);
  check('targetOnly در تنظیمات', typeof s.json?.registry?.settings?.targetOnly === 'boolean');
}
{
  const a = await call('GET', '/api/items?limit=5');
  check('GET /api/items', a.json?.ok === true, `total=${a.json?.total}`);
  check('نمای پیش‌فرض فقط تهران/البرز', (a.json?.items || []).every(i => ['تهران', 'البرز', ''].includes(i.province)));
  const b = await call('GET', '/api/items?target=0&limit=1');
  check('خاموش‌کردن فیلتر هدف با target=0', b.json?.ok === true, `total=${b.json?.total}`);
  const c = await call('GET', '/api/items?q=%D8%A2%D8%B3%D9%81%D8%A7%D9%84%D8%AA&limit=1');
  check('جستجو با «آسفالت»', c.json?.ok === true, `total=${c.json?.total}`);
  const d = await call('GET', '/api/items?topic=asphalt&limit=1');
  check('فیلتر موضوع آسفالت', d.json?.ok === true, `total=${d.json?.total}`);
  const e = await call('GET', '/api/items?sort=deadline&hasDeadline=1&limit=3');
  check('فقط دارای مهلت + مرتب بر مهلت', e.json?.ok === true, `total=${e.json?.total}`);
  check('فیلترها کار می‌کنند (facet)', Array.isArray(a.json?.facets?.city) && a.json.facets.city.length > 0);
}
console.log('== برون‌بری ==');
{
  // BOM را باید روی بایت خام سنجید — fetch().text() خودش BOM را حذف می‌کند
  const raw = Buffer.from(await (await fetch(BASE + '/api/export.csv?limit=10')).arrayBuffer());
  check('CSV با BOM (UTF-8)', raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF,
    `bytes: ${raw[0]?.toString(16)} ${raw[1]?.toString(16)} ${raw[2]?.toString(16)}`);
  const t = raw.toString('utf8');
  check('CSV سرستون دارد', t.includes('عنوان') && t.includes('مهلت'), `${t.length} کاراکتر`);
  check('CSV سطر داده دارد', t.split('\r\n').length > 2, `${t.split('\r\n').length - 1} سطر`);
  const js = await fetch(BASE + '/api/export.json?limit=5');
  const jj = await js.json();
  check('JSON export', Array.isArray(jj.items), `${jj.items?.length} آیتم`);
}
console.log('== منابع و موضوعات ==');
{
  const s = await call('GET', '/api/sources');
  check('GET /api/sources', Array.isArray(s.json?.sources), `${s.json?.sources?.length} منبع`);
  const sd = s.json.sources.find(x => x.id === 'setadiran');
  check('منبع ستاد با کد شهر', !!sd && Array.isArray(sd.setadCities) && sd.setadCities.length === 13, `${sd?.setadCities?.length} شهر`);
  check('مسیر HTML پشتیبان ستاد', Array.isArray(sd?.setadHtmlFallback) && sd.setadHtmlFallback.length > 0);
  check('maxItems ستاد', sd?.maxItems === 400, String(sd?.maxItems));
  const t = await call('GET', '/api/topics');
  check('GET /api/topics', Array.isArray(t.json?.topics), `${t.json?.topics?.length} موضوع`);
}
console.log('== اعتبارسنجی تنظیمات ==');
{
  const before = (await call('GET', '/api/status')).json.registry.settings;
  // مقدارهای نابخردانه باید کلمپ شوند، نه ذخیره
  const r1 = await call('POST', '/api/settings', { lookbackDays: 0, maxItemsPerSource: 1, requestTimeoutMs: 100 });
  check('کلمپ lookbackDays=0 → ≥۷', r1.json?.settings?.lookbackDays >= 7, String(r1.json?.settings?.lookbackDays));
  check('کلمپ maxItemsPerSource=1 → ≥۲۰', r1.json?.settings?.maxItemsPerSource >= 20, String(r1.json?.settings?.maxItemsPerSource));
  check('کلمپ requestTimeoutMs=100 → ≥۵۰۰۰', r1.json?.settings?.requestTimeoutMs >= 5000, String(r1.json?.settings?.requestTimeoutMs));
  const r2 = await call('POST', '/api/settings', { lookbackDays: 99999 });
  check('کلمپ سقف lookbackDays → ≤۷۳۰', r2.json?.settings?.lookbackDays <= 730, String(r2.json?.settings?.lookbackDays));
  // بازگرداندن مقدارهای کاربر
  const r3 = await call('POST', '/api/settings', {
    lookbackDays: before.lookbackDays, maxItemsPerSource: before.maxItemsPerSource,
    requestTimeoutMs: before.requestTimeoutMs, scanIntervalMinutes: before.scanIntervalMinutes,
    autoScanOnStart: before.autoScanOnStart, targetOnly: before.targetOnly,
  });
  check('بازگردانی تنظیمات کاربر', r3.json?.settings?.lookbackDays === before.lookbackDays,
    `lookback=${r3.json?.settings?.lookbackDays} max=${r3.json?.settings?.maxItemsPerSource}`);
}
console.log('== تشخیص ==');
{
  const h = await call('GET', '/api/health');
  check('GET /api/health', h.json?.ok === true);
  const st = await call('GET', '/api/scan/status');
  check('GET /api/scan/status', st.json?.ok === true, `running=${st.json?.running}`);
}
console.log(`\nنتیجه: ${pass} موفق · ${fail} ناموفق`);
process.exit(fail ? 1 : 0);
