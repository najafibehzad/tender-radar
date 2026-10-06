// lib/search.mjs — موتور تحلیل درخواست و جست‌وجوی ربط‌محور
//
// دو کار انجام می‌دهد:
//   ۱) parseQuery: درخواست زبان طبیعی فارسی → قصد ساخت‌یافته (شهر، موضوع، نوع، بازه، مهلت…)
//   ۲) searchItems: فهرست آگهی‌ها → نتایج امتیازدهی‌شده با دلیل تطبیق
//
// اصل طراحی:
//   • «ربط» (rel) = تطبیق متن/موضوع/موقعیت/نوع — مبنای **فیلتر** (دقت)
//   • «پاداش» (bonus) = تازگی و فوریت مهلت — فقط مبنای **ترتیب** (نه عبور از آستانه)
//   • فیلترهای ساخت‌یافته (شهر/نوع/بازه) سخت‌اند تا نتیجهٔ درخواست «دقیق» باشد.
import {
  normalizeFa, foldForSearch, toAsciiDigits, parseAnyDate, todayTehran, daysUntil,
  jalaliToGregorian, isoToJalali, DEFAULT_TOPICS,
} from './text.mjs';
import { CITIES, PROVINCES, provinceOf } from './cities.mjs';
import {
  LATIN_MAP, expandTerms, groupsInText, GROUP_NAME, fuzzyContains,
  findPhrases, displayTerm,
} from './lexicon.mjs';

const pad = n => String(n).padStart(2, '0');
const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- واژه‌های بی‌اثر در جستجو ----------
export const STOPWORDS = new Set([
  'میخوام', 'میخواهم', 'می', 'خوام', 'خواهم', 'بده', 'بدهید', 'بدید', 'لیست', 'فهرست', 'نشون', 'نشان',
  'دنبال', 'هستم', 'داریم', 'داره', 'دارد', 'دارند', 'دار', 'دارا', 'دارای', 'هست', 'هستند', 'کدام',
  'کدوم', 'چی', 'چیا', 'چه', 'برای', 'در', 'از', 'به', 'با', 'و', 'یا', 'که', 'این', 'آن', 'یک', 'هم',
  'رو', 'را', 'توی', 'داخل', 'شهر', 'شهرستان', 'استان', 'محدوده', 'حوزه', 'جدید', 'جدیدا', 'جدیدترین',
  'تازه', 'آگهی', 'اگهی', 'آگهیها', 'اگهیها', 'آگهیهای', 'اگهیهای', 'اطلاع', 'اطلاعات', 'خبر', 'اخبار',
  'مورد', 'موارد', 'عدد', 'فقط', 'همه', 'کل', 'تمام', 'بیشتر', 'کمتر', 'نیاز', 'لطفا', 'ممنون', 'سلام',
  'میشه', 'میشود', 'میتونی', 'میتونم', 'کمک', 'وضعیت', 'گزارش', 'تحلیل', 'آمار', 'بررسی', 'پیدا', 'کن',
  'کنید', 'بگرد', 'جستجو', 'جست', 'جو', 'اسکن', 'چک', 'بروز', 'بروزرسانی', 'زنده', 'الان', 'همین', 'حالا',
  'بعد', 'قبل', 'روز', 'روزه', 'هفته', 'ماه', 'ماهه', 'سال', 'گذشته', 'اخیر', 'آینده', 'مهلت', 'فرصت',
  'بدون', 'غیر', 'بجز', 'بغیر', 'نه', 'نیست', 'چند', 'چندتا', 'چندتایی', 'همش', 'همشون', 'خلاصه', 'بگو',
  'بگید', 'بیار', 'بیارید', 'بفرست', 'مقایسه', 'پروژه', 'پروژههای', 'پروژهها', 'طرح', 'طرحها', 'طرحهای',
  'فوری', 'فوریت', 'مهلتدار', 'مهلتداره', 'مهلتدار', 'گیری', 'گذاری', 'سازی', 'ریزی', 'کشی', 'بندی',
  'کاری', 'امور', 'انجام', 'اجرا', 'مربوط', 'موضوع', 'موضوعات', 'زمینه', 'حال', 'طور', 'طوریکه', 'چطور',
  'چیکار', 'چهکار', 'میتونید', 'بتون', 'بتوان', 'باشد', 'باشه', 'بشه', 'شد', 'شده', 'بوده', 'نیست',
  'دارن', 'دارین', 'دارید', 'هستن', 'نیستن', 'چیه', 'چیست', 'چندتاست', 'کی', 'کجا', 'چطوری',
]);

