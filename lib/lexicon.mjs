// lib/lexicon.mjs — واژگان حوزهٔ پیمانکاری: هم‌معناها، نگاشت لاتین، تطبیق فازی
//
// هدف: کاربر ممکن است «قیرپاشی» بگوید و آگهی «روکش آسفالت» نوشته باشد، یا
// «اسفالت» بنویسد (غلط املایی)، یا «asphalt» لاتین. این ماژول پل می‌زند.
import { normalizeFa, foldForSearch } from './text.mjs';

// ---------- ۱) گروه‌های هم‌معنا ----------
// هر گروه = یک مفهوم. اگر کاربر یکی از واژه‌ها را بگوید، همهٔ گروه جستجو می‌شود.
export const SYNONYM_GROUPS = [
  { id: 'asphalt', name: 'آسفالت و قیر', words: ['آسفالت', 'اسفالت', 'اسفالت', 'قیر', 'قیرپاشی', 'قیر پاشی', 'روکش', 'روکش آسفالت', 'لکه گیری', 'لکهگیری', 'تراش', 'تراش آسفالت', 'فینیشر', 'آسفالت ریزی', 'آسفالتریزی', 'ماکادام', 'اندود قیری', 'آسفالت گرم', 'آسفالت سرد', 'ترمیم آسفالت', 'بهسازی آسفالت', 'درزگیری', 'درز گیری', 'فره آسفالت', 'ابزار قیر'] },
  { id: 'jedval', name: 'جدول‌گذاری', words: ['جدول', 'جدول گذاری', 'جدولگذاری', 'کانیوو', 'کانیو', 'بلوک جدول', 'مهار جدول', 'جدول بتنی', 'جدول سنگی', 'جدول پیش ساخته', 'جدول ریزی'] },
  { id: 'kafpoosh', name: 'کفپوش و فرش', words: ['کفپوش', 'کف پوش', 'فرش', 'موزاییک', 'سنگ فرش', 'سنگفرش', 'پیاده رو', 'پیادهرو', 'واش بتن', 'آجر فرش', 'کف سازی', 'کفسازی', 'کفپوش بتنی'] },
  { id: 'takhrib', name: 'تخریب و بازسازی', words: ['تخریب', 'بازسازی', 'مرمت', 'بهسازی', 'احیا', 'نوسازی', 'برداشت', 'خاکبرداری و تخریب', 'تخریب و بازسازی', 'اصلاح'] },
  { id: 'sakhteman', name: 'ساختمان و ابنیه', words: ['ساختمان', 'ابنیه', 'بنا', 'احداث', 'ساخت', 'اسکلت', 'بتن', 'بتن ریزی', 'سفت کاری', 'نازک کاری', 'سقف', 'دیوار', 'ساختمان سازی', 'سازه', 'بتنی', 'فلزی', 'اسکلت فلزی', 'اسکلت بتنی', 'دیوارچینی'] },
  { id: 'park', name: 'پارک و فضای سبز', words: ['پارک', 'بوستان', 'فضای سبز', 'محوطه سبز', 'گلکاری', 'گل کاری', 'درخت', 'درختکاری', 'چمن', 'آبیاری', 'نهال', 'گلستان', 'رینگ سبز', 'آبیاری قطره ای', 'طراحی فضای سبز'] },
  { id: 'zirsazi', name: 'زیرسازی و ابنیه راه', words: ['زیرسازی', 'زیر سازی', 'خاکبرداری', 'خاک برداری', 'خاک ریزی', 'خاکریزی', 'کانال', 'جوی', 'کانال گذاری', 'تسطیح', 'رگلاژ', 'لایه اساس', 'اساس', 'ساب بیس', 'ساببیس', 'زیرسازی معابر', 'خاکی', 'پروفیل', 'کف تراشی'] },
  { id: 'lolekeshi', name: 'آب و فاضلاب', words: ['لوله', 'لوله گذاری', 'لولهگذاری', 'فاضلاب', 'آبرسانی', 'آب رسانی', 'شبکه آب', 'پلی اتیلن', 'کانال فاضلاب', 'جدول و لوله', 'خط انتقال آب', 'چاه', 'شبکه فاضلاب', 'پساب', 'تصفیه خانه', 'آب شیرین کن'] },
  { id: 'bargh', name: 'برق و روشنایی', words: ['برق', 'روشنایی', 'روشنایی معابر', 'چراغ', 'چراغ روشنایی', 'پایه چراغ', 'کابل', 'ترانس', 'تیر برق', 'الکتریک', 'برق رسانی', 'برق رسانی', 'شبکه توزیع', 'پست برق'] },
  { id: 'hambazi', name: 'خط‌کشی و علائم', words: ['خط کشی', 'خطکشی', 'علائم', 'علائم راهنمایی', 'ایمنی', 'ایمن سازی', 'چشم گربه ای', 'گاردریل', 'نیوجرسی', 'سرعتگیر', 'سرعت گیر', 'تابلو ایمنی', 'خط کشی معابر', 'ترافیکی'] },
  { id: 'khodro', name: 'خودرو و ماشین‌آلات', words: ['خودرو', 'ماشین آلات', 'ماشینآلات', 'لودر', 'بیل مکانیکی', 'کامیون', 'خاور', 'جرثقیل', 'تامین خودرو', 'اجاره ماشین آلات', 'بولدوزر', 'غلطک', 'غلتک', 'مینی لودر', 'کمپرسی', 'خودرو سنگین'] },
  { id: 'khadamat', name: 'خدمات و نظافت', words: ['نظافت', 'تنظیف', 'خدمات شهری', 'پسماند', 'زباله', 'رفت و روب', 'رفت و روب', 'باغبانی', 'حراست', 'تامین نیرو', 'خدمات عمومی', 'جمع آوری زباله', 'نگهبانی', 'خدمات پشتیبانی', 'تامین نیروی انسانی'] },
  { id: 'it', name: 'فناوری اطلاعات', words: ['نرم افزار', 'سامانه', 'رایانه', 'کامپیوتر', 'فناوری اطلاعات', 'شبکه', 'دوربین', 'نظارت تصویری', 'اتوماسیون', 'پشتیبانی نرم افزار', 'سخت افزار', 'شبکه رایانه ای', 'دوربین مدار بسته'] },
  { id: 'tasisat', name: 'تاسیسات مکانیکی', words: ['تاسیسات', 'تأسیسات', 'موتورخانه', 'چیلر', 'هواساز', 'شوفاژ', 'گرمایش', 'سرمایش', 'گازرسانی', 'تعمیرات تاسیسات', 'اسپلیت', 'پکیج', 'فن کویل', 'تهویه مطبوع', 'آسانسور', 'بالابر', 'پله برقی'] },
  { id: 'chapar', name: 'چاپ و تبلیغات', words: ['چاپ', 'تبلیغات', 'بنر', 'بیرق', 'تابلو', 'تابلو تبلیغاتی', 'طراحی', 'رسانه', 'چاپ و نصب بنر', 'الکترونیکی تبلیغاتی'] },
  { id: 'bime', name: 'بیمه و خدمات مالی', words: ['بیمه', 'حسابرسی', 'مشاوره', 'مالی', 'بانکی', 'خدمات مشاوره', 'حسابداری', 'بیمه مسئولیت', 'بیمه عمر'] },

  // --- گروه‌های تکمیلی (خارج از فهرست پیش‌فرض موضوعات، ولی پرتکرار در مناقصات) ---
  { id: 'rang', name: 'رنگ‌آمیزی', words: ['رنگ', 'رنگ آمیزی', 'رنگامیزی', 'نقاشی', 'رنگ روغنی', 'رنگ آمیزی نما'] },
  { id: 'izogam', name: 'عایق و آب‌بندی', words: ['عایق', 'ایزوگام', 'قیرگونی', 'آب بندی', 'ایزولاسیون', 'عایق کاری'] },
  { id: 'hesar', name: 'حصار و محوطه', words: ['حصار', 'حصارکشی', 'فنس', 'دیوار حائل', 'نرده', 'محوطه سازی', 'محوطه سازی', 'دیوار کشی', 'ورودی'] },
  { id: 'atash', name: 'آتش‌نشانی و ایمنی', words: ['آتش نشانی', 'اتش نشانی', 'اطفا حریق', 'ایستگاه آتش نشانی', 'سیستم اعلام حریق'] },
  { id: 'varzesh', name: 'ورزشی و تفریحی', words: ['سالن ورزشی', 'زمین چمن', 'چمن مصنوعی', 'زمین ورزشی', 'رختکن', 'زمین بازی', 'اسکیت', 'زمین چمن مصنوعی'] },
  { id: 'farhangi', name: 'فرهنگی و مذهبی', words: ['فرهنگسرا', 'کتابخانه', 'مسجد', 'حسینیه', 'سالن اجتماعات', 'خانه فرهنگ', 'امامزاده'] },
  { id: 'amoozesh', name: 'آموزشی', words: ['مدرسه', 'آموزشگاه', 'کلاس درس', 'هنرستان', 'مهد کودک', 'مدرسه سازی'] },
  { id: 'darmani', name: 'درمانی', words: ['درمانگاه', 'خانه بهداشت', 'بیمارستان', 'مرکز بهداشت', 'کلینیک'] },
  { id: 'sardkhane', name: 'انبار و سردخانه', words: ['سردخانه', 'انبار', 'ساخت انبار', 'انبار مسقف'] },
  { id: 'abnama', name: 'آبنما و استخر', words: ['استخر', 'آب نما', 'آبنما', 'فواره', 'چشمه', 'سازه آبی'] },
  { id: 'garden', name: 'گلخانه و پرورش', words: ['گلخانه', 'پرورش گل', 'نهالستان', 'پرورش گیاه'] },
  { id: 'tamin', name: 'تأمین کالا و خرید', words: ['خرید', 'تامین', 'تأمین', 'تهیه', 'خرید کالا', 'تدارکات', 'واگذاری', 'اجاره'] },
  { id: 'motaleat', name: 'مطالعات و مشاوره فنی', words: ['مطالعات', 'نظارت', 'طراحی و نظارت', 'مشاوره فنی', 'برداشت نقشه', 'نقشه برداری', 'ژئوتکنیک', 'مطالعات امکان سنجی'] },
];

