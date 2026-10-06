// lib/assistant.mjs — هستهٔ دستیار هوشمند رادار مناقصات
//
// چرخهٔ کار (هر مرحله یک رویداد به رابط کاربری می‌فرستد):
//   ۱) فهم درخواست  → parseQuery
//   ۲) تازه‌سازی زندهٔ منابع مرتبط (در صورت کهنگی داده یا درخواست صریح)
//   ۳) جست‌وجوی ربط‌محور با فیلترهای سخت
//   ۴) اگر نتیجه کم بود: بازکردن تدریجی قیدها (بدون موضوع / بدون شهر / بدون بازه)
//   ۵) تشخیص ایراد منابع و ساخت نسخهٔ درمان
//   ۶) تولید پاسخ: با مدل زبانی (اگر در دسترس باشد) یا پاسخ قالبی دقیق
//
// کل دادهٔ پاسخ از حافظهٔ رادار می‌آید؛ مدل زبانی فقط «بیان» می‌کند، نه «داده».
import { parseQuery, searchItems, analyze, intentSummary, daysUntil, textHasCity } from './search.mjs';
import { diagnose, diagnoseDigest } from './diagnose.mjs';
import { chatStream, loadConfig, health } from './ai.mjs';
import { faNum, faGroup, todayTehran, isoToJalali, normalizeFa } from './text.mjs';

const FRESH_MINUTES_DEFAULT = 120;
const MAX_CTX_ITEMS = 24;

// ---------- ابزار کمکی ----------
const compact = it => ({
  title: it.title,
  kind: it.kind,
  city: it.city || '',
  province: it.province || '',
  org: it.org || '',
  source: it.sourceName || '',
  published: it.publishedJalali || it.publishedISO || (it.firstSeenAt ? '~' + isoToJalali(String(it.firstSeenAt).slice(0, 10)) : ''),
  deadline: it.deadlineJalali || it.deadlineISO || '',
  daysLeft: it.daysLeft ?? null,
  topics: (it.topics || []).slice(0, 3),
  url: it.url,
  score: it._score,
  reasons: it._reasons,
});

/** منابع مرتبط با قصد (برای اسکن هدفمند) */
function pickSources(registry, intent, { max = 10 } = {}) {
  const active = (registry.sources || []).filter(s => !s._disabled);
  const aggregators = active.filter(s => ['setadiran', 'etend', 'didehban', 'rss', 'odata'].includes(s.adapter));
  const wanted = new Set();
  const out = [];
  const push = s => { if (s && !wanted.has(s.id)) { wanted.add(s.id); out.push(s); } };

  if (intent.cities.length) {
    for (const s of active) if (intent.cities.includes(s.city)) push(s);
  }
  // تجمیع‌کننده‌ها همیشه ارزش اسکن دارند (پوشش کشوری/استانی)
  for (const s of aggregators) push(s);
  if (!out.length) for (const s of active) push(s);
  return out.slice(0, max);
}

function cacheAgeMinutes(cache) {
  if (!cache || !cache.scannedAt) return Infinity;
  return (Date.now() - Date.parse(cache.scannedAt)) / 60000;
}