const KIND_WORDS = [
  { kind: 'مناقصه', re: /مناقص(ه|ات|هها|هٔ|های)/, hard: true },
  { kind: 'مزایده', re: /مزاید(ه|ات|هها|های)/, hard: true },
  { kind: 'استعلام', re: /استعلام(ات|ها|های| بها)?/, hard: true },
  { kind: 'فراخوان', re: /فراخوان(ها|های)?/, hard: true },
  { kind: 'خرید', re: /(خرید|تدارکات|واگذاری)/, hard: false },
];

// ---------- بازه‌های زمانی ----------
const TIME_RULES = [
  { re: /(امروز و دیروز|دو روز اخیر|۲ روز|2 روز)/, days: 2, label: '۲ روز اخیر' },
  { re: /امروز/, days: 1, label: 'امروز' },
  { re: /دیروز/, days: 2, label: 'دیروز' },
  { re: /(سه روز|۳ روز|3 روز)/, days: 3, label: '۳ روز اخیر' },
  { re: /(پنج روز|۵ روز|5 روز)/, days: 5, label: '۵ روز اخیر' },
  { re: /(یک هفته|یه هفته|هفت روز|۷ روز|7 روز|این هفته|هفته جاری|هفته گذشته|هفتهٔ گذشته|هفته اخیر)/, days: 7, label: 'یک هفته اخیر' },
  { re: /(ده روز|۱۰ روز|10 روز)/, days: 10, label: '۱۰ روز اخیر' },
  { re: /(دو هفته|۲ هفته|14 روز|۱۴ روز)/, days: 14, label: 'دو هفته اخیر' },
  { re: /(یک ماه|یه ماه|ماه گذشته|ماه جاری|این ماه|ماه اخیر|۳۰ روز|30 روز|سی روز)/, days: 30, label: 'یک ماه اخیر' },
  { re: /(دو ماه|۲ ماه|۶۰ روز|60 روز|شصت روز)/, days: 60, label: 'دو ماه اخیر' },
  { re: /(سه ماه|۳ ماه|۹۰ روز|90 روز|فصل|سه ماهه)/, days: 90, label: 'سه ماه اخیر' },
  { re: /(شش ماه|۶ ماه|۱۸۰ روز|180 روز|نیم سال)/, days: 180, label: 'شش ماه اخیر' },
  { re: /(یک سال|یه سال|سال گذشته|۱۲ ماه|12 ماه)/, days: 365, label: 'یک سال اخیر' },
];

const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

/** بازهٔ یک ماه شمسی (ISO) */
function jalaliMonthRange(jy, jm) {
  const g1 = jalaliToGregorian(jy, jm, 1);
  const jy2 = jm === 12 ? jy + 1 : jy;
  const jm2 = jm === 12 ? 1 : jm + 1;
  const g2 = jalaliToGregorian(jy2, jm2, 1);
  return { from: `${g1.gy}-${pad(g1.gm)}-${pad(g1.gd)}`, to: `${g2.gy}-${pad(g2.gm)}-${pad(g2.gd)}` };
}

// ---------- تشخیص موقعیت ----------
const LOC_INDEX = CITIES.flatMap(c =>
  [c.name, ...(c.aliases || [])].map(a => ({ fold: foldForSearch(a), city: c.name, province: c.province, alias: a }))
).filter(e => e.fold.length >= 3).sort((a, b) => b.fold.length - a.fold.length);

const PROV_INDEX = PROVINCES.map(p => ({ fold: foldForSearch(p), name: p })).sort((a, b) => b.fold.length - a.fold.length);

/**
 * همهٔ شهرها/استان‌های ذکرشده در متن (با مصرف بازه تا تطبیق تکراری/زیرمجموعه نشود).
 */
export function findLocations(text) {
  const f = foldForSearch(text);
  if (!f) return { cities: [], provinces: [], matched: [] };
  const taken = new Array(f.length).fill(false);
  const free = (s, e) => { for (let i = s; i < e; i++) if (taken[i]) return false; return true; };
  const mark = (s, e) => { for (let i = s; i < e; i++) taken[i] = true; };

  const cities = [];
  const matched = [];
  for (const e of LOC_INDEX) {
    const idx = f.indexOf(e.fold);
    if (idx === -1) continue;
    if (!free(idx, idx + e.fold.length)) continue;
    mark(idx, idx + e.fold.length);
    if (!cities.some(c => c.name === e.city)) cities.push({ name: e.city, province: e.province, matched: e.alias });
    matched.push(e.alias);
  }
  const provinces = [];
  for (const p of PROV_INDEX) {
    const idx = f.indexOf(p.fold);
    if (idx === -1) continue;
    if (!free(idx, idx + p.fold.length)) continue;
    mark(idx, idx + p.fold.length);
    provinces.push({ name: p.name, matched: p.name });
    matched.push(p.name);
  }
  return { cities, provinces, matched };
}