// ---------- ۲) نگاشت واژه‌های لاتین به فارسی ----------
export const LATIN_MAP = {
  asphalt: 'آسفالت', asfalt: 'آسفالت', bitumen: 'قیر', curb: 'جدول', kerb: 'جدول',
  pavement: 'کفپوش', paving: 'کفپوش', sidewalk: 'پیاده رو', demolition: 'تخریب',
  construction: 'ساختمان', building: 'ساختمان', concrete: 'بتن', park: 'پارک',
  garden: 'فضای سبز', green: 'فضای سبز', tree: 'درخت', irrigation: 'آبیاری',
  road: 'راه', street: 'معبر', alley: 'کوچه', excav: 'خاکبرداری', excavation: 'خاکبرداری',
  pipe: 'لوله', pipeline: 'لوله', water: 'آب', sewage: 'فاضلاب', wastewater: 'فاضلاب',
  electricity: 'برق', power: 'برق', lighting: 'روشنایی', light: 'روشنایی', cable: 'کابل',
  marking: 'خط کشی', sign: 'علائم', guardrail: 'گاردریل', barrier: 'نیوجرسی',
  vehicle: 'خودرو', machinery: 'ماشین آلات', loader: 'لودر', truck: 'کامیون', crane: 'جرثقیل',
  cleaning: 'نظافت', waste: 'پسماند', garbage: 'زباله', security: 'حراست',
  software: 'نرم افزار', network: 'شبکه', cctv: 'دوربین', camera: 'دوربین', it: 'فناوری اطلاعات',
  hvac: 'تاسیسات', heating: 'گرمایش', cooling: 'سرمایش', elevator: 'آسانسور',
  printing: 'چاپ', banner: 'بنر', billboard: 'تابلو', media: 'رسانه',
  insurance: 'بیمه', audit: 'حسابرسی', consulting: 'مشاوره', finance: 'مالی',
  painting: 'رنگ آمیزی', paint: 'رنگ', insulation: 'عایق', waterproofing: 'آب بندی',
  fence: 'حصار', wall: 'دیوار', fire: 'آتش نشانی',
  sport: 'ورزشی', gym: 'سالن ورزشی', library: 'کتابخانه', mosque: 'مسجد',
  school: 'مدرسه', hospital: 'بیمارستان', clinic: 'درمانگاه', warehouse: 'انبار',
  pool: 'استخر', fountain: 'آب نما', greenhouse: 'گلخانه', tender: 'مناقصه',
  auction: 'مزایده', inquiry: 'استعلام', call: 'فراخوان',
  // شهرها
  karaj: 'کرج', tehran: 'تهران', shahriar: 'شهریار', fardis: 'فردیس', malard: 'ملارد',
  qods: 'قدس', quds: 'قدس', varamin: 'ورامین', eslamshahr: 'اسلامشهر', robatkarim: 'رباط کریم',
  pakdasht: 'پاکدشت', pardis: 'پردیس', damavand: 'دماوند', hashtgerd: 'هشتگرد',
  nazarabad: 'نظرآباد', savojbolagh: 'ساوجبلاغ', taleghan: 'طالقان', chahardangeh: 'چهاردانگه',
  nasimshahr: 'نسیم شهر', andisheh: 'اندیشه', kamalshahr: 'کمال شهر', baghestan: 'باغستان',
  nasirshahr: 'نصیرشهر', shahedshahr: 'شاهدشهر', gharchak: 'قرچک', eshtehard: 'اشتهارد',
  alborz: 'البرز', golestan: 'گلستان', salehabad: 'صالحیه', vahidieh: 'وحیدیه',
  sabashahr: 'صباشهر', mahdasht: 'ماهدشت', mohammadshahr: 'محمدشهر', chaharbagh: 'چهارباغ',
  meshkindasht: 'مشکین دشت', kamard: 'گرمدره', fashafuyeh: 'فشافویه', kahrizak: 'کهریزک',
  shahre_rey: 'شهر ری', lavasan: 'لواسان', roodehen: 'رودهن', boomhan: 'بومهن',
  parand: 'پرند', baharestan: 'بهارستان', nasim: 'نسیم شهر',
};

