// tools/probe-tools-raw.mjs — پاسخ خام درخواست دارای ابزار
const BASE = process.env.NINEROUTER_URL || 'http://localhost:20128';
const KEY = process.env.NINEROUTER_KEY || '';
const model = process.argv[2] || 'af/gpt-oss-20b';
const t0 = Date.now();
const r = await fetch(`${BASE}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
  body: JSON.stringify({
    model, temperature: 0.1, max_tokens: 400,
    messages: [
      { role: 'system', content: 'تو دستیار رادار مناقصات هستی. برای پاسخ، ابزار لازم را صدا بزن.' },
      { role: 'user', content: 'آسفالت کرج توی یک هفتهٔ گذشته چی داریم؟' },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'search_tenders', description: 'جست‌وجوی آگهی',
        parameters: { type: 'object', properties: { city: { type: 'string' }, topic: { type: 'string' }, days: { type: 'number' } }, required: ['city'] },
      },
    }],
  }),
  signal: AbortSignal.timeout(120000),
});
const txt = await r.text();
console.log('STATUS', r.status, 'MS', Date.now() - t0, 'CT', r.headers.get('content-type'));
console.log(JSON.stringify(txt.slice(0, 2000)));