/**
 * آیا متن آگهی به این شهر اشاره می‌کند؟ (با مرز واژه — جلوگیری از «شهریاری» ≡ «شهریار»)
 * برای آگهی‌های تجمیع‌کننده که فیلد شهر خالی دارند.
 */
export function textHasCity(it, cityName) {
  const spaced = normalizeFa(`${it.title || ''} ${it.description || ''} ${it.org || ''} ${it.locationRaw || ''}`);
  if (!spaced) return false;
  const entry = CITIES.find(c => c.name === cityName);
  const names = [cityName, ...((entry && entry.aliases) || [])];
  for (const n of names) {
    const nf = normalizeFa(n);
    if (nf.length < 3) continue;
    const re = new RegExp(`(?:^|[\\s،,:;()\\[\\]{}«»"\\-–—/])${rxEsc(nf)}(?:$|[\\s،,:;()\\[\\]{}«»"\\-–—/])`, 'u');
    if (re.test(spaced)) return true;
  }
  return false;
}

// ---------- وزن‌دهی موضوع ----------
/** واژه‌های عمومی که تنها بودنشان موضوع را معتبر نمی‌کند */
const TOPIC_GENERIC = new Set([
  'معابر', 'پروژه', 'پروژهها', 'پروژههای', 'خدمات', 'تامین', 'تأمین', 'اجرا', 'انجام', 'سطح', 'شهر',
  'عمومی', 'تجهیز', 'نگهداری', 'ساخت', 'خرید', 'طرح', 'کار', 'امور', 'احداث', 'بهسازی', 'توسعه',
  'تجهیزات', 'نیرو', 'شهری', 'منطقه', 'منطقهای', 'روستایی', 'عملیات', 'نگهداشت', 'راه', 'راهها',
]);

function topicWeight(w) {
  const f = foldForSearch(w);
  if (f.length < 4) return 0;
  if (TOPIC_GENERIC.has(normalizeFa(w))) return 0;
  return f.length - 2;
}

