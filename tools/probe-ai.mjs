// tools/probe-ai.mjs — آزمون سریع مدل‌های درگاه هوش مصنوعی (فارسی + فراخوانی ابزار)
const BASE = process.env.NINEROUTER_URL || 'http://localhost:20128';
const KEY = process.env.NINEROUTER_KEY || '';
const models = process.argv.slice(2).length ? process.argv.slice(2)
  : ['bai/gemini-3-flash', 'zai/glm-5.3-flash', 'ds/deepseek-v4.1-flash', 'gc/gemini-2.5-flash', 'cmc/zai-org/GLM-5.2-Fast'];

const body = {
  messages: [
    { role: 'system', content: 'تو دستیار جستجوی مناقصه هستی. فقط JSON برگردان.' },
    { role: 'user', content: 'کاربر گفته: «آسفالت کرج این هفته». شهر، موضوع و بازه زمانی را در JSON بده.' },
  ],
  temperature: 0.1, max_tokens: 300,
  tools: [{
    type: 'function',
    function: {
      name: 'search_tenders', description: 'جستجوی آگهی',
      parameters: { type: 'object', properties: { city: { type: 'string' }, topic: { type: 'string' } }, required: [] },
    },
  }],
  tool_choice: 'auto',
};

for (const m of models) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify({ ...body, model: m }), signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    const msg = j?.choices?.[0]?.message;
    const tools = msg?.tool_calls?.map(t => t.function?.name) || null;
    const txt = String(msg?.content || j?.error?.message || '').replace(/\s+/g, ' ').slice(0, 160);
    console.log(`${m} :: HTTP ${r.status} :: ${Date.now() - t0}ms :: tools=${JSON.stringify(tools)} :: ${txt}`);
  } catch (e) {
    console.log(`${m} :: ERR ${e.message} (${Date.now() - t0}ms)`);
  }
}