// ---------- پاسخ قالبی (بدون مدل زبانی) ----------
function deterministicAnswer({ text, intent, res, alts, diag, scan, settings, metaMode, cityBreakdown }) {
  const L = [];
  const sum = intentSummary(intent);
  const hasTopic = intent.topicHits.length > 0;
  const topicNames = intent.topicHits.map(t => t.name).join('، ');
  const where = intent.cities.length ? `شهر ${intent.cities.join('، ')}`
    : intent.provinces.length ? `استان ${intent.provinces.join('، ')}` : 'کل تهران و البرز';

  // ---- حالت «پرسش از منابع»: پاسخ فقط گزارش سلامت ----
  if (metaMode && diag) {
    L.push(`**گزارش سلامت منابع** — ${faNum(diag.summary.sourcesActive)} منبع فعال از ${faNum(diag.summary.sourcesTotal)}؛ ${faNum(diag.summary.sourcesOk)} سالم، ${faNum(diag.summary.sourcesFailed)} خطادار، ${faNum(diag.summary.sourcesEmpty)} پاسخ‌داده‌ولی‌خالی، ${faNum(diag.summary.sourcesDisabled)} خاموش.`);
    L.push(`حافظهٔ فعلی: ${faNum(diag.itemCount)} آگهی${diag.cacheScannedAt ? ` · آخرین اسکن ${faNum(Math.round((Date.now() - Date.parse(diag.cacheScannedAt)) / 60000))} دقیقه پیش` : ''}.`);
    if (diag.coverage.length) {
      L.push('');
      L.push('**ایرادهای پوشش:**');
      for (const c of diag.coverage) L.push(`- [${c.severity === 'high' ? 'مهم' : 'هشدار'}] ${c.title} — ${c.detail}`);
    }
    const broken = diag.sources.filter(s => s.issue && s.issue.type !== 'DISABLED' && s.severity !== 'low');
    if (broken.length) {
      L.push('');
      L.push('**منابع مشکل‌دار:**');
      for (const b of broken) {
        L.push(`- **${b.name}** (${b.issue.type}) — ${b.issue.title}${b.issue.hint ? `\n  راه‌حل: ${b.issue.hint}` : ''}`);
      }
    }
    const healthy = diag.sources.filter(s => !s.issue).length;
    if (healthy) L.push(`\n${faNum(healthy)} منبع بدون ایراد کار می‌کند.`);
    if (diag.actions.length) {
      L.push('');
      L.push('**نسخهٔ درمان (قابل اجرا از همین گفتگو):**');
      for (const a of diag.actions.slice(0, 8)) L.push(`- ${a.label}`);
    }
    return L.join('\n');
  }

  if (res.total > 0) {
    L.push(`**${faNum(res.total)} آگهی** مرتبط پیدا شد — ${where}${hasTopic ? ` · موضوع: ${topicNames}` : intent.freeTermsDisplay.length ? ` · واژه: ${intent.freeTermsDisplay.join('، ')}` : ''}${intent.timeLabel ? ` · ${intent.timeLabel}` : ''}.`);
    if (res.total > res.items.length) L.push(`از این میان ${faNum(res.items.length)} مورد مهم‌تر در ادامه آمده است.`);
  } else {
    L.push(`**آگهی مرتبطی پیدا نشد** — ${where}${hasTopic ? ` · موضوع: ${topicNames}` : intent.freeTermsDisplay.length ? ` · واژه: ${intent.freeTermsDisplay.join('، ')}` : ''}${intent.timeLabel ? ` · ${intent.timeLabel}` : ''}.`);
    const dr = res.dropped;
    const bits = [];
    if (dr.city) bits.push(`${faNum(dr.city)} آگهی شهر دیگری بود`);
    if (dr.dimension) bits.push(`${faNum(dr.dimension)} آگهی موضوع را نداشت`);
    if (dr.date) bits.push(`${faNum(dr.date)} آگهی بیرون از بازهٔ زمانی بود`);
    if (dr.deadline) bits.push(`${faNum(dr.deadline)} آگهی بدون مهلت/مهلت‌گذشته بود`);
    if (dr.target) bits.push(`${faNum(dr.target)} آگهی بیرون از تهران و البرز بود`);
    if (bits.length) L.push(`دلیل: ${bits.join(' · ')}.`);
    if (cityBreakdown && cityBreakdown.length) {
      L.push('');
      L.push(`**در ${intent.cities.join('، ')} این موضوع‌ها آگهی دارند:** ${cityBreakdown.slice(0, 8).map(x => `${x.value} (${faNum(x.count)})`).join('، ')}.`);
    }
  }

  if (alts && alts.length) {
    L.push('');
    L.push('**نزدیک‌ترین نتایج با شرط‌های بازتر:**');
    for (const a of alts) L.push(`- ${a.label} → ${faNum(a.total)} آگهی${a.sample && a.sample.length ? ` (مثال: ${a.sample.map(s => s.title).join(' | ').slice(0, 180)})` : ''}`);
  }

  if (res.items.length) {
    L.push('');
    L.push('**فهرست:**');
    for (const it of res.items) {
      const bits = [];
      if (it.city) bits.push(it.city);
      if (it.kind) bits.push(it.kind);
      if (it.org) bits.push(it.org.slice(0, 40));
      if (it.publishedJalali || it.publishedISO) bits.push(`انتشار ${it.publishedJalali || it.publishedISO}`);
      if (it.deadlineJalali) bits.push(`مهلت ${it.deadlineJalali}${it.daysLeft != null ? ` (${it.daysLeft < 0 ? 'گذشته' : faNum(it.daysLeft) + ' روز'})` : ''}`);
      L.push(`- **${it.title}** — ${bits.join(' · ')}`);
      if (it.url) L.push(`  ${it.url}`);
    }
  }

  // تحلیل
  if (intent.wantsAnalysis && res.all.length) {
    const a = analyze(res.all);
    L.push('');
    L.push('**تحلیل:**');
    L.push(`- کل ${faNum(a.total)} آگهی؛ ${faNum(a.withDeadline)} مورد مهلت اعلام‌شده دارد، ${faNum(a.urgent.length)} مورد مهلت ۳ روز آینده.`);
    if (a.byCity.length) L.push(`- توزیع شهری: ${a.byCity.slice(0, 6).map(x => `${x.value} (${faNum(x.count)})`).join('، ')}`);
    if (a.byKind.length) L.push(`- نوع: ${a.byKind.map(x => `${x.value} (${faNum(x.count)})`).join('، ')}`);
    if (a.bySource.length) L.push(`- منابع: ${a.bySource.slice(0, 5).map(x => `${x.value} (${faNum(x.count)})`).join('، ')}`);
    if (a.urgent.length) L.push(`- فوری‌ترین: ${a.urgent.slice(0, 3).map(i => `${i.title.slice(0, 45)} (${faNum(i._dl)} روز)`).join(' | ')}`);
  }

  // ایرادها
  if (diag && diag.actions.length) {
    L.push('');
    L.push('**ایراد منابع و راه‌حل:**');
    for (const c of diag.coverage) L.push(`- [${c.severity === 'high' ? 'مهم' : 'هشدار'}] ${c.title} — ${c.detail}`);
    const bad = diag.sources.filter(s => s.issue && s.severity !== 'low' && s.issue.type !== 'DISABLED').slice(0, 6);
    for (const b of bad) L.push(`- منبع «${b.name}»: ${b.issue.title}${b.issue.hint ? ' — ' + b.issue.hint : ''}`);
    const fixes = diag.actions.filter(a => a.kind === 'setting' || a.kind === 'rescan-all');
    if (fixes.length) L.push(`- پیشنهاد اقدام: ${fixes.map(f => f.label).join(' · ')}`);
  }

  if (scan && scan.performed) {
    L.push('');
    L.push(scan.degraded
      ? `_(به‌روزرسانی زنده انجام شد ولی هر ${faNum(scan.sources)} منبع خطا دادند — احتمالاً اجرای برنامه از بیرون ایران یا قطعی موقت. دادهٔ قبلی حفظ شده است.)_`
      : `_(داده‌ها با یک اسکن تازه به‌روز شد: ${faNum(scan.items ?? 0)} آگهی از ${faNum(scan.sources ?? 0)} منبع، ${Math.round((scan.ms || 0) / 1000)} ثانیه)_`);
  } else if (settings && Number.isFinite(settings.ageMinutes)) {
    L.push('');
    L.push(`_(آخرین اسکن ${faNum(Math.round(settings.ageMinutes))} دقیقه پیش — برای نتیجهٔ تازه‌تر بگو «اسکن کن»)_`);
  }
  return L.join('\n');
}