// ---------- تحلیل درخواست ----------
export function parseQuery(text, registry = {}) {
  const raw = String(text || '').trim();
  const topics = (registry.topics && registry.topics.length ? registry.topics : DEFAULT_TOPICS).filter(t => !t._disabled);

  // ۱) واژه‌های لاتین → فارسی
  const latinMapped = raw.replace(/[A-Za-z][A-Za-z0-9_+-]*/g, m => {
    const k = m.toLowerCase();
    return LATIN_MAP[k] ? ` ${LATIN_MAP[k]} ` : ` ${m} `;
  });
  const norm = normalizeFa(latinMapped);
  const f = foldForSearch(latinMapped);
  const notes = [];

  // ۲) استثناها
  const excludeTerms = [];
  const excludeKinds = [];
  for (const m of norm.matchAll(/(?:بدون|بجز|بغیر از|غیر از|غیر|نه)\s+([^\s،,]+)/g)) {
    const w = m[1];
    const k = KIND_WORDS.find(k => k.re.test(w));
    if (k) { if (!excludeKinds.includes(k.kind)) excludeKinds.push(k.kind); }
    else excludeTerms.push(w);
  }
  for (const m of norm.matchAll(/([^\s،,]+)\s+(?:نه|نباشه|نمیخوام|نمیخواهم|نخواستم)\b/g)) {
    const k = KIND_WORDS.find(k => k.re.test(m[1]));
    if (k) { if (!excludeKinds.includes(k.kind)) excludeKinds.push(k.kind); }
    else excludeTerms.push(m[1]);
  }
  const onlyKinds = /(فقط|صرفا|صرفاً)/.test(norm);

  // ۳) نوع آگهی (سخت = فیلتر، نرم = ترجیح)
  let kinds = [];
  let softKinds = [];
  for (const k of KIND_WORDS) {
    if (!k.re.test(norm)) continue;
    if (k.hard) kinds.push(k.kind); else softKinds.push(k.kind);
  }
  kinds = [...new Set(kinds)].filter(k => !excludeKinds.includes(k));
  softKinds = [...new Set(softKinds)].filter(k => !excludeKinds.includes(k) && !kinds.includes(k));

  // ۴) بازهٔ زمانی
  let days = null;
  let timeLabel = '';
  let dateFrom = null;
  let dateTo = null;

  const rangeM = norm.match(/از\s*([^\s]+(?:\s+[^\s]+)?)\s*تا\s*([^\s]+(?:\s+[^\s]+)?)/);
  if (rangeM) {
    const a = parseAnyDate(rangeM[1]);
    const b = parseAnyDate(rangeM[2]);
    if (a.iso) dateFrom = a.iso;
    if (b.iso) dateTo = b.iso;
    if (a.iso || b.iso) timeLabel = `${a.jalali || '—'} تا ${b.jalali || '—'}`;
  }
  if (!dateFrom && !dateTo) {
    for (const r of TIME_RULES) { if (r.re.test(norm)) { days = r.days; timeLabel = r.label; break; } }
  }
  if (!days && !dateFrom && !dateTo) {
    for (let i = 0; i < J_MONTHS.length; i++) {
      const name = J_MONTHS[i];
      if (!new RegExp(`(?:^|\\s)${name}(?:ماه|\\s|$)`).test(norm)) continue;
      const jNow = toAsciiDigits(todayTehran().jalali).split('/').map(Number);
      const year = i + 1 > jNow[1] ? jNow[0] - 1 : jNow[0];
      const r = jalaliMonthRange(year, i + 1);
      dateFrom = r.from; dateTo = r.to;
      timeLabel = `${name} ${year}`;
      break;
    }
  }

  // ۵) مهلت
  let hasDeadline = false;
  let deadlineWithin = null;
  let hideExpired = false;
  if (/(مهلت|فرصت)\s*(داره|دارد|دارند|دارای|هست|داریم)/.test(norm) || /دارای مهلت/.test(norm)) hasDeadline = true;
  const dm = norm.match(/(?:مهلت|فرصت)[^\d]{0,12}(\d{1,3})\s*روز/);
  if (dm) { deadlineWithin = +toAsciiDigits(dm[1]); hasDeadline = true; }
  if (/(فوری|فوریت|مهلت نزدیک|نزدیک ?ترین مهلت|کمترین مهلت|مهلت کم|آخرین فرصت|رو به اتمام|زودتر تموم|در حال اتمام)/.test(norm)) {
    deadlineWithin = deadlineWithin ?? 5; hasDeadline = true;
  }
  if (/(منقضی|گذشته|تموم شده|تمام شده|باطل|به پایان رسیده)/.test(norm)) hideExpired = false;
  else if (deadlineWithin != null) hideExpired = true;

  // ۶) ترتیب
  let sort = 'newest';
  if (/(نزدیک ?ترین مهلت|کمترین مهلت|زودترین مهلت|مهلت نزدیک)/.test(norm)) sort = 'deadline';
  else if (/(قدیمی ?ترین|قدیمی)/.test(norm)) sort = 'oldest';
  else if (/(به ترتیب شهر|بر اساس شهر)/.test(norm)) sort = 'city';
  if (/(ربط|مرتبط ?ترین|دقیق ?ترین|بهترین تطبیق)/.test(norm)) sort = 'relevance';

  // ۷) موقعیت
  const loc = findLocations(latinMapped);
  const cities = loc.cities.map(c => c.name);
  const provinces = loc.provinces.map(p => p.name);
  if (cities.length) for (const c of cities) { const p = provinceOf(c); if (p && !provinces.includes(p)) provinces.push(p); }

  // ۸) عبارت‌های چندواژه‌ای + واژه‌های آزاد
  const lexPhrases = findPhrases(latinMapped);
  const consumed = new Set();
  for (const p of lexPhrases) for (const part of p.parts) consumed.add(part);

  const tokens = norm.split(/\s+/).filter(t => t.length >= 2);
  const locWords = new Set();
  for (const c of loc.cities) {
    locWords.add(foldForSearch(c.name));
    for (const a of (CITIES.find(x => x.name === c.name)?.aliases) || []) locWords.add(foldForSearch(a));
  }
  for (const p of loc.provinces) locWords.add(foldForSearch(p.name));

  const freeTerms = [];
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    const tf = foldForSearch(t);
    if (!tf || locWords.has(tf)) continue;
    if (consumed.has(tf)) continue;
    if (KIND_WORDS.some(k => k.re.test(t))) continue;
    if (TIME_RULES.some(r => r.re.test(t))) continue;
    if (!freeTerms.includes(tf)) freeTerms.push(tf);
  }

  const phrases = [...new Set([...lexPhrases.map(p => p.raw), ...(freeTerms.length > 1 ? [freeTerms.join(' ')] : [])])];
  const { map: termMap, all: expanded } = expandTerms(freeTerms);

  // نگاشت معکوس: واژهٔ بسط‌یافته → واژه‌های کاربر که آن را آورده‌اند
  // (تا اختصاصی‌بودن موضوع بر پایهٔ «واژهٔ کاربر» سنجیده شود، نه واژهٔ فهرست موضوع)
  const expSource = new Map();
  for (const [term, ex] of termMap) {
    for (const e of ex) {
      if (!expSource.has(e)) expSource.set(e, []);
      expSource.get(e).push(term);
    }
  }

  // ۹) موضوعات (با وزن اختصاصی‌بودن)
  const topicIds = new Set();
  const topicHits = [];
  for (const t of topics) {
    const words = (t.words || []).filter(Boolean);
    const hits = [];
    let weight = 0;
    for (const w of words) {
      const wf = foldForSearch(w);
      if (!wf) continue;
      const direct = f.includes(wf);
      const sources = expSource.get(wf);
      if (!direct && !sources) continue;
      const wTopic = topicWeight(w);
      // اگر تطبیق فقط از راه بسط است، سقف وزن = اختصاصی‌بودن خود واژهٔ کاربر
      const wUser = direct ? wTopic : Math.max(0, ...sources.map(s => topicWeight(s)));
      const wt = Math.min(wTopic, wUser);
      if (wt <= 0) continue;
      hits.push(w);
      weight += wt;
    }
    if (weight >= 4) { topicIds.add(t.id); topicHits.push({ id: t.id, name: t.name, hits, weight }); }
  }
  // پل گروه‌های هم‌معنا → موضوعات هم‌شناسه
  const groups = groupsInText(norm);
  for (const g of groups) {
    const t = topics.find(x => x.id === g);
    if (t && !topicIds.has(t.id)) {
      topicIds.add(t.id);
      topicHits.push({ id: t.id, name: t.name, hits: [GROUP_NAME.get(g) || g], viaGroup: true, weight: 6 });
    }
  }
  topicHits.sort((a, b) => b.weight - a.weight);

  // ۱۰) نیّت‌های ویژه
  const wantsAnalysis = /(تحلیل|آمار|چند ?تا|چقدر|مقایسه|وضعیت|گزارش|خلاصه|نمودار|روند|توزیع|کدام شهر|بیشترین|جمع ?بندی|پراکنش|آماری)/.test(norm);
  const wantsFresh = /(جدید|بروز|به ?روز|تازه|آپدیت|اسکن|چک|بگرد|جستجو|جست ?و ?جو|پیدا ?کن|همین حالا|زنده|آخرین|منابع)/.test(norm);
  const wantsRepair = /(ایراد|خطا|مشکل|خراب|کار ?نمی|از کار|منبع|منابع|رفع|درست ?کن|چرا|خالی|کم ?شد|پوشش|سلامت)/.test(norm);
  const wantsHelp = /(راهنما|چیکار می|چه ?کار می|چطور|کمک|چی ?میتونی|توانایی|قابلیت)/.test(norm);
  const wantsAllCountry = /(کل کشور|همه ?جای ایران|سراسر کشور|کل ایران|کشوری)/.test(norm);
  const wantsExpired = /(منقضی|گذشته|تموم شده|تمام شده|باطل)/.test(norm);

  // ۱۱) سقف نمایش
  let limit = 15;
  const lm = norm.match(/(\d{1,3})\s*(?:تا|مورد|آگهی|اگهی|عدد)/);
  if (lm) limit = Math.min(Math.max(+toAsciiDigits(lm[1]), 3), 60);
  if (/(همه|کل|تمام)/.test(norm)) limit = 60;

  const strictCity = cities.length > 0;
  const strictKind = kinds.length > 0;
  const requiresTextMatch = freeTerms.length > 0 || topicIds.size > 0;

  return {
    raw, norm, folded: f,
    cities, provinces, matchedLocations: loc.matched, citiesDetail: loc.cities,
    freeTerms, freeTermsDisplay: freeTerms.map(displayTerm),
    phrases, expanded, termMap,
    topicIds: [...topicIds], topicHits,
    synonymGroups: groups,
    kinds, softKinds, excludeKinds, onlyKinds, excludeTerms,
    days, timeLabel, dateFrom, dateTo,
    hasDeadline, deadlineWithin, hideExpired, sort, limit,
    strictCity, strictKind, requiresTextMatch,
    wantsAnalysis, wantsFresh, wantsRepair, wantsHelp, wantsAllCountry, wantsExpired,
    isEmpty: !cities.length && !provinces.length && !topicIds.size && !freeTerms.length && !kinds.length && !days && !dateFrom && !dateTo,
    notes,
  };
}

