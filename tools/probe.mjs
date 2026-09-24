#!/usr/bin/env node
// probe.mjs — بررسی دسترسی و نوع سامانهٔ سایت‌های شهرداری/دهیاری
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const candidates = JSON.parse(fs.readFileSync(process.argv[2] || 'candidates.json', 'utf8'));

async function head(url, ms = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'fa,en;q=0.8' },
    });
    const body = await r.text();
    return { status: r.status, finalUrl: r.url, body };
  } catch (e) {
    return { status: 0, error: String(e.message || e), body: '' };
  } finally { clearTimeout(t); }
}

async function probe(c) {
  const out = { key: c.key, name: c.name, province: c.province, type: c.type, candidates: [] };
  for (const url of c.urls) {
    const base = url.replace(/\/+$/, '');
    const res = { url: base };
    const home = await head(base + '/');
    res.status = home.status;
    if (home.error) res.error = home.error;
    if (home.status === 200) {
      res.finalUrl = home.finalUrl;
      res.title = (home.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim().slice(0, 90);
      res.len = home.body.length;
      res.generator = (home.body.match(/name=["']generator["'][^>]*content=["']([^"']+)/i) || [, ''])[1];
      // WordPress REST API?
      const wp = await head(base + '/wp-json/wp/v2/posts?per_page=1');
      if (wp.status === 200 && /^\s*\[/.test(wp.body)) {
        res.api = 'wp-json';
        try { const j = JSON.parse(wp.body); res.wpTotal = j.length; } catch {}
        const s = await head(base + '/wp-json/wp/v2/posts?search=' + encodeURIComponent('مناقصه') + '&per_page=5');
        if (s.status === 200) { try { res.wpSearchHits = JSON.parse(s.body).length; } catch {} }
      } else if (wp.status === 200) {
        res.api = 'wp-json-odd';
      } else {
        // generic search endpoint detection
        res.api = 'html';
      }
    }
    out.candidates.push(res);
    if (res.status === 200) break; // first working URL wins
  }
  return out;
}

const results = [];
const CONC = 6;
let i = 0;
async function worker() {
  while (i < candidates.length) {
    const c = candidates[i++];
    const r = await probe(c);
    results.push(r);
    const best = r.candidates[r.candidates.length - 1];
    console.log(`${r.name.padEnd(18)} | ${r.province.padEnd(8)} | ${String(best.status).padEnd(3)} | ${String(best.api || '-').padEnd(12)} | ${best.title || best.error || ''} ${best.wpSearchHits !== undefined ? '| مناقصه-hits=' + best.wpSearchHits : ''}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
fs.writeFileSync('probe-results.json', JSON.stringify(results, null, 2));
console.log('\nSaved probe-results.json');
