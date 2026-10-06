// tools/probe-raw.mjs — نمایش پاسخ خام یک مدل
const BASE = process.env.NINEROUTER_URL || 'http://localhost:20128';
const KEY = process.env.NINEROUTER_KEY || '';
const model = process.argv[2] || 'hfr/meta-llama/Llama-3.3-70B-Instruct';
const t0 = Date.now();
const r = await fetch(`${BASE}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'سلام، خودت را در یک جمله معرفی کن.' }], temperature: 0, max_tokens: 100 }),
  signal: AbortSignal.timeout(120000),
});
const txt = await r.text();
console.log('STATUS', r.status, 'MS', Date.now() - t0);
console.log(txt.slice(0, 1500));