/** خلاصهٔ خوانای قصد — برای نمایش چیپ در رابط کاربری */
export function intentSummary(intent) {
  const out = [];
  if (intent.cities.length) out.push({ k: 'شهر', v: intent.cities.join('، ') });
  else if (intent.provinces.length) out.push({ k: 'استان', v: intent.provinces.join('، ') });
  if (intent.topicHits.length) out.push({ k: 'موضوع', v: intent.topicHits.slice(0, 3).map(t => t.name).join('، ') });
  else if (intent.freeTerms.length) out.push({ k: 'واژه', v: intent.freeTermsDisplay.slice(0, 4).join('، ') });
  if (intent.kinds.length) out.push({ k: 'نوع', v: intent.kinds.join('، ') });
  if (intent.softKinds.length) out.push({ k: 'گرایش', v: intent.softKinds.join('، ') });
  if (intent.timeLabel) out.push({ k: 'بازه', v: intent.timeLabel });
  if (intent.hasDeadline) out.push({ k: 'مهلت', v: intent.deadlineWithin ? `تا ${intent.deadlineWithin} روز` : 'دارای مهلت' });
  if (intent.sort !== 'newest') out.push({ k: 'ترتیب', v: { deadline: 'نزدیک‌ترین مهلت', oldest: 'قدیمی‌ترین', city: 'شهر', relevance: 'دقیق‌ترین ربط' }[intent.sort] || intent.sort });
  return out;
}

