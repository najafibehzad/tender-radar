// lib/diagnose.mjs — تشخیص ایراد منابع و پوشش، و ساخت «نسخهٔ درمان»
//
// خروجی: گزارشی از وضعیت هر منبع + فهرست ایرادهای پوششی + فهرست اقدام‌های
// اجراپذیر (rescan / redetect / enable / set-url / setting). اجرای اقدام‌ها
// در assistant.mjs با تزریق runScan انجام می‌شود تا این ماژول خالص بماند.
import { todayTehran } from './text.mjs';

/** دامنه‌های تأییدشدهٔ شهرداری‌ها (از تجربهٔ پروژه) — برای پیشنهاد اصلاح نشانی */
export const KNOWN_DOMAINS = {
  karaj: 'https://karaj.ir',
  tehran: 'https://tehran.ir',
  eslamshahr: 'https://eslamshahr.ir',
  varamin: 'https://evaramin.ir',
  gharchak: 'https://gharchak.ir',
  hashtgerd: 'https://hashtgerd.ir',
  taleghan: 'https://taleghan.ir',
  firuzkuh: 'https://firuzkuh.ir',
  nasimshahr: 'https://nasimshahr.ir',
  kamalshahr: 'https://kamalshahr.ir',
  damavand: 'https://damavand.ir',
  shahedshahr: 'https://shahedshahr.ir',
  nasirshahr: 'https://nasirshahr.ir',
  baghestan: 'https://baghestan.ir',
  chahardangeh: 'https://chahardangeh.ir',
  shahriar: 'https://shahriarcity.ir',
  fardis: 'https://shahrdarifardis.ir',
  malard: 'https://malard.ir',
};

/** دامنه‌های مسدود/ناپایدار از بیرون ایران (برای تفسیر خطای شبکه) */
export const GEO_SENSITIVE = /setadiran\.ir|karaj\.ir|tehran\.ir|eslamshahr\.ir|evaramin\.ir|malard\.ir|etend\.setadiran\.ir/i;

const SEV = { high: 3, med: 2, low: 1 };

/** طبقه‌بندی خطای یک منبع */
export function classifyError(err, url = '') {
  const e = String(err || '');
  if (!e) return null;
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network|aborted|UND_ERR/i.test(e)) {
    return {
      type: 'NETWORK', severity: 'high',
      title: 'خطای شبکه / قطع ارتباط',
      hint: GEO_SENSITIVE.test(url)
        ? 'این دامنه از بیرون ایران بسته یا ناپایدار است. برنامه را روی کامپیوتر داخل ایران اجرا کن؛ اگر داخل ایران هم خطا داد، دوباره اسکن کن (قطعی‌ها اغلب گذرا هستند).'
        : 'اتصال گذرا. یک اسکن مجدد معمولاً حل می‌کند؛ اگر تکرار شد، نشانی و مهلت درخواست را بررسی کن.',
    };
  }
  if (/HTTP\s*40[13]|\b403\b|\b401\b/i.test(e)) {
    return {
      type: 'BLOCKED', severity: 'high',
      title: 'دسترسی رد شد (۴۰۱/۴۰۳)',
      hint: GEO_SENSITIVE.test(url)
        ? 'سایت درخواست‌های خارج از ایران را رد می‌کند. اجرا از IP ایران لازم است.'
        : 'سایت درخواست خودکار را می‌بندد؛ روش استخراج را به RSS/sitemap تغییر بده یا مسیر آگهی اختصاصی بده.',
    };
  }
  if (/HTTP\s*5\d\d|\b50[0-9]\b/i.test(e)) {
    return { type: 'SERVER', severity: 'med', title: 'خطای سرور مقصد (۵xx)', hint: 'ایراد از سایت مقابل است. اسکن مجدد بزن؛ اگر تکرار شد، منبع را موقتاً خاموش نگه دار.' };
  }
  if (/HTTP\s*4\d\d/i.test(e)) {
    return { type: 'CLIENT', severity: 'med', title: 'خطای درخواست (۴xx)', hint: 'مسیر یا روش استخراج اشتباه است. «شناسایی مجدد» را بزن تا روش درست کشف شود.' };
  }
  if (/timeout|مهلت|timed out/i.test(e)) {
    return { type: 'TIMEOUT', severity: 'med', title: 'اتمام مهلت درخواست', hint: 'مهلت درخواست را بالا ببر (تنظیمات) یا منبع کند است؛ اسکن مجدد بزن.' };
  }
  return { type: 'UNKNOWN', severity: 'med', title: 'خطای نامشخص', hint: 'اسکن مجدد و «شناسایی مجدد» را امتحان کن.' };
}