// ---------- زمینهٔ مدل زبانی ----------
function buildContext({ text, intent, res, alts, diag, scan, metaMode, cityBreakdown }) {
  const lines = [];
  lines.push(`درخواست کاربر: ${text}`);
  lines.push(`تفسیر درخواست: ${intentSummary(intent).map(s => `${s.k}=${s.v}`).join(' | ') || 'بدون قید'}`);
  if (intent.kinds.length) lines.push(`نوع خواسته‌شده: ${intent.kinds.join('، ')}`);
  if (metaMode) lines.push('نوع پرسش: کاربر دربارهٔ سلامت/ایراد منابع می‌پرسد — پاسخ باید گزارش وضعیت منابع و نسخهٔ درمان باشد، نه فهرست آگهی.');
  lines.push(`تعداد نتیجه: ${res.total}`);
  if (cityBreakdown && cityBreakdown.length) lines.push(`موضوع‌های موجود در شهر خواسته‌شده: ${cityBreakdown.slice(0, 8).map(x => `${x.value} (${x.count})`).join('، ')}`);
  lines.push('');
  lines.push('=== آگهی‌های یافت‌شده (منبع یگانهٔ حقیقت) ===');
  if (!res.items.length) lines.push('(هیچ آگهی مطابقی وجود ندارد)');
  res.items.slice(0, MAX_CTX_ITEMS).forEach((it, i) => {
    const c = compact(it);
    lines.push(`${i + 1}. ${c.title} | شهر: ${c.city || 'نامشخص'} | استان: ${c.province || '—'} | نوع: ${c.kind} | سازمان: ${c.org} | منبع: ${c.source} | انتشار: ${c.published || '—'} | مهلت: ${c.deadline || '—'}${c.daysLeft != null ? ` (${c.daysLeft} روز)` : ''} | موضوع: ${c.topics.join('، ') || '—'}`);
    lines.push(`   نشانی: ${c.url}`);
  });
  if (res.total > MAX_CTX_ITEMS) lines.push(`(${res.total - MAX_CTX_ITEMS} آگهی دیگر هم هست ولی در این فهرست نیامده)`);
  if (alts && alts.length) {
    lines.push('');
    lines.push('=== نتایج با شرط‌های بازتر (اگر نتیجهٔ اصلی کم بود) ===');
    for (const a of alts) lines.push(`- ${a.label}: ${a.total} آگهی${a.sample.length ? ' — ' + a.sample.map(s => s.title).join(' | ') : ''}`);
  }
  if (res.dropped) {
    lines.push('');
    lines.push(`=== آمار فیلترها === حذف‌شده: شهر نامرتبط ${res.dropped.city}، موضوع نامرتبط ${res.dropped.dimension}، بیرون از بازه ${res.dropped.date}، بدون مهلت ${res.dropped.deadline}، خارج از تهران/البرز ${res.dropped.target}`);
  }
  if (diag) {
    lines.push('');
    lines.push('=== وضعیت منابع و ایرادها ===');
    lines.push(diagnoseDigest(diag));
    const act = diag.actions.slice(0, 6).map(a => a.label).filter(Boolean);
    if (act.length) lines.push(`اقدام‌های پیشنهادی: ${act.join(' · ')}`);
  }
  if (scan && scan.performed) lines.push(`\n=== اسکن زنده === در همین گفتگو ${scan.items} آگهی از ${scan.sources} منبع تازه‌سازی شد (${Math.round((scan.ms || 0) / 1000)} ثانیه).${scan.degraded ? ' ⚠️ همهٔ منابع خطا دادند (احتمالاً اجرا از بیرون ایران یا قطعی موقت) و دادهٔ قبلی حفظ شد.' : ''}`);
  return lines.join('\n');
}