// ---------- امتیازدهی ----------
const dayOf = iso => (iso ? Date.parse(iso + 'T00:00:00Z') : NaN);

function ageDays(it, todayIso) {
  const base = dayOf(todayIso);
  const p = dayOf(it.publishedISO);
  if (!isNaN(p)) return Math.max(0, Math.round((base - p) / 86400000));
  const s = it.firstSeenAt ? Date.parse(String(it.firstSeenAt).slice(0, 10) + 'T00:00:00Z') : NaN;
  if (!isNaN(s)) return Math.max(0, Math.round((base - s) / 86400000));
  return null;
}

/**
 * امتیاز یک آگهی: rel (ربط، مبنای فیلتر) + bonus (تازگی/فوریت، مبنای ترتیب).
 */
export function scoreItem(it, intent, todayIso) {
  const titleSpaced = normalizeFa(it.title || '');
  const titleFold = foldForSearch(it.title || '');
  const descSpaced = normalizeFa(it.description || '');
  const descFold = foldForSearch(it.description || '');
  const orgFold = foldForSearch(it.org || '');
  const srcFold = foldForSearch(it.sourceName || '');
  const kwFold = foldForSearch((it.keywords || []).join(' '));
  const topicFold = foldForSearch((it.topics || []).join(' '));
  const allFold = titleFold + ' ' + descFold;

  let rel = 0;
  let bonus = 0;
  const reasons = [];
  const dims = { text: false, topic: false, loc: false, kind: false };

  // --- عبارت دقیق ---
  for (const p of intent.phrases) {
    const pf = foldForSearch(p);
    if (!pf || pf.length < 5) continue;
    if (titleFold.includes(pf)) { rel += 45; dims.text = true; reasons.push(`عبارت «${p}» در عنوان`); break; }
    if (descFold.includes(pf)) { rel += 12; dims.text = true; reasons.push(`عبارت «${p}» در شرح`); break; }
  }

  // --- واژه‌های بسط‌یافته ---
  let titleHits = 0, descHits = 0, kwHits = 0;
  for (const [term, ex] of intent.termMap) {
    let hit = false;
    for (const e of ex) { if (e && e.length >= 3 && titleFold.includes(e)) { titleHits++; hit = true; break; } }
    if (!hit) for (const e of ex) { if (e && e.length >= 3 && descFold.includes(e)) { descHits++; break; } }
    for (const e of ex) { if (e && e.length >= 3 && kwFold.includes(e)) { kwHits++; break; } }
  }
  rel += Math.min(titleHits * 13, 52);
  rel += Math.min(descHits * 4, 20);
  rel += Math.min(kwHits * 7, 21);
  if (titleHits || descHits || kwHits) dims.text = true;
  if (titleHits) reasons.push(`تطبیق ${titleHits} واژه در عنوان`);
  else if (descHits) reasons.push(`تطبیق ${descHits} واژه در شرح`);

  // --- تطبیق فازی (غلط املایی) ---
  if (!titleHits && !descHits && intent.freeTerms.length) {
    for (const t of intent.freeTerms) {
      if (t.length < 5) continue;
      if (fuzzyContains(titleSpaced, t, 5)) { rel += 16; dims.text = true; reasons.push(`تطبیق نزدیک «${displayTerm(t)}» در عنوان`); break; }
      if (fuzzyContains(descSpaced, t, 5)) { rel += 6; dims.text = true; reasons.push(`تطبیق نزدیک «${displayTerm(t)}»`); break; }
    }
  }

  // --- موضوع ---
  const tid = it.topicIds || [];
  const overlap = intent.topicIds.filter(id => tid.includes(id));
  if (overlap.length) {
    rel += 18 * overlap.length;
    dims.topic = true;
    reasons.push(`موضوع: ${overlap.map(id => (intent.topicHits.find(h => h.id === id) || {}).name || id).join('، ')}`);
  } else if (intent.topicIds.length && topicFold) {
    for (const h of intent.topicHits) {
      const nf = foldForSearch(h.name);
      if (nf && topicFold.includes(nf)) { rel += 8; dims.topic = true; reasons.push(`موضوع نزدیک: ${h.name}`); break; }
    }
  }

  // --- موقعیت ---
  if (intent.cities.length) {
    if (intent.cities.includes(it.city)) { rel += 34; dims.loc = true; reasons.push(`شهر: ${it.city}`); }
    else {
      const inText = intent.cities.find(c => textHasCity(it, c));
      if (inText) { rel += 26; dims.loc = true; reasons.push(`اشاره به ${inText} در متن`); }
    }
  } else if (intent.provinces.length) {
    if (intent.provinces.includes(it.province)) { rel += 12; dims.loc = true; reasons.push(`استان: ${it.province}`); }
  }

  // --- نوع ---
  if (intent.kinds.length) {
    if (intent.kinds.includes(it.kind)) { rel += 9; dims.kind = true; reasons.push(`نوع: ${it.kind}`); }
  } else if (it.kind === 'مناقصه') rel += 2;
  if (intent.softKinds.length) {
    for (const sk of intent.softKinds) {
      if (allFold.includes(foldForSearch(sk))) { rel += 6; reasons.push(`گرایش: ${sk}`); break; }
    }
  }

  // --- سازمان / منبع ---
  for (const t of intent.freeTerms) {
    if (t.length >= 4 && (orgFold.includes(t) || srcFold.includes(t))) { rel += 10; reasons.push('نام سازمان/منبع'); break; }
  }

  // --- استثناها ---
  for (const ex of intent.excludeTerms) {
    const exf = foldForSearch(ex);
    if (exf.length >= 3 && allFold.includes(exf)) { rel -= 40; reasons.push(`حاوی «${ex}» (نامطلوب)`); }
  }

  // --- پاداش تازگی ---
  const age = ageDays(it, todayIso);
  if (age != null) {
    if (age <= 1) { bonus += 18; reasons.push('امروز/دیروز'); }
    else if (age <= 3) bonus += 13;
    else if (age <= 7) bonus += 9;
    else if (age <= 14) bonus += 5;
    else if (age <= 30) bonus += 2;
    else if (age > 120) bonus -= 4;
  }

  // --- پاداش/جریمهٔ مهلت ---
  if (it.deadlineISO) {
    const dl = daysUntil(it.deadlineISO, todayIso);
    if (dl != null) {
      if (dl >= 0 && dl <= 3) { bonus += 15; reasons.push(`مهلت فوری: ${dl} روز`); }
      else if (dl >= 0 && dl <= 7) { bonus += 10; reasons.push(`مهلت ${dl} روز`); }
      else if (dl < 0) bonus -= 6;
    }
  } else if (intent.hasDeadline) bonus -= 3;

  return { rel, bonus, score: Math.round((rel + bonus) * 10) / 10, reasons, age, dims };
}

