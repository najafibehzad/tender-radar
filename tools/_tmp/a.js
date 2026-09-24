/* رادار مناقصات — منطق رابط کاربری */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = v => String(v ?? '').replace(/\d/g, d => FA[+d]);
const faG = v => fa(String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '،'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KIND_CLASS = { 'مناقصه': 'b-managhese', 'مزایده': 'b-mazayede', 'استعلام': 'b-estelam', 'فراخوان': 'b-farakhvan' };
const kindBadge = k => `<span class="badge ${KIND_CLASS[k] || 'b-other'}">${esc(k || 'سایر')}</span>`;

const state = {
  status: null,
  items: [],
  total: 0,
  facets: { city: [], province: [], kind: [], source: [] },
  filters: { q: '', topic: '', city: '', province: '', kind: '', source: '', days: '', sort: 'newest', hasDeadline: false, today: false, target: true },
  view: 'table',
  scanTimer: null,
  lastScanPoll: 0,
};

// ---------- ابزار ----------
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 4200);
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* */ }
  if (!r.ok || (j && j.ok === false && j.error)) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function queryString() {
  const f = state.filters;
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.topic) p.set('topic', f.topic);
  if (f.city) p.set('city', f.city);
  if (f.province) p.set('province', f.province);
  if (f.kind) p.set('kind', f.kind);
  if (f.source) p.set('source', f.source);
  if (f.days) p.set('days', f.days);
  if (f.hasDeadline) p.set('hasDeadline', '1');
  if (f.today) p.set('today', '1');
  // صریح فرستاده می‌شود تا خاموش‌کردن فیلتر پیش‌فرض هم کار کند
  p.set('target', f.target ? '1' : '0');
  if (f.sort) p.set('sort', f.sort);
  return p.toString();
}

function deadlineCell(it) {
  if (!it.deadlineISO && !it.deadlineJalali) return '<span class="muted">—</span>';
  const txt = it.deadlineJalali || it.deadlineISO;
  const d = it.daysLeft;
  if (d == null) return `<span class="mono">${esc(txt)}</span>`;
  if (d < 0) return `<span class="badge b-other mono">${esc(txt)}</span> <span class="muted" style="font-size:11px">گذشته</span>`;
  if (d === 0) return `<span class="badge b-deadline mono">${esc(txt)}</span> <span class="badge b-deadline">امروز</span>`;
  if (d <= 3) return `<span class="badge b-deadline mono">${esc(txt)}</span> <span class="badge b-deadline">${fa(d)} روز</span>`;
  if (d <= 7) return `<span class="badge b-soon mono">${esc(txt)}</span> <span class="badge b-soon">${fa(d)} روز</span>`;
  return `<span class="mono">${esc(txt)}</span> <span class="muted" style="font-size:11px">${fa(d)} روز</span>`;
}

function topicTags(it) {
  if (!it.topics || !it.topics.length) return '';
  return `<div class="tagrow">${it.topics.slice(0, 4).map(t => `<span class="badge b-topic">${esc(t)}</span>`).join('')}</div>`;
}

// ---------- بارگذاری وضعیت ----------
async function loadStatus() {
  const s = await api('/api/status');
  state.status = s;
  renderKpis();
  renderChips();
  renderFilterOptions();
  renderSources();
  if (s.scannedAt) {
    const d = new Date(s.scannedAt);
    $('#lastScan').textContent = `آخرین اسکن: ${fa(d.toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }))}`;
  } else {
    $('#lastScan').textContent = 'هنوز اسکن نشده';
  }
  return s;
}

function renderKpis() {
  const s = state.status || {};
  const st = s.stats || {};
  const okN = s.sourcesOk ?? 0, badN = s.sourcesFailed ?? 0;
  const cards = [
    { lbl: 'کل آگهی‌های یافت‌شده', val: st.total ?? s.itemCount ?? 0, cls: '' },
    { lbl: 'منتشرشده امروز', val: st.today ?? 0, cls: 'accent' },
    { lbl: 'مهلت نزدیک (≤۳ روز)', val: st.urgent ?? 0, cls: 'danger' },
    { lbl: 'دارای مهلت اعلام‌شده', val: st.withDeadline ?? 0, cls: 'warn' },
    { lbl: 'منابع سالم', val: okN, cls: 'ok', sub: badN ? `${fa(badN)} منبع خطا` : 'همه سالم' },
    { lbl: 'تعداد منابع فعال', val: (s.registry?.sources || []).filter(x => !x._disabled).length, cls: '' },
  ];
  $('#kpis').innerHTML = cards.map(c => `
    <div class="kpi ${c.cls}">
      <div class="k-lbl">${esc(c.lbl)}</div>
      <div class="k-val">${faG(c.val)}</div>
      ${c.sub ? `<div class="k-sub">${esc(c.sub)}</div>` : ''}
    </div>`).join('');
}