const SYSTEM_PROMPT = `تو «دستیار رادار مناقصات» هستی؛ دستیار کاری بهزاد در حوزهٔ مناقصه و پیمانکاری عمرانی استان‌های تهران و البرز.

قواعد قطعی:
۱) فقط بر پایهٔ دادهٔ «آگهی‌های یافت‌شده» که در پیام کاربر می‌آید پاسخ بده. هیچ آگهی، سازمان، تاریخ، مهلت یا مبلغی از خودت نساز. اگر داده نیست، صریح بگو نیست.
۲) فارسی، راست‌به‌چپ، لحن کاری و بی‌حاشیه. بدون اموجی. بدون «سؤال خوبی بود» و بدون مقدمه‌چینی. هیچ واژهٔ غیرفارسی (انگلیسی/آلمانی/…) به کار نبر؛ فقط اصطلاحات جاافتاده مثل «مناقصه» و نشانی‌ها.
۳) ساختار اجباری پاسخ: خط اول یک جملهٔ جمع‌بندی با عدد (مثلاً: «۳ آگهی آسفالت در کرج پیدا شد.»)؛ سپس بخش «فهرست» با ردیف‌هایی به شکل «- **عنوان** — شهر · نوع · سازمان · مهلت»؛ سپس بخش «تحلیل» فقط اگر کاربر تحلیل خواسته یا بیش از ۵ نتیجه هست؛ سپس بخش «ایرادها» فقط اگر ایراد منبع در داده آمده باشد.
۴) اگر هیچ نتیجه‌ای نبود: بگو چرا (بر پایهٔ آمار فیلترها) و نزدیک‌ترین گزینه‌های بازتر را پیشنهاد بده. هرگز نتیجهٔ ساختگی نده.
۵) عددها را با ارقام فارسی بنویس. نشانی آگهی‌ها را عیناً همان‌طور که آمده ذکر کن.
۶) پاسخ کوتاه ولی کامل بنویس؛ حداکثر ۱۰ ردیف آگهی. پاسخ را نیمه‌کاره رها نکن.`;

// ---------- اعتبارسنجی پاسخ مدل ----------
const ALLOWED_LATIN = /^(https?|www|com|net|org|ir|php|html|aspx|api|rss|json|csv|id|ip|tender|tenders)$/;

/**
 * پاسخ مدل را می‌سنجد؛ اگر زبان یا ساختار ناسالم بود دلیلش را برمی‌گرداند.
 * هدف: جلوگیری از پاسخ نیمه‌فارسی، بی‌ربط یا ساختگیِ مدل‌های ضعیف.
 */
export function validateAnswer(text, { results = 0 } = {}) {
  const t = String(text || '').trim();
  if (t.length < 120) return 'پاسخ کوتاه‌تر از حد لازم';
  const clean = t.replace(/https?:\/\/\S+/g, ' ');
  const faChars = (clean.match(/[\u0600-\u06FF]/g) || []).length;
  const letters = (clean.match(/[A-Za-z\u0600-\u06FF]/g) || []).length || 1;
  if (faChars / letters < 0.85) return 'سهم حروف فارسی پایین است';
  const foreign = [...new Set((clean.match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase()))]
    .filter(w => !ALLOWED_LATIN.test(w));
  if (foreign.length > 1) return `واژهٔ غیرفارسی: ${foreign.slice(0, 3).join('، ')}`;
  if (!/(آگهی|مناقصه|مزایده|استعلام|فراخوان|منبع|شهر|موضوع|مهلت|نتیجه)/.test(t)) return 'بی‌ربط به حوزهٔ مناقصات';
  if (results === 0 && /(?:[۱-۹]|[1-9])\s*(?:آگهی|مورد)[^\n]{0,30}(?:یافت|پیدا)/.test(t)) return 'ادعای وجود آگهی در حالی که نتیجه صفر است';
  return null;
}

// ---------- اجرای اقدام‌های درمان ----------
/**
 * @param {Array} actions فهرست اقدام‌ها
 * @param {{registry:object, saveRegistry:Function, reloadRegistry:Function, runScan:Function, detectSource:Function, scheduleInterval:Function}} ctx
 */