/**
 * جست‌وجوی امتیازدهی‌شده.
 * @param {Array} items
 * @param {object} intent
 * @param {{strict?:boolean, limit?:number, minRel?:number, targetProvinces?:string[]|null}} opts
 */
export function searchItems(items, intent, opts = {}) {
  const todayIso = todayTehran().iso;
  const strict = opts.strict !== false;
  const limit = opts.limit ?? intent.limit ?? 15;
  const hasStructured = intent.cities.length || intent.provinces.length || intent.topicIds.length
    || intent.kinds.length || intent.days || intent.dateFrom || intent.hasDeadline;
  const minRel = opts.minRel ?? (intent.requiresTextMatch ? 8 : 0);
  const targetProvinces = opts.targetProvinces || null;

  const scored = [];
  const dropped = { city: 0, kind: 0, date: 0, deadline: 0, score: 0, expired: 0, target: 0, dimension: 0 };

  for (const it of items) {
    if (intent.excludeKinds.includes(it.kind)) { dropped.kind++; continue; }

    if (strict && intent.cities.length) {
      if (!intent.cities.includes(it.city) && !intent.cities.some(c => textHasCity(it, c))) { dropped.city++; continue; }
    }
    if (strict && !intent.cities.length && intent.provinces.length) {
      if (!intent.provinces.includes(it.province)) { dropped.city++; continue; }
    }
    if (strict && intent.kinds.length && !intent.kinds.includes(it.kind)) { dropped.kind++; continue; }
    if (intent.hasDeadline && !it.deadlineISO) { dropped.deadline++; continue; }

    if (targetProvinces && !intent.cities.length && !intent.provinces.length && !targetProvinces.includes(it.province)) {
      dropped.target++; continue;
    }

    const ref = it.publishedISO || (it.firstSeenAt ? String(it.firstSeenAt).slice(0, 10) : null);
    if (intent.days != null) {
      if (!ref) { dropped.date++; continue; }
      const d = daysUntil(todayIso, ref);
      if (d == null || d > intent.days) { dropped.date++; continue; }
    }
    if (intent.dateFrom || intent.dateTo) {
      if (!ref) { dropped.date++; continue; }
      if (intent.dateFrom && ref < intent.dateFrom) { dropped.date++; continue; }
      if (intent.dateTo && ref > intent.dateTo) { dropped.date++; continue; }
    }

    if (it.deadlineISO) {
      const dl = daysUntil(it.deadlineISO, todayIso);
      if (intent.deadlineWithin != null && (dl == null || dl < 0 || dl > intent.deadlineWithin)) { dropped.deadline++; continue; }
      if (intent.hideExpired && dl != null && dl < 0) { dropped.expired++; continue; }
    }

    const s = scoreItem(it, intent, todayIso);
    if (s.rel < minRel) { dropped.score++; continue; }
    // 🔴 بُعد کلیدی: اگر کاربر موضوع/واژه گفته، آگهی باید آن را داشته باشد —
    // صرفِ تطبیق شهر یا نوع کافی نیست (وگرنه «آسفالت کرج» هر آگهی کرج را برمی‌گرداند).
    if (intent.requiresTextMatch && !(s.dims.text || s.dims.topic)) { dropped.dimension++; continue; }
    if (intent.kinds.length && !s.dims.kind) { dropped.dimension++; continue; }
    if ((intent.cities.length || intent.provinces.length) && !s.dims.loc) { dropped.dimension++; continue; }
    scored.push({ ...it, _rel: s.rel, _bonus: s.bonus, _score: s.score, _reasons: s.reasons, _ageDays: s.age });
  }

  const cmp = {
    newest: (a, b) => (b._score - a._score) || String(b.publishedISO || b.firstSeenAt || '').localeCompare(String(a.publishedISO || a.firstSeenAt || '')),
    deadline: (a, b) => String(a.deadlineISO || 'zzz').localeCompare(String(b.deadlineISO || 'zzz')) || (b._score - a._score),
    oldest: (a, b) => String(a.publishedISO || 'zzz').localeCompare(String(b.publishedISO || 'zzz')) || (b._score - a._score),
    city: (a, b) => String(a.city || 'zzz').localeCompare(String(b.city || 'zzz'), 'fa') || (b._score - a._score),
    relevance: (a, b) => b._rel - a._rel || b._score - a._score,
  }[intent.sort] || ((a, b) => b._score - a._score);

  scored.sort(cmp);

  return { total: scored.length, items: scored.slice(0, limit), all: scored, dropped, minRel, hasStructured };
}

