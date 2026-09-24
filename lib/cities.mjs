// lib/cities.mjs — فهرست شهرها و استان‌ها برای تشخیص موقعیت از متن آگهی
import { foldForSearch } from './text.mjs';

/** استان‌ها (نام‌های رایج) */
export const PROVINCES = [
  'تهران', 'البرز', 'اصفهان', 'خراسان رضوی', 'خراسان شمالی', 'خراسان جنوبی', 'فارس', 'آذربایجان شرقی',
  'آذربایجان غربی', 'خوزستان', 'قم', 'کرمانشاه', 'گیلان', 'مازندران', 'گلستان', 'یزد', 'کرمان',
  'مرکزی', 'هرمزگان', 'سیستان و بلوچستان', 'اردبیل', 'قزوین', 'زنجان', 'لرستان', 'کردستان',
  'همدان', 'سمنان', 'بوشهر', 'چهارمحال و بختیاری', 'کهگیلویه و بویراحمد', 'ایلام', 'گلپایگان',
];

/**
 * شهرهای هدف (تهران و البرز) + شهرهای بزرگ کشور برای فیلتر تجمیع‌کننده‌ها.
 * province = استان متناظر
 */
export const CITIES = [
  // --- استان تهران ---
  { name: 'تهران', province: 'تهران', aliases: ['منطقه ۱', 'منطقه ۲', 'منطقه ۳', 'منطقه ۴', 'منطقه ۵', 'منطقه ۶', 'منطقه ۷', 'منطقه ۸', 'منطقه ۹', 'منطقه ۱۰', 'منطقه ۱۱', 'منطقه ۱۲', 'منطقه ۱۳', 'منطقه ۱۴', 'منطقه ۱۵', 'منطقه ۱۶', 'منطقه ۱۷', 'منطقه ۱۸', 'منطقه ۱۹', 'منطقه ۲۰', 'منطقه ۲۱', 'منطقه ۲۲'] },
  { name: 'اسلامشهر', province: 'تهران', aliases: ['اسلام شهر'] },
  { name: 'شهریار', province: 'تهران' },
  { name: 'شهر قدس', province: 'تهران', aliases: ['قدس', 'شهرقدس'] },
  { name: 'ملارد', province: 'تهران' },
  { name: 'رباط کریم', province: 'تهران', aliases: ['رباطکریم'] },
  { name: 'پاکدشت', province: 'تهران' },
  { name: 'ورامین', province: 'تهران' },
  { name: 'پیشوا', province: 'تهران' },
  { name: 'قرچک', province: 'تهران' },
  { name: 'پردیس', province: 'تهران' },
  { name: 'دماوند', province: 'تهران' },
  { name: 'فیروزکوه', province: 'تهران' },
  { name: 'شمیرانات', province: 'تهران', aliases: ['شمیران', 'تجریش'] },
  { name: 'بهارستان', province: 'تهران' },
  { name: 'چهاردانگه', province: 'تهران', aliases: ['چهار دانگه'] },
  { name: 'نسیم شهر', province: 'تهران', aliases: ['نسیمشهر'] },
  { name: 'گلستان', province: 'تهران' },
  { name: 'صالحیه', province: 'تهران' },
  { name: 'باغستان', province: 'تهران' },
  { name: 'شاهدشهر', province: 'تهران', aliases: ['شاهد شهر'] },
  { name: 'وحیدیه', province: 'تهران' },
  { name: 'صباشهر', province: 'تهران', aliases: ['صبا شهر'] },
  { name: 'نصیرشهر', province: 'تهران', aliases: ['نصیر شهر'] },
  { name: 'اندیشه', province: 'تهران' },
  { name: 'شهر ری', province: 'تهران', aliases: ['ری'] },
  { name: 'کهریزک', province: 'تهران' },
  { name: 'فشافویه', province: 'تهران', aliases: ['حسن آباد فشافویه'] },
  { name: 'چهاردانگه', province: 'تهران' },
  { name: 'لواسان', province: 'تهران' },
  { name: 'رودهن', province: 'تهران' },
  { name: 'بومهن', province: 'تهران' },
  { name: 'آبسرد', province: 'تهران' },
  { name: 'شهرآباد', province: 'تهران' },
  { name: 'ارجمند', province: 'تهران' },
  { name: 'کهنک', province: 'تهران' },
  { name: 'احمدآباد مستوفی', province: 'تهران' },
  { name: 'خاورشهر', province: 'تهران' },
  { name: 'شهرک', province: 'تهران' },

  // --- استان البرز ---
  { name: 'کرج', province: 'البرز', aliases: ['کمال شهر', 'کمالشهر', 'مهرشهر', 'گوهردشت', 'عظیمیه', 'باغستان کرج', 'شهرک جهان', 'حصارک', 'فردیس کرج'] },
  { name: 'فردیس', province: 'البرز', aliases: ['فردیس کرج'] },
  { name: 'محمدشهر', province: 'البرز', aliases: ['محمد شهر'] },
  { name: 'ماهدشت', province: 'البرز' },
  { name: 'مشکین‌دشت', province: 'البرز', aliases: ['مشکیندشت', 'مشکین دشت'] },
  { name: 'گرمدره', province: 'البرز' },
  { name: 'اشتهارد', province: 'البرز' },
  { name: 'نظرآباد', province: 'البرز', aliases: ['نظر آباد'] },
  { name: 'هشتگرد', province: 'البرز', aliases: ['هشتگرد جدید', 'شهر جدید هشتگرد'] },
  { name: 'ساوجبلاغ', province: 'البرز' },
  { name: 'چهارباغ', province: 'البرز' },
  { name: 'طالقان', province: 'البرز' },
  { name: 'تنکمان', province: 'البرز' },
  { name: 'کوهسار', province: 'البرز' },
  { name: 'آسارا', province: 'البرز' },
  { name: 'شهرستانک', province: 'البرز' },

  // --- شهرهای بزرگ کشور (برای فیلتر تجمیع‌کننده‌ها) ---
  { name: 'اصفهان', province: 'اصفهان' },
  { name: 'مشهد', province: 'خراسان رضوی' },
  { name: 'شیراز', province: 'فارس' },
  { name: 'تبریز', province: 'آذربایجان شرقی' },
  { name: 'اهواز', province: 'خوزستان' },
  { name: 'قم', province: 'قم' },
  { name: 'کرمانشاه', province: 'کرمانشاه' },
  { name: 'رشت', province: 'گیلان' },
  { name: 'یزد', province: 'یزد' },
  { name: 'کرمان', province: 'کرمان' },
  { name: 'اراک', province: 'مرکزی' },
  { name: 'زاهدان', province: 'سیستان و بلوچستان' },
  { name: 'اردبیل', province: 'اردبیل' },
  { name: 'بندرعباس', province: 'هرمزگان' },
  { name: 'ساری', province: 'مازندران' },
  { name: 'گرگان', province: 'گلستان' },
  { name: 'بجنورد', province: 'خراسان شمالی' },
  { name: 'بیرجند', province: 'خراسان جنوبی' },
  { name: 'سنندج', province: 'کردستان' },
  { name: 'خرم‌آباد', province: 'لرستان', aliases: ['خرم آباد'] },
  { name: 'ایلام', province: 'ایلام' },
  { name: 'شهرکرد', province: 'چهارمحال و بختیاری' },
  { name: 'سمنان', province: 'سمنان' },
  { name: 'قزوین', province: 'قزوین' },
  { name: 'زنجان', province: 'زنجان' },
  { name: 'ارومیه', province: 'آذربایجان غربی' },
  { name: 'بوشهر', province: 'بوشهر' },
  { name: 'یاسوج', province: 'کهگیلویه و بویراحمد' },
  { name: 'همدان', province: 'همدان' },
  { name: 'قشم', province: 'هرمزگان' },
  { name: 'کیش', province: 'هرمزگان' },
  { name: 'عسلویه', province: 'بوشهر' },
  { name: 'ماهشهر', province: 'خوزستان' },
  { name: 'آبادان', province: 'خوزستان' },
  { name: 'دزفول', province: 'خوزستان' },
  { name: 'نجف‌آباد', province: 'اصفهان', aliases: ['نجف آباد'] },
  { name: 'کاشان', province: 'اصفهان' },
  { name: 'خمینی‌شهر', province: 'اصفهان' },
  { name: 'بروجن', province: 'چهارمحال و بختیاری' },
];