export async function runActions(actions, ctx, onEvent = () => {}) {
  const out = [];
  let reg = ctx.reloadRegistry ? ctx.reloadRegistry() : ctx.registry;

  for (const a of actions) {
    const rec = { action: a, ok: false, detail: '' };
    try {
      if (a.kind === 'rescan') {
        const lbl = a.label || a.sourceId;
        onEvent({ type: 'step', id: 'repair-' + a.sourceId, label: lbl, status: 'run' });
        const r = await ctx.runScan({ onlySourceIds: [a.sourceId] });
        rec.ok = !!r.ok;
        rec.detail = r.ok ? `${faNum(r.total)} آگهی` : (r.error || 'خطا');
        onEvent({ type: 'step', id: 'repair-' + a.sourceId, status: rec.ok ? 'done' : 'fail', detail: rec.detail });
      } else if (a.kind === 'rescan-all') {
        onEvent({ type: 'step', id: 'repair-all', label: 'اسکن کامل منابع', status: 'run' });
        const r = await ctx.runScan({});
        rec.ok = !!r.ok;
        rec.detail = r.ok ? `${faNum(r.total)} آگهی از ${faNum(r.sourcesOk)} منبع سالم` : (r.error || 'خطا');
        onEvent({ type: 'step', id: 'repair-all', status: rec.ok ? 'done' : 'fail', detail: rec.detail });
      } else if (a.kind === 'enable' || a.kind === 'disable') {
        const src = (reg.sources || []).find(s => s.id === a.sourceId);
        if (src) { src._disabled = a.kind === 'disable'; ctx.saveRegistry(reg); rec.ok = true; rec.detail = a.kind === 'enable' ? 'روشن شد' : 'خاموش شد'; }
        else rec.detail = 'منبع پیدا نشد';
      } else if (a.kind === 'set-url') {
        const src = (reg.sources || []).find(s => s.id === a.sourceId);
        if (src && a.payload && a.payload.url) { src.url = a.payload.url; ctx.saveRegistry(reg); rec.ok = true; rec.detail = `نشانی به ${a.payload.url} تغییر کرد`; }
        else rec.detail = 'منبع یا نشانی نامعتبر';
      } else if (a.kind === 'setting') {
        reg.settings = { ...(reg.settings || {}), ...(a.payload || {}) };
        ctx.saveRegistry(reg);
        if (ctx.scheduleInterval) ctx.scheduleInterval();
        rec.ok = true;
        rec.detail = Object.entries(a.payload || {}).map(([k, v]) => `${k}=${v}`).join('، ');
      } else if (a.kind === 'redetect') {
        const src = (reg.sources || []).find(s => s.id === a.sourceId);
        if (!src) { rec.detail = 'منبع پیدا نشد'; }
        else {
          onEvent({ type: 'step', id: 'detect-' + a.sourceId, label: `شناسایی مجدد ${src.name}`, status: 'run' });
          const rep = await ctx.detectSource(src.url, { timeout: 25000 });
          if (rep && rep.reachable) {
            const before = { adapter: src.adapter, pages: src.pages };
            if (rep.adapter && rep.adapter !== src.adapter) src.adapter = rep.adapter;
            if (rep.pages && rep.pages.length) src.pages = rep.pages.slice(0, 8);
            if (rep.feeds && rep.feeds.length) src.feeds = rep.feeds.slice(0, 4);
            ctx.saveRegistry(reg);
            rec.ok = true;
            rec.detail = `روش: ${before.adapter} → ${src.adapter}${rep.pages && rep.pages.length ? ` · ${rep.pages.length} مسیر` : ''}${rep.sampleCount ? ` · ${rep.sampleCount} نمونهٔ آگهی` : ''}`;
          } else {
            rec.detail = rep && rep.error ? `سایت در دسترس نبود: ${rep.error}` : 'سایت پاسخ نداد';
          }
          onEvent({ type: 'step', id: 'detect-' + a.sourceId, status: rec.ok ? 'done' : 'fail', detail: rec.detail });
        }
      } else {
        rec.detail = 'اقدام ناشناخته';
      }
    } catch (e) {
      rec.detail = String(e && e.message || e);
    }
    out.push(rec);
  }
  return out;
}

// ---------- راهنما ----------
function helpAnswer(reg, cache) {
  const active = (reg.sources || []).filter(s => !s._disabled);
  const cities = [...new Set(active.map(s => s.city).filter(Boolean))];
  const topics = (reg.topics || []).filter(t => !t._disabled).map(t => t.name);
  const items = cache.items || [];
  const L = [];
  L.push('سلام. من دستیار رادار مناقصات‌ام. سه کار اصلی می‌کنم:');
  L.push('');
  L.push('**۱) پیدا کردن دقیق آگهی با شهر و موضوع** — درخواست را به زبان خودت بنویس؛ شهر، موضوع، نوع آگهی و بازهٔ زمانی را از متن می‌فهمم و با فیلتر سخت جست‌وجو می‌کنم.');
  L.push('- «مناقصه آسفالت کرج این هفته»');
  L.push('- «جدول‌گذاری و کفپوش فردیس»');
  L.push('- «مزایده‌های مهلت‌دار فوری تهران»');
  L.push('- «asphalt karaj» (واژهٔ لاتین هم می‌فهمم)');
  L.push('');
  L.push('**۲) تازه‌سازی و تحلیل** — اگر داده کهنه باشد یا بگویی «بروز/جدید»، همان لحظه منابع مرتبط را اسکن می‌کنم؛ بعد آمار می‌دهم: توزیع شهری، نوع آگهی، مهلت‌های نزدیک، پرتکرارترین کارفرماها.');
  L.push('- «چند تا آگهی فضای سبز داریم؟ تحلیل کن»');
  L.push('- «بروزرسانی کن و آگهی‌های امروز را بگو»');
  L.push('');
  L.push('**۳) رفع ایراد منابع** — منابعی که خطا می‌دهند، صفر آگهی برمی‌گردانند، به سقف خورده‌اند یا نشانی‌شان اشتباه است را تشخیص می‌دهم و نسخهٔ درمان می‌دهم؛ با یک کلیک اجرا می‌شود.');
  L.push('- «منابع چه ایرادی دارند؟»');
  L.push('- «منابع خطادار را درست کن»');
  L.push('');
  L.push('**وضعیت فعلی:**');
  L.push(`- ${faNum(active.length)} منبع فعال${cities.length ? ` در ${faNum(cities.length)} شهر (${cities.slice(0, 8).join('، ')}${cities.length > 8 ? ' …' : ''})` : ''}`);
  L.push(`- ${faNum(items.length)} آگهی در حافظه${cache.scannedAt ? ` — آخرین اسکن ${faNum(Math.round((Date.now() - Date.parse(cache.scannedAt)) / 60000))} دقیقه پیش` : ''}`);
  if (topics.length) L.push(`- موضوعات آماده: ${topics.slice(0, 10).join('، ')}${topics.length > 10 ? ' …' : ''}`);
  L.push('');
  L.push('هر وقت خواستی، همین‌جا بنویس. اگر موضوعی را نشناسم، می‌گویم و پیشنهاد نزدیک‌ترین گزینه را می‌دهم.');
  return L.join('\n');
}