/** بررسی سطح پوشش (تنظیمات سراسری) */
export function checkCoverage(registry, cache) {
  const s = registry.settings || {};
  const out = [];
  const lookback = Number(s.lookbackDays ?? 120);
  const cap = Number(s.maxItemsPerSource ?? 300);
  const wpq = Number(s.wpMaxQueries ?? 5);

  if (lookback < 30) {
    out.push({
      code: 'LOOKBACK_TINY', severity: 'high',
      title: `بازهٔ بازیابی فقط ${lookback} روز است`,
      detail: 'با این بازه، آگهی‌های قدیمی‌تر از چند هفته هرگز دیده نمی‌شوند و نتیجهٔ جستجوی موضوعی ناقص می‌شود.',
      fix: { kind: 'setting', payload: { lookbackDays: 150 }, label: 'بازه را به ۱۵۰ روز برگردان' },
    });
  } else if (lookback < 90) {
    out.push({
      code: 'LOOKBACK_SMALL', severity: 'med',
      title: `بازهٔ بازیابی ${lookback} روز است`,
      detail: 'برای مناقصه‌های موضوعی، بازهٔ ۱۵۰ روزه پوشش بهتری می‌دهد.',
      fix: { kind: 'setting', payload: { lookbackDays: 150 }, label: 'بازه را به ۱۵۰ روز ببر' },
    });
  }
  if (cap < 150) {
    out.push({
      code: 'CAP_SMALL', severity: 'med',
      title: `سقف آگهی هر منبع ${cap} است`,
      detail: 'منابعی مثل ستاد ایران بیش از این آگهی دارند؛ سقف کم، آگهی‌های قدیمی‌تر را حذف می‌کند.',
      fix: { kind: 'setting', payload: { maxItemsPerSource: 400 }, label: 'سقف را به ۴۰۰ برسان' },
    });
  }
  if (wpq < 5) {
    out.push({
      code: 'WP_QUERIES_LOW', severity: 'low',
      title: `تعداد پرس‌وجوی وردپرس ${wpq} است`,
      detail: 'سایت‌های وردپرسی با هر پرس‌وجو یک دسته آگهی می‌دهند؛ کمتر از ۵ پرس‌وجو پوشش را کم می‌کند.',
      fix: { kind: 'setting', payload: { wpMaxQueries: 5 }, label: 'به ۵ پرس‌وجو برگردان' },
    });
  }
  if (cache && cache.scannedAt) {
    const hours = (Date.now() - Date.parse(cache.scannedAt)) / 3600000;
    if (hours > 24) {
      out.push({
        code: 'CACHE_STALE', severity: 'high',
        title: `آخرین اسکن ${Math.round(hours)} ساعت پیش بوده`,
        detail: 'آگهی‌های امروز در نتیجه نیستند.',
        fix: { kind: 'rescan-all', label: 'اسکن کامل منابع' },
      });
    } else if (hours > 6) {
      out.push({
        code: 'CACHE_AGING', severity: 'med',
        title: `آخرین اسکن ${Math.round(hours)} ساعت پیش بوده`,
        detail: 'برای «بروز بودن» نتیجه، یک اسکن تازه بزن.',
        fix: { kind: 'rescan-all', label: 'اسکن تازه' },
      });
    }
  }
  return out;
}

/**
 * گزارش کامل تشخیص.
 * @param {object} registry
 * @param {object} cache
 */
