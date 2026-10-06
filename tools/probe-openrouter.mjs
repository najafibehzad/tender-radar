// tools/probe-openrouter.mjs — آزمون OpenRouter برای فارسی + فراخوانی ابزار
const KEY = process.env.OPENROUTER_API_KEY;
const models = process.argv.slice(2).length ? process.argv.slice(2)
  : ['google/gemini-2.5-flash', 'deepseek/deepseek-chat-v3.1:free', 'z-ai/glm-4.6'];

const body = {
  messages: [
    { role: 'system', content: 'تو دستیار جستجوی مناقصه هستی.' },
    { role: 'user', content: 'کاربر گفته: «آسفالت کرج این هفته». ابزار جستجو را با پارامترهای درست صدا بزن.' },
  ],
  temperature: 0.1, max_tokens: 300,
  tools: [{
    type: 'function',
    function: {
      name: 'search_tenders', description: 'جستجوی آگهی مناقصه',
      parameters: { type: 'object', properties: { city: { type: 'string' }, topic: { type: 'string' }, days: { type: 'number' } }, required: [] },
    },
  }],
};

for (const m of models) {
  const t0 = Date.now();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'HTTP-Referer': 'http://127.0.0.1:3731', 'X-Title': 'Tender Radar' },
      body: JSON.stringify({ ...body, model: m }), signal: AbortSignal.timeout(90000),
    });
    const j = await r.json();
    const msg = j?.choices?.[0]?.message;
    const tools = msg?.tool_calls?.map(t => t.function?.name + '(' + t.function?.arguments + ')') || null;
    const txt = String(msg?.content || j?.error?.message || '').replace(/\s+/g, ' ').slice(0, 120);
    console.log(`${m} :: HTTP ${r.status} :: ${Date.now() - t0}ms :: ${JSON.stringify(tools)} :: ${txt}`);
  } catch (e) {
    console.log(`${m} :: ERR ${e.message} (${Date.now() - t0}ms)`);
  }
}
