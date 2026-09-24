// lib/text.mjs — نرمال‌سازی متن فارسی، تبدیل تاریخ شمسی/میلادی، تشخیص موضوع

// ---------- اعداد ----------
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** تبدیل ارقام فارسی/عربی به لاتین */
export function toAsciiDigits(s) {
  if (s == null) return '';
  return String(s).replace(/[۰-۹٠-٩]/g, ch => {
    const i = FA_DIGITS.indexOf(ch);
    if (i > -1) return String(i);
    const j = AR_DIGITS.indexOf(ch);
    return j > -1 ? String(j) : ch;
  });
}

/** تبدیل ارقام لاتین به فارسی (برای نمایش) */
export function faNum(n) {
  return String(n == null ? '' : n).replace(/\d/g, d => FA_DIGITS[+d]);
}

/** جداکننده هزارگان با ارقام فارسی */
export function faGroup(n) {
  return faNum(String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '،'));
}

// ---------- نرمال‌سازی ----------
/**
 * نرمال‌سازی متن فارسی: یکسان‌سازی ی/ك، حذف نیم‌فاصله و اعراب، فشرده‌سازی فاصله‌ها.
 * برای «نمایش» استفاده می‌شود (نه برای جستجو).
 */
export function normalizeFa(s) {
  if (s == null) return '';
  return String(s)
    .replace(/[\u064B-\u0652\u0640]/g, '')      // اعراب و کشیده
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ی')
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // نویسه‌های نامرئی
    .replace(/\u200C/g, ' ')                     // نیم‌فاصله → فاصله
    .replace(/[«»"'`]/g, ' ')
    .replace(/[()\[\]{}<>]/g, ' ')
    .replace(/[،؛,:;!?؟.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** فرم جستجو: نرمال‌سازی + حذف فاصله‌ها + ارقام لاتین */
export function foldForSearch(s) {
  return toAsciiDigits(normalizeFa(s)).replace(/\s+/g, '').toLowerCase();
}

/** پاک‌سازی HTML و استخراج متن */
export function stripHtml(html) {
  if (!html) return '';
  return normalizeFa(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, ' ')
      .replace(/&[a-z]+;/gi, ' ')
  );
}

// ---------- تبدیل تاریخ شمسی ----------
const div = (a, b) => Math.trunc(a / b);
const mod = (a, b) => a - Math.trunc(a / b) * b;
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm, jump = 0, i;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('سال شمسی نامعتبر: ' + jy);
  for (i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let jd, jm, k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy, jm, jd }; }
    k -= 186;
  } else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

const pad = n => String(n).padStart(2, '0');

export function jalaliToGregorian(jy, jm, jd) {
  const g = d2g(j2d(jy, jm, jd));
  return { gy: g.gy, gm: g.gm, gd: g.gd };
}
export function gregorianToJalali(gy, gm, gd) {
  return d2j(g2d(gy, gm, gd));
}

/** «۱۴۰۵/۰۷/۰۲» → «2026-09-24» */
export function jalaliStrToISO(str) {
  const m = toAsciiDigits(String(str)).match(/(1[34]\d{2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/);
  if (!m) return null;
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const g = jalaliToGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

/** تاریخ ISO → رشته شمسی */
export function isoToJalali(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const j = gregorianToJalali(+m[1], +m[2], +m[3]);
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}

const MONTHS_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * تبدیل هر شکلی از تاریخ به { iso, jalali }.
 * پشتیبانی: ISO 8601، RFC822 (RSS)، «۱۴۰۵/۰۷/۰۲»، «۲ مهر ۱۴۰۵»، «1405-07-02»
 */
export function parseAnyDate(input) {
  if (!input) return { iso: null, jalali: '' };
  let s = toAsciiDigits(String(input)).trim();

  // ISO: 2026-09-24T10:30:53 یا 2026-09-24
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m && +m[1] > 1900) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return { iso, jalali: isoToJalali(iso), time: `${m[4]}:${m[5]}` };
  }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m && +m[1] > 1900) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return { iso, jalali: isoToJalali(iso) };
  }

  // RFC822: Thu, 24 Sep 2026 10:30:53 GMT
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) {
    const mo = MONTHS_EN[m[2].toLowerCase()];
    if (mo) {
      const iso = `${m[3]}-${pad(mo)}-${pad(+m[1])}`;
      return { iso, jalali: isoToJalali(iso), time: `${m[4]}:${m[5]}` };
    }
  }

  // شمسی عددی: 1405/07/02
  const jiso = jalaliStrToISO(s);
  if (jiso) {
    const jm = s.match(/(1[34]\d{2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/);
    return { iso: jiso, jalali: `${jm[1]}/${pad(+jm[2])}/${pad(+jm[3])}` };
  }

  // شمسی متنی: ۲ مهر ۱۴۰۵ / 2 مهرماه 1405
  const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'ابان', 'اذر', 'دی', 'بهمن', 'اسفند'];
  m = s.match(/(\d{1,2})\s*([^\s\d]{3,12})\s*(\d{4})/);
  if (m) {
    const key = normalizeFa(m[2]).replace(/\s|ماه/g, '');
    let idx = J_MONTHS.findIndex(x => x === key || key.startsWith(x) || x.startsWith(key.slice(0, 3)));
    if (idx > -1 && +m[3] > 1300) {
      const jy = +m[3], jm = idx + 1, jd = +m[1];
      const g = jalaliToGregorian(jy, jm, jd);
      const iso = `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
      return { iso, jalali: `${jy}/${pad(jm)}/${pad(jd)}` };
    }
  }
  return { iso: null, jalali: '' };
}

/** امروز به وقت تهران */
export function todayTehran() {
  const now = new Date();
  const teh = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tehran' }));
  return { iso: `${teh.getFullYear()}-${pad(teh.getMonth() + 1)}-${pad(teh.getDate())}`, jalali: isoToJalali(`${teh.getFullYear()}-${pad(teh.getMonth() + 1)}-${pad(teh.getDate())}`) };
}

/** فاصله روز تا تاریخ ISO (منفی = گذشته) */
export function daysUntil(iso, fromIso) {
  if (!iso) return null;
  const a = Date.parse(iso + 'T00:00:00Z');
  const base = fromIso ? Date.parse(fromIso + 'T00:00:00Z') : Date.parse(todayTehran().iso + 'T00:00:00Z');
  if (isNaN(a) || isNaN(base)) return null;
  return Math.round((a - base) / 86400000);
}

// ---------- موضوعات و کلیدواژه‌ها ----------
export const DEFAULT_TOPICS = [
  { id: 'asphalt', name: 'آسفالت و قیر', words: ['آسفالت', 'اسفالت', 'قیر', 'روکش', 'لکه گیری', 'لکهگیری', 'تراش', 'فینیشر', 'اکتشاف قیر'] },
  { id: 'jedval', name: 'جدول‌گذاری', words: ['جدول گذاری', 'جدولگذاری', 'جدول', 'کانیوو', 'بلوک جدول', 'مهار جدول'] },
  { id: 'kafpoosh', name: 'کفپوش و فرش', words: ['کفپوش', 'فرش', 'موزاییک', 'سنگ فرش', 'سنگفرش', 'پیاده رو', 'پیادهرو'] },
  { id: 'takhrib', name: 'تخریب و بازسازی', words: ['تخریب', 'بازسازی', 'مرمت', 'بهسازی', 'احیا', 'نوسازی'] },
  { id: 'sakhteman', name: 'ساختمان و ابنیه', words: ['ساختمان', 'ابنیه', 'بنا', 'احداث', 'ساخت', 'اسکلت', 'بتن', 'سفت کاری', 'نازک کاری', 'سقف', 'دیوار'] },
  { id: 'park', name: 'پارک و فضای سبز', words: ['پارک', 'بوستان', 'فضای سبز', 'محوطه سبز', 'گلستان', 'درخت', 'چمن', 'آبیاری', 'نهال'] },
  { id: 'zirsazi', name: 'زیرسازی و ابنیه راه', words: ['زیرسازی', 'زیر سازی', 'خاکبرداری', 'خاک ریزی', 'خاکریزی', 'کانال', 'جوی', 'کانال گذاری', 'زیرسازی معابر'] },
  { id: 'lolekeshi', name: 'آب و فاضلاب و لوله', words: ['لوله', 'فاضلاب', 'آب رسانی', 'آبرسانی', 'شبکه آب', 'پلی اتیلن', 'کانال فاضلاب', 'هزینه لوله'] },
  { id: 'bargh', name: 'برق و روشنایی', words: ['برق', 'روشنایی', 'چراغ', 'پایه چراغ', 'کابل', 'ترانس', 'تیر برق', 'الکتریک'] },
  { id: 'hambazi', name: 'خط‌کشی و علائم', words: ['خط کشی', 'خطکشی', 'علائم', 'ایمنی', 'چشم گربه ای', 'گاردریل', 'نیوجرسی', 'سرعتگیر', 'سرعت گیر'] },
  { id: 'khodro', name: 'خودرو و ماشین‌آلات', words: ['خودرو', 'ماشین آلات', 'ماشینآلات', 'لودر', 'بیل مکانیکی', 'کامیون', 'خاور', 'جرثقیل', 'تامین خودرو'] },
  { id: 'khadamat', name: 'خدمات و نظافت', words: ['نظافت', 'خدمات شهری', 'پسماند', 'زباله', 'رفت و روب', 'باغبانی', 'حراست', 'تامین نیرو', 'خدمات عمومی'] },
  { id: 'it', name: 'فناوری اطلاعات', words: ['نرم افزار', 'سامانه', 'رایانه', 'کامپیوتر', 'فناوری اطلاعات', 'شبکه', 'دوربین', 'نظارت تصویری', 'اتوماسیون'] },
  { id: 'tasisat', name: 'تاسیسات مکانیکی', words: ['تاسیسات', 'تأسیسات', 'موتورخانه', 'چیلر', 'هواساز', 'شوفاژ', 'گرمایش', 'سرمایش', 'گازرسانی'] },
  { id: 'chapar', name: 'چاپ و تبلیغات', words: ['چاپ', 'تبلیغات', 'بنر', 'بیرق', 'تابلو', 'طراحی', 'رسانه'] },
  { id: 'bime', name: 'بیمه و خدمات مالی', words: ['بیمه', 'حسابرسی', 'مشاوره', 'مالی', 'بانکی'] },
];

/** تطبیق متن با کلیدواژه‌های یک موضوع */
export function matchTopic(haystackFolded, words) {
  const hits = [];
  for (const w of words) {
    const fw = foldForSearch(w);
    if (fw && haystackFolded.includes(fw)) hits.push(w);
  }
  return hits;
}

/** واژه‌های عمومی که نشان‌دهندهٔ آگهی مناقصه است */
export const TENDER_WORDS = [
  'مناقصه', 'مزایده', 'استعلام', 'فراخوان', 'آگهی', 'تجديد مناقصه', 'تجدید مناقصه',
  'ارزیابی', 'قرارداد', 'پیمانکاری', 'برگزاری مناقصه', 'دعوت به', 'شرکت در مناقصه', 'استعلام بها',
];

export function looksLikeTender(text) {
  const f = foldForSearch(text);
  return TENDER_WORDS.some(w => f.includes(foldForSearch(w)));
}

/** نوع آگهی از متن */
export function detectKind(text) {
  const f = foldForSearch(text);
  if (f.includes('مزایده')) return 'مزایده';
  if (f.includes('استعلام')) return 'استعلام';
  if (f.includes('مناقصه')) return 'مناقصه';
  if (f.includes('فراخوان')) return 'فراخوان';
  return 'سایر';
}