export function diagnose(registry, cache) {
  const sources = (registry.sources || []);
  const report = new Map((cache?.sources || []).map(r => [r.id, r]));
  const active = sources.filter(s => !s._disabled);

  const items = [];
  const actions = [];

  for (const src of sources) {
    const rep = report.get(src.id);
    const rec = {
      id: src.id, name: src.name, city: src.city || '', province: src.province || '',
      url: src.url, adapter: src.adapter, disabled: !!src._disabled,
      ok: rep ? !!rep.ok : null,
      count: rep ? rep.count : null,
      ms: rep ? rep.ms : null,
      capped: rep ? !!rep.capped : false,
      droppedOld: rep ? (rep.droppedOld || 0) : 0,
      scannedAt: rep ? rep.scannedAt : null,
      issue: null, severity: 'low', fixes: [],
    };

    if (src._disabled) {
      rec.severity = 'low';
      rec.issue = { type: 'DISABLED', title: 'خاموش است', hint: 'منبع غیرفعال است و اسکن نمی‌شود.' };
      rec.fixes.push({ kind: 'enable', sourceId: src.id, label: 'روشن کردن منبع' });
    } else if (!rep) {
      rec.severity = 'med';
      rec.issue = { type: 'NEVER_SCANNED', title: 'هنوز اسکن نشده', hint: 'این منبع در آخرین گزارش اسکن حاضر نیست — یک اسکن بزن.' };
      rec.fixes.push({ kind: 'rescan', sourceId: src.id, label: 'اسکن این منبع' });
    } else if (!rep.ok) {
      const cls = classifyError(rep.error, src.url);
      rec.severity = cls ? cls.severity : 'high';
      rec.issue = { ...cls, raw: rep.error };
      if (rep.stale) {
        rec.issue.hint = `${rec.issue.hint} دادهٔ قبلی این منبع (${rep.count} آگهی) حفظ شد تا از دست نرود.`;
      }
      rec.fixes.push({ kind: 'rescan', sourceId: src.id, label: 'اسکن مجدد' });
      if (cls && (cls.type === 'CLIENT' || cls.type === 'BLOCKED' || cls.type === 'UNKNOWN')) {
        rec.fixes.push({ kind: 'redetect', sourceId: src.id, label: 'شناسایی مجدد روش استخراج' });
      }
      if (KNOWN_DOMAINS[src.id] && KNOWN_DOMAINS[src.id] !== src.url.replace(/\/+$/, '')) {
        rec.fixes.push({ kind: 'set-url', sourceId: src.id, payload: { url: KNOWN_DOMAINS[src.id] }, label: `اصلاح نشانی به ${KNOWN_DOMAINS[src.id]}` });
      }
      actions.push({ kind: 'rescan', sourceId: src.id, label: `اسکن مجدد ${src.name}`, severity: rec.severity });
    } else if ((rep.count || 0) === 0) {
      rec.severity = 'high';
      rec.issue = {
        type: 'EMPTY', title: 'پاسخ داد ولی صفر آگهی', severity: 'high',
        hint: 'یعنی صفحه باز شد اما هیچ آگهی استخراج نشد — تقریباً همیشه روش استخراج (آداپتر) یا مسیر آگهی‌ها اشتباه است.',
      };
      rec.fixes.push({ kind: 'redetect', sourceId: src.id, label: 'شناسایی مجدد سایت' });
      rec.fixes.push({ kind: 'rescan', sourceId: src.id, label: 'اسکن مجدد' });
      actions.push({ kind: 'redetect', sourceId: src.id, label: `شناسایی مجدد ${src.name}`, severity: 'high' });
    } else if (rep.capped) {
      rec.severity = 'med';
      rec.issue = {
        type: 'CAPPED', title: 'به سقف آگهی رسید', severity: 'med',
        hint: `آگهی‌های بیشتری وجود دارد ولی سقف بریده است (${rep.count} آگهی ثبت شد).`,
      };
      rec.fixes.push({ kind: 'setting', payload: { maxItemsPerSource: Math.max(400, (registry.settings?.maxItemsPerSource || 300) * 2) }, label: 'بالا بردن سقف' });
    } else {
      rec.severity = 'low';
      rec.issue = null;
    }

    items.push(rec);
  }

  const coverage = checkCoverage(registry, cache);
  for (const c of coverage) if (c.fix && c.fix.kind) actions.push({ ...c.fix, label: c.fix.label, severity: c.severity, code: c.code });

  const broken = items.filter(i => i.issue && SEV[i.severity] >= 2);
  const summary = {
    sourcesTotal: sources.length,
    sourcesActive: active.length,
    sourcesOk: items.filter(i => i.ok).length,
    sourcesFailed: items.filter(i => i.ok === false).length,
    sourcesEmpty: items.filter(i => i.issue && i.issue.type === 'EMPTY').length,
    sourcesDisabled: items.filter(i => i.disabled).length,
    issues: broken.length,
    high: items.filter(i => i.severity === 'high').length + coverage.filter(c => c.severity === 'high').length,
    med: items.filter(i => i.severity === 'med').length + coverage.filter(c => c.severity === 'med').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    today: todayTehran().jalali,
    cacheScannedAt: cache?.scannedAt || null,
    settings: registry.settings || {},
    itemCount: (cache?.items || []).length,
    summary,
    coverage,
    sources: items.sort((a, b) => SEV[b.severity] - SEV[a.severity] || String(a.name).localeCompare(String(b.name), 'fa')),
    actions: actions.sort((a, b) => SEV[b.severity || 'low'] - SEV[a.severity || 'low']),
  };
}

/** خلاصهٔ کوتاه متنی از گزارش (برای زمینهٔ مدل و پاسخ قالبی) */
export function diagnoseDigest(d) {
  const lines = [];
  lines.push(`منابع: ${d.summary.sourcesActive} فعال از ${d.summary.sourcesTotal} — ${d.summary.sourcesOk} سالم، ${d.summary.sourcesFailed} خطا، ${d.summary.sourcesEmpty} خالی، ${d.summary.sourcesDisabled} خاموش`);
  if (d.cacheScannedAt) {
    const h = Math.round((Date.now() - Date.parse(d.cacheScannedAt)) / 3600000);
    lines.push(`آخرین اسکن: ${h} ساعت پیش — ${d.itemCount} آگهی در حافظه`);
  }
  for (const c of d.coverage) lines.push(`پوشش [${c.severity}] ${c.title} — ${c.detail}`);
  for (const s of d.sources) {
    if (!s.issue) continue;
    if (s.severity === 'low' && s.issue.type === 'DISABLED') continue;
    lines.push(`منبع «${s.name}» [${s.issue.type}/${s.severity}]: ${s.issue.title}${s.issue.hint ? ' — ' + s.issue.hint : ''}${s.count != null ? ` (${s.count} آگهی)` : ''}`);
  }
  return lines.join('\n');
}