function renderChips() {
  const topics = (state.status?.registry?.topics || []).filter(t => !t._disabled);
  const byTopic = state.status?.stats?.byTopic || {};
  const chips = topics.map(t => {
    const n = byTopic[t.name] || 0;
    return `<button class="chip ${state.filters.topic === t.id ? 'on' : ''}" data-topic="${esc(t.id)}">${esc(t.name)}${n ? ` <span class="n">${fa(n)}</span>` : ''}</button>`;
  }).join('');
  $('#topicChips').innerHTML = `<span class="lbl">موضوع:</span>` +
    `<button class="chip ${!state.filters.topic ? 'on' : ''}" data-topic="">همه</button>` + chips;
}

function renderFilterOptions() {
  const f = state.facets;
  const fill = (sel, list, all) => {
    const el = $(sel);
    const cur = el.value;
    el.innerHTML = `<option value="">${all}</option>` +
      list.map(x => `<option value="${esc(x.value)}">${esc(x.value)} (${fa(x.count)})</option>`).join('');
    if (cur) el.value = cur;
  };
  fill('#fProvince', f.province, 'همهٔ استان‌ها');
  fill('#fCity', f.city, 'همهٔ شهرها');
  fill('#fKind', f.kind, 'همهٔ انواع');
  fill('#fSource', f.source, 'همهٔ منابع');
}

// ---------- نتایج ----------
async function loadItems() {
  const qs = queryString();
  const r = await api('/api/items?' + qs + '&limit=2000');
  state.items = r.items || [];
  state.total = r.total || 0;
  state.facets = r.facets || state.facets;
  renderFilterOptions();
  renderResults();
}

function renderResults() {
  const box = $('#results');
  const n = state.total;
  $('#resCount').textContent = n ? `${faG(n)} آگهی` : 'بدون نتیجه';
  const scanned = state.status?.scannedAt;
  const activeFilters = [];
  if (state.filters.q) activeFilters.push(`جستجو: «${state.filters.q}»`);
  if (state.filters.topic) {
    const t = (state.status?.registry?.topics || []).find(x => x.id === state.filters.topic);
    if (t) activeFilters.push(`موضوع: ${t.name}`);
  }
  if (state.filters.city) activeFilters.push(`شهر: ${state.filters.city}`);
  if (state.filters.province) activeFilters.push(`استان: ${state.filters.province}`);
  if (state.filters.kind) activeFilters.push(`نوع: ${state.filters.kind}`);
  if (state.filters.hasDeadline) activeFilters.push('فقط دارای مهلت');
  if (state.filters.today) activeFilters.push('فقط امروز');
  if (state.filters.target) activeFilters.push('فقط تهران و البرز');
  $('#resMeta').textContent = activeFilters.length ? '| ' + activeFilters.join(' · ') : (scanned ? '' : 'هنوز اسکن نشده');

  if (!state.items.length) {
    const noScan = !scanned;
    box.innerHTML = `<div class="tablewrap"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <h3>${noScan ? 'هنوز اسکنی انجام نشده است' : 'آگهی‌ای با این شرایط پیدا نشد'}</h3>
      <p>${noScan ? 'برای دریافت آگهی‌های مناقصه، روی «اسکن منابع» بزنید.' : 'فیلترها را تغییر دهید یا کلیدواژهٔ دیگری امتحان کنید.'}</p>
    </div></div>`;
    return;
  }

  if (state.view === 'cards') {
    box.innerHTML = `<div class="cards">${state.items.map(cardHtml).join('')}</div>`;
  } else {
    box.innerHTML = `<div class="tablewrap"><table>
      <thead><tr>
        <th style="width:38px">#</th>
        <th>عنوان آگهی</th>
        <th style="width:82px">نوع</th>
        <th style="width:110px">شهر</th>
        <th style="width:150px" class="hide-sm">منبع</th>
        <th style="width:96px" class="hide-sm">انتشار</th>
        <th style="width:170px">مهلت</th>
        <th style="width:64px"></th>
      </tr></thead>
      <tbody>${state.items.map(rowHtml).join('')}</tbody>
    </table></div>`;
  }
}

