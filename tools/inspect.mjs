#!/usr/bin/env node
// inspect.mjs — بررسی ساختار صفحهٔ مناقصه یک سایت
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const TENDER_RE = /(مناقصه|مزایده|استعلام|فراخوان|تجديد|تجدید|آگهی|ارزیابی|قرارداد|پیمانکاری)/;

function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}
function stripTags(h) { return decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')); }

async function get(url, ms = 35000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ac.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fa-IR,fa;q=0.9' } });
    return { status: r.status, body: await r.text(), url: r.url };
  } catch (e) { return { status: 0, body: '', error: String(e.message || e) }; }
  finally { clearTimeout(t); }
}

const target = process.argv[2];
const r = await get(target);
console.log(`URL: ${target}\nstatus=${r.status} len=${r.body.length} ${r.error || ''}\n`);

if (r.status === 200) {
  // meta generator
  const gen = (r.body.match(/name=["']generator["'][^>]*content=["']([^"']+)/i) || [, ''])[1];
  if (gen) console.log('generator:', gen);
  // forms / search endpoints
  const forms = [...r.body.matchAll(/<form[^>]*action=["']([^"']*)["'][^>]*>/gi)].map(m => m[1]).slice(0, 8);
  if (forms.length) console.log('forms:', forms.join(' | '));
  // RSS / sitemap hints
  const feeds = [...r.body.matchAll(/href=["']([^"']*(?:feed|rss|sitemap)[^"']*)["']/gi)].map(m => m[1]).slice(0, 6);
  if (feeds.length) console.log('feeds:', feeds.join(' | '));
  console.log('\n--- anchor texts matching tender keywords ---');
  let n = 0;
  const seen = new Set();
  for (const m of r.body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = m[1];
    const text = stripTags(m[2]);
    if (text.length < 8) continue;
    if (!TENDER_RE.test(text) && !TENDER_RE.test(decodeURIComponent(href))) continue;
    const key = href + '|' + text.slice(0, 50);
    if (seen.has(key)) continue; seen.add(key);
    console.log(`${String(++n).padStart(3)}. [${text.slice(0, 110)}]\n     -> ${href.slice(0, 150)}`);
    if (n >= 25) break;
  }
  if (!n) {
    console.log('(none) — dumping page text sample for keyword context:');
    const txt = stripTags(r.body);
    let idx = txt.search(TENDER_RE);
    console.log(txt.slice(Math.max(0, idx - 200), idx + 800));
  }
}