// ---------- تحلیل آماری ----------
const countBy = (arr, fn) => {
  const m = new Map();
  for (const x of arr) { const k = fn(x) || 'نامشخص'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
};

export function analyze(items) {
  const todayIso = todayTehran().iso;
  const withDeadline = items.filter(i => i.deadlineISO);
  const urgent = withDeadline
    .map(i => ({ ...i, _dl: daysUntil(i.deadlineISO, todayIso) }))
    .filter(i => i._dl != null && i._dl >= 0 && i._dl <= 3)
    .sort((a, b) => a._dl - b._dl);
  const expired = withDeadline.filter(i => (daysUntil(i.deadlineISO, todayIso) ?? 0) < 0);
  const fresh = items.filter(i => (i._ageDays ?? 999) <= 3);
  return {
    total: items.length,
    byCity: countBy(items, i => i.city),
    byProvince: countBy(items, i => i.province),
    byKind: countBy(items, i => i.kind),
    bySource: countBy(items, i => i.sourceName),
    byOrg: countBy(items, i => i.org),
    byTopic: countBy(items.flatMap(i => (i.topics && i.topics.length ? i.topics : ['بدون موضوع'])), x => x),
    urgent, expired, fresh,
    withDeadline: withDeadline.length,
    withoutDeadline: items.length - withDeadline.length,
  };
}

export { isoToJalali, daysUntil, todayTehran, foldForSearch, normalizeFa };