// نمایهٔ جستجو: فرم تاشدهٔ نام و نام‌های جایگزین
const CITY_INDEX = CITIES.flatMap(c =>
  [c.name, ...(c.aliases || [])].map(a => ({ fold: foldForSearch(a), city: c.name, province: c.province, alias: a }))
).sort((a, b) => b.fold.length - a.fold.length); // طولانی‌ترها اول (جلوگیری از تطبیق جزئی)

const PROVINCE_INDEX = PROVINCES.map(p => ({ fold: foldForSearch(p), name: p }))
  .sort((a, b) => b.fold.length - a.fold.length);

/**
 * تشخیص شهر و استان از متن.
 * @param {string} text متن تاشده یا خام
 * @returns {{city:string, province:string, matched:string}|null}
 */
export function inferLocation(text) {
  if (!text) return null;
  const f = foldForSearch(text);
  if (!f) return null;
  for (const e of CITY_INDEX) {
    if (e.fold.length >= 3 && f.includes(e.fold)) return { city: e.city, province: e.province, matched: e.alias };
  }
  for (const p of PROVINCE_INDEX) {
    if (p.fold.length >= 3 && f.includes(p.fold)) return { city: '', province: p.name, matched: p.name };
  }
  return null;
}

/** آیا نام، یک شهر شناخته‌شده است؟ */
export function isKnownCity(name) {
  const f = foldForSearch(name);
  return CITY_INDEX.some(e => e.fold === f);
}

export function provinceOf(cityName) {
  const f = foldForSearch(cityName);
  const hit = CITY_INDEX.find(e => e.fold === f);
  return hit ? hit.province : '';
}
