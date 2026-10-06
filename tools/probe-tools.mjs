// tools/probe-tools.mjs — آزمون فراخوانی ابزار و کیفیت فارسی روی مدل‌های در دسترس
const BASE = process.env.NINEROUTER_URL || 'http://localhost:20128';
const KEY = process.env.NINEROUTER_KEY || '';
const models = process.argv.slice(2).length ? process.argv.slice(2)
  : ['pt/ling-3.0-flash:free', 'pt/deepseek-v4.1-flash:free', 'kc/nvidia/nemotron-3-super-120b-a12b:free',
    'hfr/zai-org/GLM-4.7-Flash', 'hfr/Qwen/Qwen3-32B', 'af/gpt-oss-20b'];

const TOOLS = [{
  type: 'function',
  function: {
    name: 'search_tenders',
    description: 'جست‌وجوی آگهی مناقصه/مزایده در رادار',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'نام شهر، مثل کرج' },
        topic: { type: 'string', description: 'موضوع، مثل آسفالت' },
        days: { type: 'number', description: 'بازهٔ روز اخیر' },
        kind: { type: 'string', enum: ['مناقصه', 'مزایده', 'استعلام', 'فراخوان'] },
      },
      required: ['city'],
    },
  },
}];

const SYS = 'تو دستیار رادار مناقصات هستی. برای پاسخ به درخواست کاربر ابزار لازم را صدا بزن.';
const USER = 'آسفالت کرج توی یک هفتهٔ گذشته چی داریم؟';

async function probe(m) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify({
        model: m, temperature: 0.1, max_tokens: 400,
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
        tools: TOOLS,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json().catch(() => null);
    const msg = j?.choices?.[0]?.message;
    const tc = msg?.tool_calls;
    return {
      m, status: r.status, ms: Date.now() - t0,
      tools: tc ? tc.map(t => `${t.function?.name}(${String(t.function?.arguments).slice(0, 90)})`).join(' | ') : null,
      content: String(msg?.content || j?.error?.message || '').replace(/\s+/g, ' ').slice(0, 90),
    };
  } catch (e) { return { m, status: 0, ms: Date.now() - t0, tools: null, content: 'ERR ' + e.message }; }
}

const res = [];
const q = [...models];
await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) res.push(await probe(q.shift())); }));
for (const r of res) console.log(`${r.status === 200 ? '✅' : '⚠️ '} ${r.m.padEnd(44)} ${r.status} ${String(r.ms).padStart(6)}ms\n     tools: ${r.tools || '—'}\n     text : ${r.content}`);