function rowHtml(it, i) {
  return `<tr data-idx="${i}">
    <td class="t-idx">${fa(i + 1)}</td>
    <td>
      <div class="t-title"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></div>
      ${it.description ? `<div class="t-desc">${esc(it.description)}</div>` : ''}
      ${topicTags(it)}
    </td>
    <td class="nowrap">${kindBadge(it.kind)}</td>
    <td class="nowrap">${it.city ? esc(it.city) : '<span class="muted">—</span>'}
      ${it.province && it.province !== it.city ? `<div class="muted" style="font-size:11px">${esc(it.province)}</div>` : ''}</td>
    <td class="hide-sm"><span class="badge b-src">${esc(it.sourceName || '')}</span></td>
    <td class="nowrap hide-sm mono">${esc(it.publishedJalali || it.publishedISO || '—')}</td>
    <td class="nowrap">${deadlineCell(it)}</td>
    <td><button class="btn ghost sm" data-detail="${i}" title="جزئیات">…</button></td>
  </tr>`;
}

function cardHtml(it, i) {
  return `<div class="card" data-idx="${i}">
    <div class="c-head">
      <div class="c-title">${esc(it.title)}</div>
      ${kindBadge(it.kind)}
    </div>
    ${it.description ? `<div class="c-desc">${esc(it.description)}</div>` : ''}
    ${topicTags(it)}
    <div class="c-foot">
      <span>🏙 ${esc(it.city || '—')}</span>
      <span>🏛 ${esc(it.sourceName || '')}</span>
      ${it.publishedJalali ? `<span>📅 ${esc(it.publishedJalali)}</span>` : ''}
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      ${deadlineCell(it)}
      <a class="btn sm" style="margin-inline-start:auto" href="${esc(it.url)}" target="_blank" rel="noopener">مشاهدهٔ آگهی</a>
    </div>
  </div>`;
}