// ---------- اجرای اصلی ----------
/**
 * @param {{text:string, opts?:object, ctx:object, emit:Function}} args
 */
export async function runAssistant({ text, opts = {}, ctx, emit = () => {} }) {
  const t0 = Date.now();
  const settings = (ctx.reloadRegistry ? ctx.reloadRegistry() : ctx.registry).settings || {};
  let reg = ctx.reloadRegistry ? ctx.reloadRegistry() : ctx.registry;
  let cache = ctx.reloadCache ? ctx.reloadCache() : ctx.cache;
  let items = cache.items || [];

  const step = (id, label, status = 'run', detail = '') => emit({ type: 'step', id, label, status, detail });

  // ۱) فهم درخواست
  step('parse', 'تحلیل درخواست', 'run');
  const intent = parseQuery(text, reg);
  step('parse', 'تحلیل درخواست', 'done', intentSummary(intent).map(s => `${s.k} ${s.v}`).join(' · ') || 'بدون قید مشخص');
  emit({ type: 'intent', summary: intentSummary(intent), intent: { cities: intent.cities, provinces: intent.provinces, topicIds: intent.topicIds, kinds: intent.kinds, days: intent.days, timeLabel: intent.timeLabel, hasDeadline: intent.hasDeadline, deadlineWithin: intent.deadlineWithin, wantsAnalysis: intent.wantsAnalysis, wantsRepair: intent.wantsRepair, sort: intent.sort } });

  // ۱.۵) راهنما / سلام — بدون جست‌وجو
  const helpMode = intent.wantsHelp
    || (!intent.requiresTextMatch && !intent.cities.length && !intent.provinces.length
      && !intent.kinds.length && !intent.days && !intent.dateFrom
      && /(سلام|درود|خوبی|هستی|وقت بخیر)/.test(intent.norm));
  if (helpMode) {
    step('help', 'راهنمای دستیار', 'done', '');
    const ans = helpAnswer(reg, cache);
    emit({ type: 'results', total: 0, items: [], alternatives: [], scannedAt: cache.scannedAt, itemCount: items.length });
    emit({ type: 'answer', text: ans, deterministic: true, model: null });
    const hMeta = { ms: Date.now() - t0, aiUsed: false, model: null, results: 0, shown: 0, dropped: null, alternatives: [], scanned: { performed: false }, diagnostics: null, cacheAgeMinutes: Math.round(cacheAgeMinutes(cache)), itemCount: items.length, help: true };
    emit({ type: 'done', meta: hMeta });
    return { answer: ans, intent, res: { total: 0, items: [], all: [], dropped: {} }, alts: [], diag: null, meta: hMeta };
  }

  // ۲) تازه‌سازی زنده
  const freshMinutes = Number(opts.freshMinutes ?? FRESH_MINUTES_DEFAULT);
  const ageMinutes = cacheAgeMinutes(cache);
  const scan = { performed: false, items: 0, sources: 0, ms: 0, reason: '' };
  const wantScan = opts.fresh === true
    || (opts.fresh !== false && (intent.wantsFresh || ageMinutes > freshMinutes));
  if (wantScan && !ctx.isScanning()) {
    const picks = pickSources(reg, intent, { max: intent.cities.length ? 10 : 8 });
    const reason = opts.fresh === true ? 'به‌درخواست' : intent.wantsFresh ? 'درخواست تازه‌سازی' : `کهنگی داده (${Math.round(ageMinutes)} دقیقه)`;
    step('scan', `به‌روزرسانی زندهٔ ${faNum(picks.length)} منبع`, 'run', reason);
    const st = Date.now();
    const r = await ctx.runScan({
      onlySourceIds: picks.map(s => s.id),
      onProgress: p => emit({ type: 'progress', done: p.done, total: p.total, current: p.source, count: p.count }),
    });
    scan.performed = !!r.ok;
    scan.ms = Date.now() - st;
    scan.items = r.total || 0;
    scan.sources = picks.length;
    scan.reason = reason;
    const degraded = !!r.ok && (r.sourcesOk || 0) === 0 && (r.sourcesFailed || 0) > 0;
    scan.degraded = degraded;
    step('scan',
      r.ok
        ? (degraded
          ? `به‌روزرسانی ناموفق — هر ${faNum(picks.length)} منبع خطا دادند (دادهٔ قبلی حفظ شد)`
          : `داده تازه شد (${faNum(r.total || 0)} آگهی از ${faNum(picks.length)} منبع)`)
        : `به‌روزرسانی ناموفق: ${r.error || 'خطا'}`,
      r.ok && !degraded ? 'done' : 'fail', `${Math.round(scan.ms / 1000)} ثانیه`);
    if (r.ok) {
      reg = ctx.reloadRegistry ? ctx.reloadRegistry() : reg;
      cache = ctx.reloadCache ? ctx.reloadCache() : cache;
      items = cache.items || [];
    }
  } else if (wantScan && ctx.isScanning()) {
    step('scan', 'اسکن در جریان است — با دادهٔ فعلی ادامه می‌دهم', 'done');
  }

  // ۳) جست‌وجو
  // حالت «پرسش از منابع»: کاربر دنبال آگهی نیست، دنبال وضعیت منابع است
  const metaMode = intent.wantsRepair
    && !intent.cities.length && !intent.topicIds.length && !intent.kinds.length
    && !intent.days && !intent.dateFrom
    && intent.freeTerms.every(t => /منبع|منابع|سایت|سلامت|ایراد|مشکل|خطا|پوشش|خالی|کار|چرا|وضعیت|خراب|دارن|دارین|دارد|هست|چیه|چیست|چی|بده|بگو/.test(t));

  step('search', 'جست‌وجوی ربط‌محور', 'run');
  const targetOnly = settings.targetOnly !== false && !intent.wantsAllCountry;
  const searchOpts = {
    limit: intent.limit,
    targetProvinces: targetOnly && !intent.cities.length && !intent.provinces.length ? ['تهران', 'البرز'] : null,
  };
  let res = metaMode
    ? { total: 0, items: [], all: [], dropped: { city: 0, kind: 0, date: 0, deadline: 0, score: 0, expired: 0, target: 0, dimension: 0 }, minRel: 0, hasStructured: false }
    : searchItems(items, intent, searchOpts);
  step('search', metaMode ? 'پرسش دربارهٔ منابع — جست‌وجوی آگهی لازم نیست' : 'جست‌وجوی ربط‌محور', 'done', metaMode ? '' : `${faNum(res.total)} نتیجه از ${faNum(items.length)} آگهی`);

  // ۴) بازکردن تدریجی قیدها
  const alts = [];
  let cityBreakdown = null;
  if (!metaMode && res.total < 3) {
    step('widen', 'بازکردن قیدها برای یافتن نزدیک‌ترین نتایج', 'run');
    const variants = [];
    if (intent.freeTerms.length || intent.topicIds.length) {
      variants.push({
        label: intent.cities.length ? `همان شهر (${intent.cities.join('، ')}) بدون محدودیت موضوع` : 'بدون محدودیت موضوع',
        intent: { ...intent, freeTerms: [], freeTermsDisplay: [], termMap: new Map(), expanded: [], phrases: [], topicIds: [], topicHits: [], synonymGroups: [], requiresTextMatch: false, limit: 5 },
        opts: { ...searchOpts, limit: 5 },
      });
    }
    if (intent.cities.length) {
      variants.push({
        label: 'همان موضوع در کل استان‌های تهران و البرز',
        intent: { ...intent, cities: [], citiesDetail: [], provinces: [], strictCity: false, limit: 5 },
        opts: { limit: 5, targetProvinces: ['تهران', 'البرز'] },
      });
    }
    if (intent.days != null || intent.dateFrom || intent.dateTo) {
      variants.push({
        label: 'بدون محدودیت بازهٔ زمانی',
        intent: { ...intent, days: null, timeLabel: '', dateFrom: null, dateTo: null, limit: 5 },
        opts: { ...searchOpts, limit: 5 },
      });
    }
    if (intent.kinds.length || intent.softKinds.length || intent.excludeKinds.length) {
      variants.push({
        label: 'همهٔ انواع آگهی (مناقصه، مزایده، استعلام…)',
        intent: { ...intent, kinds: [], softKinds: [], excludeKinds: [], strictKind: false, limit: 5 },
        opts: { ...searchOpts, limit: 5 },
      });
    }
    if (intent.hasDeadline || intent.deadlineWithin != null) {
      variants.push({
        label: 'بدون قید مهلت (شامل آگهی‌های بدون مهلت اعلام‌شده)',
        intent: { ...intent, hasDeadline: false, deadlineWithin: null, hideExpired: false, limit: 5 },
        opts: { ...searchOpts, limit: 5 },
      });
    }
    if (intent.sort !== 'newest') {
      variants.push({
        label: 'همان شرط‌ها با ترتیب جدیدترین',
        intent: { ...intent, sort: 'newest', limit: 5 },
        opts: { ...searchOpts, limit: 5 },
      });
    }
    // اگر همهٔ قیدها با هم صفر دادند، آخرین تلاش: فقط «شهر/استان»
    for (const v of variants) {
      const r = searchItems(items, v.intent, v.opts);
      if (r.total > 0) alts.push({ label: v.label, total: r.total, sample: r.items.slice(0, 2).map(x => ({ title: x.title, city: x.city, deadline: x.deadlineJalali || x.deadlineISO || '' })) });
    }
    if (!alts.length && (intent.cities.length || intent.provinces.length)) {
      const relaxed = {
        ...intent,
        kinds: [], softKinds: [], excludeKinds: [], strictKind: false,
        hasDeadline: false, deadlineWithin: null, hideExpired: false,
        freeTerms: [], freeTermsDisplay: [], termMap: new Map(), expanded: [], phrases: [],
        topicIds: [], topicHits: [], synonymGroups: [], requiresTextMatch: false,
        days: null, timeLabel: '', dateFrom: null, dateTo: null, sort: 'newest', limit: 5,
      };
      const r = searchItems(items, relaxed, { limit: 5, targetProvinces: null });
      if (r.total > 0) {
        alts.push({
          label: `فقط آگهی‌های ${[...intent.cities, ...intent.provinces].join('، ')} (بدون قید موضوع/نوع/مهلت/بازه)`,
          total: r.total,
          sample: r.items.slice(0, 2).map(x => ({ title: x.title, city: x.city, deadline: x.deadlineJalali || x.deadlineISO || '' })),
        });
      }
    }
    // اگر شهر مشخص است ولی موضوع جواب نداد: بگو در آن شهر چه موضوع‌هایی موجود است
    if (intent.cities.length) {
      const inCity = items.filter(it => intent.cities.includes(it.city) || intent.cities.some(c => textHasCity(it, c)));
      if (inCity.length) {
        const m = new Map();
        for (const it of inCity) for (const t of (it.topics && it.topics.length ? it.topics : ['بدون موضوع'])) m.set(t, (m.get(t) || 0) + 1);
        cityBreakdown = [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
      }
    }
    step('widen', 'بازکردن قیدها برای یافتن نزدیک‌ترین نتایج', 'done', alts.length ? `${faNum(alts.length)} حالت جایگزین با نتیجه` : 'گزینهٔ بازتری هم نتیجه نداد');
  }

  // ۵) تشخیص ایراد منابع
  let diag = null;
  const shouldDiagnose = metaMode || intent.wantsRepair || res.total === 0 || alts.length === 0 || (opts.diagnose === true);
  if (shouldDiagnose) {
    step('diagnose', 'بررسی سلامت منابع و پوشش', 'run');
    diag = diagnose(reg, cache);
    step('diagnose', 'بررسی سلامت منابع و پوشش', 'done',
      `${faNum(diag.summary.sourcesOk)} سالم · ${faNum(diag.summary.sourcesFailed)} خطا · ${faNum(diag.summary.sourcesEmpty)} خالی · ${faNum(diag.coverage.length)} ایراد پوششی`);
    if (diag.actions.length) emit({ type: 'actions', actions: diag.actions.slice(0, 8) });
  }

  // ۶) تولید پاسخ
  if (!metaMode) emit({ type: 'results', total: res.total, items: res.items.map(compact), alternatives: alts, scannedAt: cache.scannedAt, itemCount: items.length });

  const fallback = deterministicAnswer({ text, intent, res, alts, diag, scan, metaMode, cityBreakdown, settings: { ageMinutes } });
  let answer = fallback;
  let model = null;
  let aiUsed = false;

  const cfg = loadConfig();
  // با نتیجهٔ صفر، پاسخ ساخت‌یافته دقیق‌تر و سریع‌تر از مدل است (آمار فیلترها + جایگزین‌ها).
  // مدل زبانی فقط جایی که واقعاً چیزی برای «بیان» هست (نتایج موجود، یا گزارش منابع) صدا زده می‌شود.
  const tryLlm = cfg.enabled && opts.noAi !== true && (res.total >= 1 || metaMode);
  if (tryLlm) {
    step('answer', 'تنظیم پاسخ', 'run');
    const contextBlock = buildContext({ text, intent, res, alts, diag, scan, metaMode, cityBreakdown });
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contextBlock },
    ];
    let streamed = '';
    try {
      const r = await chatStream({
        messages,
        maxTokens: Math.min(cfg.maxTokens || 1400, 1800),
        onDelta: d => { streamed += d; emit({ type: 'delta', text: d }); },
      });
      const candidate = (r.ok && r.text ? r.text : streamed).trim();
      const problem = candidate ? validateAnswer(candidate, { results: res.total }) : 'پاسخی از مدل نرسید';
      if (!problem) {
        answer = candidate;
        model = r.model;
        aiUsed = true;
        step('answer', 'تنظیم پاسخ', 'done', r.model);
      } else {
        step('answer', 'تنظیم پاسخ', 'fail', `پاسخ مدل پذیرفته نشد (${problem}) — پاسخ ساخت‌یافته ارائه شد`);
        if (streamed) emit({ type: 'answer-reset' });
      }
    } catch (e) {
      step('answer', 'تنظیم پاسخ', 'fail', String(e && e.message || e));
      if (streamed) emit({ type: 'answer-reset' });
    }
  }

  const meta = {
    ms: Date.now() - t0,
    aiUsed,
    model,
    results: res.total,
    shown: res.items.length,
    dropped: res.dropped,
    alternatives: alts,
    scanned: scan,
    diagnostics: diag ? {
      summary: diag.summary,
      coverage: diag.coverage,
      actions: diag.actions.slice(0, 8),
      sources: diag.sources
        .filter(s => s.issue && s.issue.type !== 'DISABLED' && s.severity !== 'low')
        .slice(0, 12)
        .map(s => ({ id: s.id, name: s.name, type: s.issue.type, severity: s.severity, title: s.issue.title, hint: s.issue.hint, count: s.count })),
    } : null,
    cacheAgeMinutes: Math.round(cacheAgeMinutes(cache)),
    itemCount: items.length,
  };
  emit({ type: 'answer', text: answer, deterministic: !aiUsed, model });
  emit({ type: 'done', meta });
  return { answer, intent, res, alts, diag, meta };
}