// ---------- ساخت نمایه ----------
const norm = w => foldForSearch(w);

/** گروه هم‌معنا بر پایهٔ هر واژه (فرم تاشده) */
export const TERM_TO_GROUPS = new Map();
/** واژه‌های هر گروه (فرم تاشده) */
export const GROUP_TERMS = new Map();

for (const g of SYNONYM_GROUPS) {
  const set = new Set();
  for (const w of g.words) {
    const f = norm(w);
    if (!f) continue;
    set.add(f);
    if (!TERM_TO_GROUPS.has(f)) TERM_TO_GROUPS.set(f, new Set());
    TERM_TO_GROUPS.get(f).add(g.id);
  }
  GROUP_TERMS.set(g.id, set);
}

export const GROUP_NAME = new Map(SYNONYM_GROUPS.map(g => [g.id, g.name]));

// ---------- بسط واژه ----------
const _expandCache = new Map();

/**
 * برای یک واژه، همهٔ واژه‌های مرتبط (هم‌گروه + لاتین) را برمی‌گرداند.
 * @param {string} folded واژهٔ تاشده
 * @returns {string[]} واژه‌های تاشدهٔ مرتبط (شامل خود واژه)
 */
export function expandTerm(folded) {
  if (_expandCache.has(folded)) return _expandCache.get(folded);
  const out = new Set([folded]);
  // نگاشت لاتین
  const latinHit = LATIN_MAP[folded];
  if (latinHit) out.add(norm(latinHit));
  // گروه‌های هم‌معنا: اگر واژه خودش کلید گروه است یا در متن گروه آمده
  const groups = new Set(TERM_TO_GROUPS.get(folded) || []);
  if (!groups.size) {
    // تطبیق جزئی: «قیرپاشی» شامل «قیر» است
    for (const [term, gs] of TERM_TO_GROUPS) {
      if (term.length >= 3 && folded.length >= 3 && (folded.includes(term) || term.includes(folded))) {
        for (const g of gs) groups.add(g);
      }
    }
  }
  for (const g of groups) for (const t of GROUP_TERMS.get(g) || []) out.add(t);
  const arr = [...out].filter(Boolean);
  _expandCache.set(folded, arr);
  return arr;
}

