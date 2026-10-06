// tools/probe-free.mjs — جست‌وجوی مدل‌های در دسترسِ درگاه (آزمون موازی، کوتاه)
const BASE = process.env.NINEROUTER_URL || 'http://localhost:20128';
const KEY = process.env.NINEROUTER_KEY || '';

const CANDIDATES = [
  'pt/gpt-5-nano:free', 'pt/gpt-oss-20b:free', 'pt/glm-5.3-flash:free', 'pt/deepseek-v4.1-flash:free',
  'pt/glm-4.7-flash:free', 'pt/ling-3.0-flash:free', 'pt/qwen3.7-flash:free', 'pt/sensenova-6.8-flash-lite:free',
  'pt/nemotron-3.5-lightning:free', 'pt/mimo-v2.6-flash:free', 'pt/nova-micro:free', 'pt/laguna-s-2.1:free',
  'af/gpt-oss-120b', 'af/gpt-oss-20b', 'af/glm-4.7-flash', 'af/llama-instant',
  'cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'cf/@cf/zai-org/glm-4.7-flash', 'cf/@cf/moonshotai/kimi-k2.6',
  'kc/nvidia/nemotron-3-super-120b-a12b:free', 'kc/deepseek/deepseek-v4-flash-0731:free', 'kc/kilo-auto/free',
  'kc/qwen/qwen3.8-27b:free', 'kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'hfr/zai-org/GLM-4.7-Flash', 'hfr/google/gemma-3-27b-it', 'hfr/Qwen/Qwen3-32B', 'hfr/openai/gpt-oss-120b',
  'hfr/meta-llama/Llama-3.3-70B-Instruct', 'hfr/deepseek-ai/DeepSeek-V4-Flash',
  'zai/glm-5.3-flashx', 'zai/glm-4.7', 'cerebras/llama-3.3-70b', 'cerebras/zai-glm-4.7',
  'gemini/gemini-3.5-flash-lite', 'bzl/glm-5', 'bzl/gpt-5.4-nano', 'glm/glm-5.3-flash',
  'bai/glm-5.3-flash', 'bai/qwen3.8-flash', 'bai/mimo-v2.6-flash', 'xkiro/z-ai/glm-4.7-flash',
  'xkiro/anthropic/claude-haiku-4.5', 'llm7/deepseek-v4-flash', 'cmc/stepfun/Step-3.7-Flash',
];

const body = {
  messages: [{ role: 'user', content: 'فقط بنویس: سلام' }],
  temperature: 0, max_tokens: 20,
};

async function probe(m) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify({ ...body, model: m }), signal: AbortSignal.timeout(45000),
    });
    const j = await r.json().catch(() => null);
    const ok = r.ok && j?.choices?.[0]?.message;
    const err = String(j?.error?.message || j?.error || '').replace(/\s+/g, ' ').slice(0, 70);
    return { m, ok: !!ok, ms: Date.now() - t0, status: r.status, note: ok ? String(j.choices[0].message.content || '').slice(0, 30) : err };
  } catch (e) { return { m, ok: false, ms: Date.now() - t0, status: 0, note: e.message }; }
}

const res = [];
const queue = [...CANDIDATES];
const workers = Array.from({ length: 8 }, async () => {
  while (queue.length) { const m = queue.shift(); res.push(await probe(m)); }
});
await Promise.all(workers);
res.sort((a, b) => (b.ok - a.ok) || (a.ms - b.ms));
for (const r of res) console.log(`${r.ok ? '✅' : '  '} ${r.m.padEnd(48)} ${String(r.status).padStart(4)} ${String(r.ms).padStart(6)}ms  ${r.note}`);
console.log('\nWORKING:', res.filter(r => r.ok).map(r => r.m).join(' '));
