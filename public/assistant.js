/* رادار مناقصات — دستیار هوشمند (رابط کاربری) */
'use strict';

(function () {
  const $ = s => document.querySelector(s);
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = v => String(v ?? '').replace(/\d/g, d => FA[+d]);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SUGGESTIONS = [
    'آسفالت کرج این هفته',
    'جدول‌گذاری فردیس',
    'مناقصه‌های مهلت‌دار فوری تهران',
    'لکه‌گیری و روکش شهریار',
    'تحلیل آگهی‌های یک ماه اخیر',
    'منابع چه ایرادی دارند؟',
    'فضای سبز و پارک',
    'مزایده‌های امروز',
    'راهنما و توانایی‌ها',
  ];

  const state = {
    open: false,
    busy: false,
    messages: [],   // {role:'user'|'ai', text, steps:[], results, actions, meta}
    abort: null,
  };

  // ---------- ابزار ----------
  function toast(msg, type = '') {
    const host = $('#toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 4200);
  }

  function fmtTime(d) { try { return fa(new Date(d).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })); } catch { return ''; } }

  /** رندر سادهٔ مارک‌داون: پررنگ، فهرست، ایتالیک، نشانی خودکار */
  function md(text) {
    const lines = esc(text).split('\n');
    const out = [];
    let inList = false;
    const inline = s => s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>')
      .replace(/(https?:\/\/[^\s<)]+)/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    for (const raw of lines) {
      const l = raw.trimEnd();
      const li = l.match(/^\s*[-•]\s+(.*)$/);
      if (li) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li>${inline(li[1])}</li>`);
        continue;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (!l.trim()) { out.push(''); continue; }
      out.push(`<p>${inline(l)}</p>`);
    }
    if (inList) out.push('</ul>');
    return out.join('');
  }

  function kindBadge(k) {
    const cls = { 'مناقصه': 'b-managhese', 'مزایده': 'b-mazayede', 'استعلام': 'b-estelam', 'فراخوان': 'b-farakhvan' }[k] || 'b-other';
    return `<span class="badge ${cls}">${esc(k || 'سایر')}</span>`;
  }

  function deadlineBadge(it) {
    const d = it.daysLeft;
    if (it.deadline == null || it.deadline === '') return '<span class="muted">بدون مهلت</span>';
    const txt = esc(it.deadline);
    if (d == null) return `<span class="mono">${txt}</span>`;
    if (d < 0) return `<span class="badge b-other mono">${txt}</span>`;
    if (d === 0) return `<span class="badge b-deadline mono">${txt} · امروز</span>`;
    if (d <= 3) return `<span class="badge b-deadline mono">${txt} · ${fa(d)} روز</span>`;
    if (d <= 7) return `<span class="badge b-soon mono">${txt} · ${fa(d)} روز</span>`;
    return `<span class="mono">${txt} · ${fa(d)} روز</span>`;
  }

  function renderResults(items) {
    if (!items || !items.length) return '';
    return `<div class="ai-results">${items.map(it => `
      <div class="ai-card">
        <div class="ai-card-top">
          <a class="ai-card-title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
          <span class="ai-score" title="${esc((it.reasons || []).join(' · '))}">${fa(Math.round(it.score || 0))}</span>
        </div>
        <div class="ai-card-meta">
          ${kindBadge(it.kind)}
          ${it.city ? `<span class="badge b-topic">${esc(it.city)}</span>` : ''}
          ${it.org ? `<span class="muted">${esc(String(it.org).slice(0, 46))}</span>` : ''}
        </div>
        <div class="ai-card-foot">
          <span class="muted">انتشار: ${esc(it.published || '—')}</span>
          <span class="spacer"></span>
          ${deadlineBadge(it)}
        </div>
        ${it.reasons && it.reasons.length ? `<div class="ai-card-why">چرا: ${esc(it.reasons.slice(0, 3).join(' · '))}</div>` : ''}
      </div>`).join('')}</div>`;
  }

  function renderSteps(steps) {
    if (!steps || !steps.length) return '';
    return `<div class="ai-steps">${steps.map(s => `
      <div class="ai-step ${s.status}">
        <span class="ai-step-ico">${s.status === 'run' ? '<span class="ai-spin"></span>' : s.status === 'done' ? '✓' : '!'}</span>
        <span class="ai-step-lbl">${esc(s.label || '')}</span>
        ${s.detail ? `<span class="ai-step-det">${esc(s.detail)}</span>` : ''}
      </div>`).join('')}</div>`;
  }

  function renderActions(actions) {
    if (!actions || !actions.length) return '';
    return `<div class="ai-actions">
      <div class="ai-actions-h">پیشنهاد اقدام (با یک کلیک اجرا می‌شود):</div>
      <div class="ai-actions-row">${actions.map((a, i) => `
        <button class="btn sm ai-act ${a.severity === 'high' ? 'danger' : ''}" data-act="${i}" title="${esc(a.detail || a.kind || '')}">${esc(a.label)}</button>`).join('')}
      </div>
      <button class="btn sm primary ai-act-all" data-act="__auto__">رفع خودکار همهٔ ایرادهای مهم</button>
    </div>`;
  }

  function renderMessage(m, idx) {
    if (m.role === 'user') {
      return `<div class="ai-msg user"><div class="ai-bubble">${esc(m.text)}</div><div class="ai-time">${esc(m.time || '')}</div></div>`;
    }
    const chips = (m.summary || []).length
      ? `<div class="ai-understood">${m.summary.map(s => `<span class="ai-chip"><b>${esc(s.k)}</b> ${esc(s.v)}</span>`).join('')}</div>` : '';
    const body = m.text ? `<div class="ai-bubble ai-md">${md(m.text)}</div>` : '';
    const alts = (m.meta && m.meta.alternatives && m.meta.alternatives.length)
      ? `<div class="ai-alts"><b>نزدیک‌ترین با شرط بازتر:</b> ${m.meta.alternatives.map(a => `<span class="ai-chip">${esc(a.label)} → ${fa(a.total)}</span>`).join('')}</div>` : '';
    const meta = m.meta ? `<div class="ai-meta">${[
      m.meta.aiUsed ? `مدل: ${esc(m.meta.model || '—')}` : 'پاسخ ساخت‌یافته (بدون مدل)',
      `نتایج: ${fa(m.meta.results ?? 0)}`,
      `زمان: ${fa((m.meta.ms / 1000).toFixed(1))} ثانیه`,
      m.meta.scanned && m.meta.scanned.performed ? `اسکن زنده: ${fa(m.meta.scanned.items || 0)} آگهی` : '',
    ].filter(Boolean).join(' · ')}</div>` : '';
    return `<div class="ai-msg ai" data-idx="${idx}">
      ${chips}${renderSteps(m.steps)}${body}${alts}${renderResults(m.results)}${renderActions(m.actions)}${meta}
      <div class="ai-time">${esc(m.time || '')}</div>
    </div>`;
  }

  function renderAll() {
    const body = $('#aiBody');
    if (!state.messages.length) {
      body.innerHTML = `<div class="ai-welcome">
        <div class="ai-welcome-t">سلام. دستیار رادار مناقصات‌ام.</div>
        <p>شهر و موضوع را بگو — آگهی‌های مرتبط را از منابع می‌کشم بیرون، داده را تازه می‌کنم و اگر منبعی ایراد داشته باشد گزارش می‌دهم.</p>
        <ul>
          <li>«مناقصه آسفالت کرج این هفته»</li>
          <li>«جدول‌گذاری و کفپوش فردیس»</li>
          <li>«چند آگهی فضای سبز داریم؟ تحلیل کن»</li>
          <li>«منابع چه ایرادی دارند؟»</li>
        </ul>
      </div>`;
      return;
    }
    body.innerHTML = state.messages.map(renderMessage).join('');
    body.scrollTop = body.scrollHeight;
  }

  function scrollDown() {
    const b = $('#aiBody');
    if (b) b.scrollTop = b.scrollHeight;
  }

  // ---------- گفت‌وگو ----------
  function newAiMessage() {
    const m = { role: 'ai', text: '', steps: [], results: [], actions: [], summary: [], meta: null, time: fmtTime(Date.now()) };
    state.messages.push(m);
    return m;
  }

  async function streamRequest(url, payload, handlers) {
    const ctl = new AbortController();
    state.abort = ctl;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    if (!r.ok || !r.body) {
      let j = null; try { j = await r.json(); } catch { /* */ }
      throw new Error((j && j.error) || ('HTTP ' + r.status));
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop();
      for (const line of parts) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        let ev = null;
        try { ev = JSON.parse(s.slice(5).trim()); } catch { continue; }
        handlers(ev);
      }
    }
  }

  async function ask(text) {
    if (state.busy || !text.trim()) return;
    state.busy = true;
    $('#aiSend').disabled = true;
    state.messages.push({ role: 'user', text: text.trim(), time: fmtTime(Date.now()) });
    const m = newAiMessage();
    renderAll();

    const live = $('#aiLive') ? $('#aiLive').checked : true;
    const useAi = $('#aiAi') ? $('#aiAi').checked : true;

    try {
      await streamRequest('/api/assistant', { text: text.trim(), fresh: live ? undefined : false, noAi: !useAi }, ev => {
        if (ev.type === 'step') {
          const cur = m.steps.find(s => s.id === ev.id);
          if (cur) { cur.status = ev.status || cur.status; if (ev.detail) cur.detail = ev.detail; if (ev.label) cur.label = ev.label; }
          else m.steps.push({ id: ev.id, label: ev.label, status: ev.status || 'run', detail: ev.detail });
          renderAll();
        } else if (ev.type === 'intent') {
          m.summary = ev.summary || [];
          renderAll();
        } else if (ev.type === 'progress') {
          const s = m.steps.find(x => x.id === 'scan');
          if (s) s.detail = `${fa(ev.done)}/${fa(ev.total)} — ${ev.current} (${fa(ev.count)})`;
          renderAll();
        } else if (ev.type === 'results') {
          m.results = ev.items || [];
          renderAll();
        } else if (ev.type === 'actions') {
          m.actions = ev.actions || [];
          renderAll();
        } else if (ev.type === 'delta') {
          m.text += ev.text;
          const el = document.querySelector(`#aiBody .ai-msg[data-idx="${state.messages.length - 1}"] .ai-md`);
          if (el) { el.innerHTML = md(m.text); scrollDown(); }
          else renderAll();
        } else if (ev.type === 'answer-reset') {
          m.text = '';
          renderAll();
        } else if (ev.type === 'answer') {
          m.text = ev.text || m.text;
          renderAll();
        } else if (ev.type === 'done') {
          m.meta = ev.meta || null;
          m.steps = (m.steps || []).map(s => s.status === 'run' ? { ...s, status: 'done' } : s);
          renderAll();
        } else if (ev.type === 'error') {
          m.text += `\n\n**خطا:** ${ev.error}`;
          renderAll();
        }
      });
    } catch (e) {
      if (e.name !== 'AbortError') {
        m.text = (m.text || '') + `\n\n**خطا در ارتباط با دستیار:** ${e.message}`;
        renderAll();
      }
    } finally {
      state.busy = false;
      state.abort = null;
      $('#aiSend').disabled = false;
      scrollDown();
    }
  }

  async function runAction(action) {
    if (state.busy) return;
    state.busy = true;
    const m = newAiMessage();
    renderAll();
    try {
      await streamRequest('/api/assistant/action', action === '__auto__' ? { mode: 'auto' } : { actions: [action] }, ev => {
        if (ev.type === 'step') {
          const cur = m.steps.find(s => s.id === ev.id);
          if (cur) { cur.status = ev.status || cur.status; if (ev.detail) cur.detail = ev.detail; }
          else m.steps.push({ id: ev.id, label: ev.label || 'اقدام', status: ev.status || 'run', detail: ev.detail });
          renderAll();
        } else if (ev.type === 'repair-done') {
          const ok = (ev.results || []).filter(r => r.ok).length;
          m.text = `**${fa(ok)} از ${fa((ev.results || []).length)} اقدام با موفقیت اجرا شد.**\n\n` +
            (ev.results || []).map(r => `- ${r.ok ? '✓' : '✗'} ${r.action.label || r.action.kind}${r.detail ? ` — ${r.detail}` : ''}`).join('\n');
          renderAll();
        } else if (ev.type === 'error') {
          m.text = `**خطا:** ${ev.error}`; renderAll();
        }
      });
    } catch (e) {
      m.text = `**خطا در اجرای اقدام:** ${e.message}`;
      renderAll();
    } finally {
      state.busy = false;
      renderAll();
    }
  }

  async function showDiagnostics() {
    if (state.busy) return;
    state.busy = true;
    const m = newAiMessage();
    renderAll();
    try {
      const r = await fetch('/api/assistant/diagnose', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const j = await r.json();
      const d = j.report;
      if (!d) throw new Error(j.error || 'گزارش دریافت نشد');
      m.summary = [{ k: 'منابع فعال', v: fa(d.summary.sourcesActive) }, { k: 'سالم', v: fa(d.summary.sourcesOk) }, { k: 'خطا', v: fa(d.summary.sourcesFailed) }, { k: 'خالی', v: fa(d.summary.sourcesEmpty) }];
      const L = [];
      L.push(`**گزارش سلامت منابع** — ${fa(d.summary.sourcesOk)} سالم از ${fa(d.summary.sourcesActive)} فعال؛ ${fa(d.summary.sourcesEmpty)} پاسخ‌داده‌ولی‌خالی، ${fa(d.summary.sourcesFailed)} خطادار.`);
      if (d.cacheScannedAt) L.push(`آخرین اسکن: ${fa(Math.round((Date.now() - Date.parse(d.cacheScannedAt)) / 60000))} دقیقه پیش · ${fa(d.itemCount)} آگهی در حافظه.`);
      if (d.coverage.length) { L.push(''); L.push('**ایرادهای پوشش:**'); for (const c of d.coverage) L.push(`- ${c.title} — ${c.detail}`); }
      const bad = d.sources.filter(s => s.issue && s.issue.type !== 'DISABLED' && s.severity !== 'low');
      if (bad.length) { L.push(''); L.push('**منابع مشکل‌دار:**'); for (const b of bad) L.push(`- **${b.name}** — ${b.issue.title}${b.issue.hint ? `\n  ${b.issue.hint}` : ''}`); }
      m.text = L.join('\n');
      m.actions = (d.actions || []).slice(0, 8);
      renderAll();
    } catch (e) {
      m.text = `**خطا:** ${e.message}`;
      renderAll();
    } finally {
      state.busy = false;
    }
  }

  // ---------- وضعیت هوش مصنوعی ----------
  async function loadHealth(force) {
    try {
      const r = await fetch('/api/assistant/health' + (force ? '?force=1' : ''));
      const j = await r.json();
      const dot = $('#aiDot');
      const st = $('#aiStatus');
      if (!j.enabled) { dot.className = 'ai-dot off'; st.textContent = 'مدل زبانی خاموش — پاسخ ساخت‌یافته'; return j; }
      if (j.reachable) {
        dot.className = 'ai-dot on';
        st.textContent = `متصل · ${j.working.length} مدل آماده${j.lastGoodModel ? ' · ' + j.lastGoodModel : ''}`;
      } else {
        dot.className = 'ai-dot warn';
        st.textContent = 'دروازهٔ هوش مصنوعی پاسخ نداد — پاسخ ساخت‌یافته فعال است';
      }
      return j;
    } catch {
      const dot = $('#aiDot'); if (dot) dot.className = 'ai-dot warn';
      const st = $('#aiStatus'); if (st) st.textContent = 'وضعیت مدل نامعلوم';
      return null;
    }
  }

  async function loadConfig() {
    try {
      const r = await fetch('/api/assistant/config');
      const j = await r.json();
      const c = j.config || {};
      $('#cEnabled').checked = !!c.enabled;
      $('#cBase').value = c.baseUrl || '';
      $('#cKey').value = c.apiKey || '';
      $('#cModels').value = (c.models || []).join(', ');
      $('#cTimeout').value = c.timeoutMs || 90000;
      $('#cTokens').value = c.maxTokens || 1400;
      $('#cHealth').innerHTML = '';
    } catch { /* */ }
  }

  async function saveConfig() {
    const body = {
      enabled: $('#cEnabled').checked,
      baseUrl: $('#cBase').value.trim(),
      apiKey: $('#cKey').value.trim(),
      models: $('#cModels').value.split(',').map(s => s.trim()).filter(Boolean),
      timeoutMs: Number($('#cTimeout').value),
      maxTokens: Number($('#cTokens').value),
    };
    const r = await fetch('/api/assistant/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.health) {
      $('#cHealth').innerHTML = j.health.reachable
        ? `<span class="ok">✓ ${fa(j.health.working.length)} مدل پاسخ داد: ${esc(j.health.working.map(w => w.model).join('، '))}</span>`
        : `<span class="bad">✗ هیچ مدلی پاسخ نداد. کلید: ${esc(j.health.keySource)}${j.health.failed.length ? ' — ' + esc(j.health.failed.slice(0, 2).map(f => f.model + ': ' + (f.error || '')).join(' | ')) : ''}</span>`;
    }
    await loadHealth(true);
    toast('تنظیمات دستیار ذخیره شد', 'ok');
  }

  // ---------- اتصال ----------
  function open() { state.open = true; $('#aiPanel').classList.add('on'); $('#aiPanel').setAttribute('aria-hidden', 'false'); $('#aiFab').style.display = 'none'; setTimeout(() => $('#aiText').focus(), 120); }
  function close() { state.open = false; $('#aiPanel').classList.remove('on'); $('#aiPanel').setAttribute('aria-hidden', 'true'); $('#aiFab').style.display = ''; }

  function bind() {
    $('#aiFab').addEventListener('click', open);
    const btn = $('#btnAssistant');
    if (btn) btn.addEventListener('click', () => (state.open ? close() : open()));
    $('#aiCloseBtn').addEventListener('click', close);
    $('#aiClearBtn').addEventListener('click', () => { state.messages = []; renderAll(); });
    $('#aiDiagBtn').addEventListener('click', showDiagnostics);
    $('#aiCfgBtn').addEventListener('click', async () => { await loadConfig(); $('#aiCfgModal').classList.add('on'); });
    $('#cSave').addEventListener('click', saveConfig);
    $('#cTest').addEventListener('click', async () => {
      $('#cHealth').innerHTML = '<span class="muted">در حال آزمون…</span>';
      const j = await loadHealth(true);
      $('#cHealth').innerHTML = j && j.reachable
        ? `<span class="ok">✓ ${fa(j.working.length)} مدل پاسخ داد: ${esc(j.working.map(w => w.model).join('، '))}</span>`
        : `<span class="bad">✗ هیچ مدلی پاسخ نداد (کلید: ${esc(j ? j.keySource : '—')})</span>`;
    });

    // چیپ‌های پیشنهاد
    $('#aiChips').innerHTML = SUGGESTIONS.map(s => `<button class="ai-schip">${esc(s)}</button>`).join('');
    $('#aiChips').addEventListener('click', e => {
      const b = e.target.closest('.ai-schip');
      if (b) ask(b.textContent);
    });

    // ورودی
    const ta = $('#aiText');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = ta.value; ta.value = ''; ta.style.height = 'auto'; ask(v); }
    });
    $('#aiSend').addEventListener('click', () => { const v = ta.value; ta.value = ''; ta.style.height = 'auto'; ask(v); });

    // اقدام‌های درون گفتگو
    $('#aiBody').addEventListener('click', e => {
      const b = e.target.closest('.ai-act');
      if (!b) return;
      const idx = Number(b.closest('.ai-msg')?.dataset.idx);
      const msg = state.messages[idx];
      const key = b.dataset.act;
      if (key === '__auto__') return runAction('__auto__');
      const a = msg && msg.actions ? msg.actions[Number(key)] : null;
      if (a) runAction(a);
    });

    // بستن مودال‌ها
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
      const el = document.getElementById(b.dataset.close);
      if (el) el.classList.remove('on');
    }));
    document.querySelectorAll('.modal-bg').forEach(bg => bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('on'); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.open) close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { bind(); loadHealth(); });
  else { bind(); loadHealth(); }
})();