/** بسط مجموعه‌ای از واژه‌ها؛ نگاشت واژهٔ اصلی → واژه‌های بسط‌یافته */
export function expandTerms(foldedTerms) {
  const map = new Map();
  const all = new Set();
  for (const t of foldedTerms) {
    if (!t) continue;
    const ex = expandTerm(t);
    map.set(t, ex);
    for (const e of ex) all.add(e);
  }
  return { map, all: [...all] };
}

/** شناسهٔ گروه‌های هم‌معنایی که با یک متن تطبیق می‌کنند */
export function groupsInText(text) {
  const f = norm(text);
  if (!f) return [];
  const hits = new Set();
  for (const [term, gs] of TERM_TO_GROUPS) {
    if (term.length >= 3 && f.includes(term)) for (const g of gs) hits.add(g);
  }
  return [...hits];
}

/** واژه‌های یک گروه به شکل خام فارسی (برای نمایش) */
export function groupWords(id) {
  const g = SYNONYM_GROUPS.find(x => x.id === id);
  return g ? g.words : [];
}

// ---------- عبارت‌های چندواژه‌ای ----------
/** واژه‌های چندجزئی («لکه گیری»، «پلی اتیلن»، …) — بلندترین‌ها اول */
export const MULTIWORD_TERMS = [...new Set(SYNONYM_GROUPS.flatMap(g => g.words))]
  .filter(w => /\s/.test(w) && w.length >= 6)
  .map(w => ({ raw: w, fold: norm(w), parts: w.split(/\s+/).map(norm) }))
  .sort((a, b) => b.fold.length - a.fold.length);