// ---------- کشوی جزئیات ----------
function openDetail(it) {
  $('#dTitle').textContent = it.title;
  const rows = [
    ['نوع آگهی', it.kind],
    ['شهر', it.city || '—'],
    ['استان', it.province || '—'],
    ['سازمان', it.org || '—'],
    ['منبع', it.sourceName],
    ['نوع منبع', it.sourceType],
    ['تاریخ انتشار', it.publishedJalali || it.publishedISO || '—'],
    ['مهلت', it.deadlineJalali || it.deadlineISO || '—'],
    ['روز باقی‌مانده', it.daysLeft == null ? '—' : fa(it.daysLeft) + ' روز'],
    ['موضوعات', (it.topics || []).join('، ') || '—'],
    ['کلیدواژه‌ها', (it.keywords || []).join('، ') || '—'],
  ];
  const also = (it.alsoSeenAt || []).length
    ? `<div style="margin-top:14px"><b>همچنین دیده‌شده در:</b><ul style="margin:6px 0;padding-inline-start:18px">${it.alsoSeenAt.map(a => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.source)}</a></li>`).join('')}</ul></div>` : '';
  $('#dBody').innerHTML = `
    <dl class="dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${it.description ? `<div style="margin-top:16px"><b>متن آگهی</b><div class="rawtext" style="margin-top:6px">${esc(it.description)}</div></div>` : ''}
    ${also}
    <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn primary" href="${esc(it.url)}" target="_blank" rel="noopener">بازکردن آگهی در سایت منبع</a>
      <button class="btn" id="dCopy">کپی متن</button>
    </div>`;
  $('#drawer').classList.add('on');
  $('#drawerBg').classList.add('on');
  const c = $('#dCopy');
  if (c) c.onclick = () => {
    navigator.clipboard.writeText(`${it.title}\n${it.description || ''}\n${it.url}`)
      .then(() => toast('متن آگهی کپی شد', 'ok')).catch(() => toast('کپی نشد', 'err'));
  };
}
function closeDetail() {
  $('#drawer').classList.remove('on');
  $('#drawerBg').classList.remove('on');
}

// ---------- منابع ----------
/** شناسهٔ منابعی که در آخرین اسکن خطا داده‌اند */
function failedSourceIds() {
  return (state.status?.sourcesReport || []).filter(s => !s.ok).map(s => s.id);
}

function renderRetryFailed() {
  const btn = $('#btnRetryFailed');
  if (!btn) return;
  const ids = failedSourceIds();
  btn.style.display = ids.length ? '' : 'none';
  $('#failedCount').textContent = fa(ids.length);
  btn.title = ids.length ? 'فقط منابعی که خطا دادند دوباره اسکن می‌شوند' : '';
}

function renderSources() {
  const reg = state.status?.registry || {};
  const rep = Object.fromEntries((state.status?.sourcesReport || []).map(s => [s.id, s]));
  const list = reg.sources || [];
  const grid = $('#srcGrid');
  grid.innerHTML = list.map(s => {
    const r = rep[s.id];
    const off = s._disabled;
    const bad = r && !r.ok;
    return `<div class="srcitem ${off ? 'off' : ''} ${bad ? 'failed' : ''}">
      <div class="si-top">
        <span class="dot ${off ? 'off' : bad ? 'bad' : 'ok'}"></span>
        <span class="si-name">${esc(s.name)}</span>
        <span class="badge b-src" style="margin-inline-start:auto">${esc(s.adapter)}</span>
      </div>
      <div class="si-meta">
        <span>${esc(s.province || '—')}</span>
        ${s.city ? `<span>· ${esc(s.city)}</span>` : ''}
        <span>· ${esc(s.type || '')}</span>
        ${r ? `<span>· ${fa(r.count)} آگهی</span><span>· ${fa((r.ms / 1000).toFixed(1))}ث</span>` : ''}
      </div>
      ${r && r.error ? `<div class="si-err">⚠ ${esc(String(r.error).slice(0, 150))}</div>` : ''}
      <div class="si-meta"><a href="${esc(s.url)}" target="_blank" rel="noopener" dir="ltr">${esc(s.url.replace(/^https?:\/\//, '').slice(0, 44))}</a></div>
      <div class="si-acts">
        <button class="btn sm" data-scanone="${esc(s.id)}">اسکن این منبع</button>
        <button class="btn sm" data-togglesrc="${esc(s.id)}">${off ? 'فعال‌سازی' : 'غیرفعال'}</button>
        <button class="btn sm danger" data-delsrc="${esc(s.id)}">حذف</button>
      </div>
    </div>`;
  }).join('') || '<div class="muted">منبعی ثبت نشده است.</div>';

  // فهرست کامل داخل مودال
  $('#srcListFull').innerHTML = grid.innerHTML;
  renderRetryFailed();
}

function renderTopics() {
  const topics = state.status?.registry?.topics || [];
  $('#topicList').innerHTML = topics.map(t => `
    <div class="srcitem" style="margin-bottom:8px">
      <div class="si-top">
        <span class="dot ${t._disabled ? 'off' : 'ok'}"></span>
        <span class="si-name">${esc(t.name)}</span>
        <span class="badge b-src" style="margin-inline-start:auto">${fa((t.words || []).length)} کلیدواژه</span>
      </div>
      <div class="si-meta">${esc((t.words || []).join('، '))}</div>
      <div class="si-acts">
        <button class="btn sm" data-toggletopic="${esc(t.id)}">${t._disabled ? 'فعال‌سازی' : 'غیرفعال'}</button>
        ${t.custom ? `<button class="btn sm danger" data-deltopic="${esc(t.id)}">حذف</button>` : ''}
      </div>
    </div>`).join('');
}

// ---------- اسکن ----------
async function startScan(onlySourceIds) {
  const btn = $('#btnScan');
  btn.disabled = true;
  $('#scanProgress').style.display = 'block';
  $('#scanBar').style.width = '4%';
  toast('اسکن منابع آغاز شد…');
  try {
    const r = await api('/api/scan', { method: 'POST', body: onlySourceIds ? { onlySourceIds } : {} });
    if (r.ok) toast(`اسکن کامل شد — ${fa(r.total)} آگهی از ${fa(r.sourcesOk)} منبع`, 'ok');
    else toast('اسکن انجام نشد: ' + (r.error || ''), 'err');
  } catch (e) {
    toast('خطا در اسکن: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    $('#scanBar').style.width = '100%';
    setTimeout(() => { $('#scanProgress').style.display = 'none'; $('#scanBar').style.width = '0'; }, 700);
    stopScanPoll();
    await loadStatus();
    await loadItems();
  }
}

function startScanPoll() {
  stopScanPoll();
  state.scanTimer = setInterval(async () => {
    try {
      const s = await api('/api/scan/status');
      if (s.running) {
        $('#scanProgress').style.display = 'block';
        const pct = s.total ? Math.round((s.done / s.total) * 100) : 5;
        $('#scanBar').style.width = Math.max(4, pct) + '%';
        $('#lastScan').textContent = `در حال اسکن: ${s.current || ''} (${fa(s.done)}/${fa(s.total)})`;
      } else {
        $('#scanBar').style.width = '100%';
      }
    } catch { /* */ }
  }, 1200);
}
function stopScanPoll() { if (state.scanTimer) { clearInterval(state.scanTimer); state.scanTimer = null; } }

// ---------- رویدادها ----------
function bind() {
  $('#btnScan').onclick = () => startScan();

  $('#btnRetryFailed').onclick = async () => {
    const ids = failedSourceIds();
    if (!ids.length) { toast('منبع خطاداری نیست', 'ok'); return; }
    toast(`${fa(ids.length)} منبع خطادار دوباره اسکن می‌شود…`);
    await startScan(ids);
  };

  const doSearch = debounce(() => { state.filters.q = $('#q').value.trim(); loadItems(); }, 320);
  $('#q').addEventListener('input', e => {
    $('#qClear').classList.toggle('on', !!e.target.value);
    doSearch();
  });
  $('#qClear').onclick = () => { $('#q').value = ''; $('#qClear').classList.remove('on'); state.filters.q = ''; loadItems(); };

  $('#topicChips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.filters.topic = b.dataset.topic;
    renderChips();
    loadItems();
  });

  const bindSel = (sel, key) => $(sel).addEventListener('change', e => { state.filters[key] = e.target.value; loadItems(); });
  bindSel('#fProvince', 'province'); bindSel('#fCity', 'city'); bindSel('#fKind', 'kind');
  bindSel('#fSource', 'source'); bindSel('#fDays', 'days'); bindSel('#fSort', 'sort');

  $('#fDeadline').addEventListener('change', e => {
    state.filters.hasDeadline = e.target.checked;
    $('#lblDeadline').classList.toggle('on', e.target.checked);
    loadItems();
  });
  $('#fToday').addEventListener('change', e => {
    state.filters.today = e.target.checked;
    $('#lblToday').classList.toggle('on', e.target.checked);
    loadItems();
  });
  $('#fTarget').addEventListener('change', e => {
    state.filters.target = e.target.checked;
    $('#lblTarget').classList.toggle('on', e.target.checked);
    // به‌عنوان پیش‌فرض ذخیره می‌شود تا اسکن و بار بعدی هم همین‌طور باشد
    api('/api/settings', { method: 'POST', body: { targetOnly: e.target.checked } })
      .then(() => { if (state.status?.registry?.settings) state.status.registry.settings.targetOnly = e.target.checked; })
      .catch(() => {});
    loadItems();
  });

  $('#btnReset').onclick = () => {
    const targetDefault = (state.status?.registry?.settings || {}).targetOnly !== false;
    state.filters = { q: '', topic: '', city: '', province: '', kind: '', source: '', days: '', sort: 'newest', hasDeadline: false, today: false, target: targetDefault };
    $('#q').value = ''; $('#qClear').classList.remove('on');
    ['#fProvince', '#fCity', '#fKind', '#fSource', '#fDays'].forEach(s => $(s).value = '');
    $('#fSort').value = 'newest';
    $('#fDeadline').checked = false; $('#fToday').checked = false; $('#fTarget').checked = targetDefault;
    $('#lblDeadline').classList.remove('on'); $('#lblToday').classList.remove('on');
    $('#lblTarget').classList.toggle('on', targetDefault);
    renderChips(); loadItems();
  };

  $$('.viewtabs button').forEach(b => b.onclick = () => {
    $$('.viewtabs button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.view = b.dataset.view;
    renderResults();
  });

  $('#btnCsv').onclick = () => { window.location = '/api/export.csv?' + queryString(); toast('در حال ساخت فایل اکسل…'); };
  $('#btnJson').onclick = () => { window.location = '/api/export.json?' + queryString(); };
  $('#btnPrint').onclick = () => window.print();
  $('#btnCopy').onclick = () => {
    const txt = state.items.map((it, i) => `${i + 1}. ${it.title} | ${it.city || '—'} | ${it.publishedJalali || ''} | ${it.url}`).join('\n');
    navigator.clipboard.writeText(txt).then(() => toast(`${fa(state.items.length)} آگهی کپی شد`, 'ok')).catch(() => toast('کپی نشد', 'err'));
  };

  // نتایج: کلیک روی جزئیات
  $('#results').addEventListener('click', e => {
    const d = e.target.closest('[data-detail]');
    if (d) { openDetail(state.items[+d.dataset.detail]); return; }
    const card = e.target.closest('.card');
    if (card && !e.target.closest('a')) openDetail(state.items[+card.dataset.idx]);
  });

  $('#dClose').onclick = closeDetail;
  $('#drawerBg').onclick = closeDetail;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); closeModals(); } });

  // مودال‌ها
  $$('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).classList.remove('on'));
  $$('.modal-bg').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on'); }));

  $('#btnSources').onclick = async () => { await loadStatus(); $('#modalSources').classList.add('on'); showPane('paneAddCity'); };
  $('#btnSettings').onclick = () => {
    const s = state.status?.registry?.settings || {};
    $('#sInterval').value = s.scanIntervalMinutes ?? 0;
    $('#sLookback').value = s.lookbackDays ?? 150;
    $('#sTimeout').value = s.requestTimeoutMs ?? 30000;
    $('#sMax').value = s.maxItemsPerSource ?? 300;
    $('#sAuto').checked = !!s.autoScanOnStart;
    $('#modalSettings').classList.add('on');
  };
  $('#btnSaveSettings').onclick = async () => {
    try {
      await api('/api/settings', { method: 'POST', body: {
        scanIntervalMinutes: +$('#sInterval').value || 0,
        lookbackDays: +$('#sLookback').value || 150,
        requestTimeoutMs: +$('#sTimeout').value || 30000,
        maxItemsPerSource: +$('#sMax').value || 300,
        autoScanOnStart: $('#sAuto').checked,
      } });
      $('#modalSettings').classList.remove('on');
      toast('تنظیمات ذخیره شد', 'ok');
      await loadStatus();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#btnResetCache').onclick = async () => {
    if (!confirm('نتایج ذخیره‌شده پاک شود؟')) return;
    await api('/api/reset-cache', { method: 'POST' });
    $('#modalSettings').classList.remove('on');
    toast('نتایج پاک شد', 'ok');
    await loadStatus(); await loadItems();
  };

  // تب‌های مودال منابع
  const panes = { tabAddCity: 'paneAddCity', tabListSrc: 'paneListSrc', tabTopics: 'paneTopics' };
  function showPane(id) {
    Object.values(panes).forEach(p => { const el = $('#' + p); if (el) el.style.display = p === id ? '' : 'none'; });
    $$('#modalSources .modal-body > div:first-child .btn').forEach(b => b.classList.toggle('primary', panes[b.id] === id));
  }
  window.showPane = showPane;
  $('#tabAddCity').onclick = () => showPane('paneAddCity');
  $('#tabListSrc').onclick = () => { renderSources(); showPane('paneListSrc'); };
  $('#tabTopics').onclick = () => { renderTopics(); showPane('paneTopics'); };

  // شناسایی سایت
  $('#btnDetect').onclick = async () => {
    const url = $('#aUrl').value.trim();
    if (!url) { toast('نشانی سایت را وارد کنید', 'err'); return; }
    const out = $('#detectOut');
    out.innerHTML = '<div class="muted">در حال بررسی سایت… (ممکن است چند ثانیه طول بکشد)</div>';
    try {
      const r = await api('/api/detect', { method: 'POST', body: { url } });
      const rep = r.report || {};
      const adapterFa = { wordpress: 'وردپرس (REST API)', html: 'صفحهٔ HTML', rss: 'فید RSS', sitemap: 'نقشهٔ سایت' };
      out.innerHTML = `
        <div class="srcitem ${rep.reachable ? '' : 'failed'}">
          <div class="si-top"><span class="dot ${rep.reachable ? 'ok' : 'bad'}"></span>
            <span class="si-name">${esc(rep.title || url)}</span></div>
          <div class="si-meta">
            <span>وضعیت: ${rep.reachable ? 'در دسترس' : 'در دسترس نیست'}</span>
            <span>· روش پیشنهادی: <b>${esc(adapterFa[rep.adapter] || rep.adapter)}</b></span>
            ${rep.generator ? `<span>· ${esc(rep.generator)}</span>` : ''}
          </div>
          ${rep.error ? `<div class="si-err">⚠ ${esc(rep.error)}</div>` : ''}
          ${(rep.pages || []).length ? `<div class="si-meta">مسیرهای آگهی: ${(rep.pages || []).slice(0, 4).map(p => `<span dir="ltr">${esc(p.replace(/^https?:\/\//, '').slice(0, 46))}</span>`).join(' · ')}</div>` : ''}
          ${(rep.feeds || []).length ? `<div class="si-meta">فیدها: ${(rep.feeds || []).length} مورد</div>` : ''}
          ${rep.sitemap ? `<div class="si-meta">نقشهٔ سایت: ${fa(rep.sitemap.allCount)} نشانی، ${fa(rep.sitemap.tenderCount)} مرتبط با مناقصه</div>` : ''}
          ${(rep.sampleItems || []).length ? `<div class="si-meta"><b>نمونهٔ آگهی‌های یافت‌شده:</b></div>
            <ul style="margin:4px 0;padding-inline-start:18px;font-size:12.5px">${(rep.sampleItems || []).map(s => `<li>${esc(s.title.slice(0, 100))}</li>`).join('')}</ul>` : ''}
          ${(rep.notes || []).length ? `<div class="si-meta">${(rep.notes || []).map(n => esc(n)).join(' · ')}</div>` : ''}
        </div>`;
      // پیش‌پرکردن فیلدها
      if (rep.adapter) $('#aAdapter').value = rep.adapter;
      if ((rep.pages || []).length) $('#aPages').value = rep.pages.join('\n');
      if (rep.title && !$('#aName').value) $('#aName').value = rep.title.slice(0, 60);
      toast('بررسی سایت کامل شد', 'ok');
    } catch (e) {
      out.innerHTML = `<div class="si-err">خطا: ${esc(e.message)}</div>`;
      toast(e.message, 'err');
    }
  };

  // افزودن منبع
  $('#btnAddSource').onclick = async () => {
    const body = {
      name: $('#aName').value.trim(),
      url: $('#aUrl').value.trim(),
      city: $('#aCity').value.trim(),
      province: $('#aProvince').value.trim(),
      type: $('#aType').value,
      adapter: $('#aAdapter').value === 'auto' ? 'html' : $('#aAdapter').value,
      pages: $('#aPages').value.split('\n').map(s => s.trim()).filter(Boolean),
      verified: true,
    };
    if (!body.name || !body.url) { toast('نام و نشانی لازم است', 'err'); return; }
    try {
      const r = await api('/api/sources', { method: 'POST', body });
      toast(`«${r.source.name}» افزوده شد`, 'ok');
      $('#aName').value = ''; $('#aUrl').value = ''; $('#aCity').value = ''; $('#aProvince').value = ''; $('#aPages').value = ''; $('#detectOut').innerHTML = '';
      await loadStatus();
      toast('برای دریافت آگهی‌ها روی «اسکن منابع» بزنید', 'warn');
    } catch (e) { toast(e.message, 'err'); }
  };

  // افزودن موضوع
  $('#btnAddTopic').onclick = async () => {
    try {
      const r = await api('/api/topics', { method: 'POST', body: { name: $('#tName').value.trim(), words: $('#tWords').value } });
      toast(`موضوع «${r.topic.name}» افزوده شد`, 'ok');
      $('#tName').value = ''; $('#tWords').value = '';
      await loadStatus(); renderTopics();
    } catch (e) { toast(e.message, 'err'); }
  };

  // اقدام‌های پویا روی منابع/موضوعات (در هر دو محل)
  document.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    const one = t.dataset.scanone;
    if (one) { $('#modalSources').classList.remove('on'); await startScan([one]); return; }
    const tg = t.dataset.togglesrc;
    if (tg) { await api(`/api/sources/${encodeURIComponent(tg)}/toggle`, { method: 'POST' }); await loadStatus(); toast('وضعیت منبع تغییر کرد', 'ok'); return; }
    const dl = t.dataset.delsrc;
    if (dl) {
      if (!confirm('این منبع حذف شود؟')) return;
      await api(`/api/sources/${encodeURIComponent(dl)}`, { method: 'DELETE' });
      await loadStatus(); toast('منبع حذف شد', 'ok'); return;
    }
    const tt = t.dataset.toggletopic;
    if (tt) { await api(`/api/topics/${encodeURIComponent(tt)}`, { method: 'POST', body: { _disabled: !(state.status.registry.topics.find(x => x.id === tt) || {})._disabled } }); await loadStatus(); renderTopics(); return; }
    const dt = t.dataset.deltopic;
    if (dt) {
      if (!confirm('این موضوع حذف شود؟')) return;
      await api(`/api/topics/${encodeURIComponent(dt)}`, { method: 'DELETE' });
      await loadStatus(); renderTopics(); return;
    }
  });

  // پوسته
  const setTheme = t => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('tr-theme', t);
  };
  $('#btnTheme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  const saved = localStorage.getItem('tr-theme');
  if (saved) setTheme(saved);
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme('dark');

  // کلید میان‌بر
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); }
  });
}

function closeModals() { $$('.modal-bg').forEach(m => m.classList.remove('on')); }

// ---------- راهنما ----------
function renderHelp() {
  $('#helpBody').innerHTML = `
    <p style="margin-top:0">این برنامه آگهی‌های <b>مناقصه، مزایده، استعلام و فراخوان</b> را از سایت‌های شهرداری‌ها،
    دهیاری‌ها و سامانه‌های تجمیع‌کننده استخراج می‌کند و در یک فهرست یکپارچه با امکان جستجو بر پایهٔ موضوع نشان می‌دهد.</p>
    <ul style="padding-inline-start:20px;line-height:2">
      <li><b>جستجو با موضوع:</b> کافی است بخشی از موضوع را بنویسید (مثلاً «آسفالت») یا از چیپ‌های بالای صفحه استفاده کنید.
          جستجو با یکسان‌سازی «ی/ي» و «ک/ك» و ارقام فارسی/لاتین انجام می‌شود.</li>
      <li><b>افزودن شهر:</b> از «شهرها و منابع» ← «افزودن شهر / منبع جدید». نشانی سایت را بدهید و روی
          «بررسی و شناسایی سایت» بزنید؛ برنامه نوع سامانه (وردپرس/HTML/RSS) و مسیر آگهی‌ها را خودکار کشف می‌کند.</li>
      <li><b>منابع در دسترس نبودند؟</b> بعضی سایت‌های شهرداری دسترسی از خارج ایران را می‌بندند. برنامه را روی
          کامپیوتر داخل ایران اجرا کنید تا همهٔ منابع پاسخ دهند. وضعیت هر منبع در پنل «وضعیت منابع» مشخص است.</li>
      <li><b>مهلت‌ها:</b> تاریخ‌ها به شمسی نمایش داده می‌شوند. مهلت‌های کمتر از ۳ روز با رنگ قرمز مشخص می‌شوند.</li>
      <li><b>خروجی:</b> دکمهٔ «اکسل (CSV)» فایل سازگار با Excel (با کدگذاری UTF-8 BOM) می‌سازد.</li>
      <li><b>اسکن خودکار:</b> در «تنظیمات» می‌توانید بازهٔ اسکن خودکار (دقیقه) را تنظیم کنید تا برنامه در پس‌زمینه به‌روز بماند.</li>
    </ul>
    <p class="muted" style="font-size:12.5px;margin-bottom:0">میان‌بر: کلید <b>/</b> برای رفتن به کادر جستجو.</p>`;
}

// ---------- راه‌اندازی ----------
(async function init() {
  bind();
  renderHelp();
  try {
    const s = await loadStatus();
    // «فقط تهران و البرز» از تنظیمات سرور خوانده می‌شود (پیش‌فرض: روشن)
    state.filters.target = (s.registry?.settings || {}).targetOnly !== false;
    $('#fTarget').checked = state.filters.target;
    $('#lblTarget').classList.toggle('on', state.filters.target);
    if (s.scan?.running) startScanPoll();
    await loadItems();
    if (!s.scannedAt) toast('برای شروع، روی «اسکن منابع» بزنید', 'warn');
  } catch (e) {
    toast('خطا در اتصال به سرور: ' + e.message, 'err');
  }
  // اگر سرور در حال اسکن باشد، نوار پیشرفت را دنبال کن
  setInterval(async () => {
    try {
      const s = await api('/api/scan/status');
      if (s.running && !state.scanTimer) startScanPoll();
      if (!s.running && state.scanTimer) { stopScanPoll(); await loadStatus(); await loadItems(); }
    } catch { /* */ }
  }, 5000);
})();