/** عبارت‌های چندواژه‌ای حاضر در متن */
export function findPhrases(text) {
  const f = norm(text);
  if (!f) return [];
  const out = [];
  for (const t of MULTIWORD_TERMS) {
    if (f.includes(t.fold)) out.push(t);
  }
  return out;
}

// ---------- نمایش واژه ----------
const CANON = new Map();
for (const g of SYNONYM_GROUPS) {
  const canon = g.words[0];
  for (const w of g.words) CANON.set(norm(w), canon);
}

/** شکل خوانای یک واژهٔ تاشده (برای نمایش به کاربر) */
export function displayTerm(folded) {
  if (!folded) return '';
  const c = CANON.get(folded);
  if (c) return c;
  const latin = LATIN_MAP[folded];
  if (latin) return latin;
  return folded;
}

// ---------- تطبیق فازی ----------
/** فاصلهٔ ویرایشی محدود (با قطع زودهنگام) */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb;
  if (!lb) return la;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[lb];
}

/** آستانهٔ تحمل خطا بر پایهٔ طول واژه */
function tolerance(len) {
  if (len <= 4) return 0;
  if (len <= 6) return 1;
  return 2;
}

/**
 * تطبیق فازی یک واژه در متن (مقاوم به غلط املایی و نیم‌فاصله).
 * @param {string} haySpaced متن نرمال‌شده با فاصله
 * @param {string} term واژه (خام یا تاشده)
 * @param {number} [minLen=5] کمترین طول واژه برای تطبیق فازی
 */
export function fuzzyContains(haySpaced, term, minLen = 5) {
  if (!haySpaced || !term) return false;
  const t = norm(term);
  if (!t) return false;
  const hayFold = haySpaced.replace(/\s+/g, '');
  if (hayFold.includes(t)) return true;
  if (t.length < minLen) return false;
  const tol = tolerance(t.length);
  if (!tol) return false;

  const words = haySpaced.split(/\s+/).filter(Boolean);
  const nWords = t.split(/\s+/).length;
  const maxWin = Math.min(nWords + 1, 4);
  for (let w = 1; w <= maxWin; w++) {
    for (let i = 0; i + w <= words.length; i++) {
      const cand = words.slice(i, i + w).join('');
      if (Math.abs(cand.length - t.length) > tol) continue;
      if (editDistance(cand, t, tol) <= tol) return true;
    }
  }
  return false;
}

/** بهترین تطبیق فازی در متن — واژهٔ یافت‌شده را برمی‌گرداند */
export function fuzzyFind(haySpaced, terms, minLen = 5) {
  const hayFold = String(haySpaced || '').replace(/\s+/g, '');
  for (const t of terms) {
    const f = norm(t);
    if (f && hayFold.includes(f)) return { term: t, exact: true };
  }
  for (const t of terms) {
    if (fuzzyContains(haySpaced, t, minLen)) return { term: t, exact: false };
  }
  return null;
}

/** مترادف‌های یک واژهٔ کاربر (برای نمایش «منظورت این بود؟») */
export function synonymsOf(word) {
  const f = norm(word);
  const groups = TERM_TO_GROUPS.get(f);
  if (!groups) return [];
  const out = new Set();
  for (const g of groups) for (const t of GROUP_TERMS.get(g) || []) out.add(t);
  return [...out].filter(x => x !== f);
}
