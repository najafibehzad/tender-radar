// check-ui.mjs — بررسی رندر شدن اجزای کلیدی رابط کاربری از DOM
import fs from 'node:fs';

const h = fs.readFileSync(process.argv[2] || 'tools/_tmp/dom2.html', 'utf8');

const btn = h.match(/<button class="btn sm" id="btnRetryFailed"[^>]*>([\s\S]{0,300}?)<\/button>/);
console.log('دکمهٔ «اسکن منابع خطادار»:', btn ? 'موجود' : 'ناموجود');
if (btn) {
  const hidden = /display:\s*none/.test(btn[0]);
  console.log('  نمایش:', hidden ? 'مخفی (چون منبع خطادار نیست)' : 'نمایان');
  console.log('  متن:', btn[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

const fc = h.match(/<span id="failedCount"[^>]*>([^<]*)</);
console.log('تعداد منابع خطادار:', fc ? fc[1] : '?');

console.log('ردیف‌های جدول نتایج:', (h.match(/<tr data-idx=/g) || []).length);

const kpi = h.match(/<div class="kpis"[\s\S]*?<\/div>\s*<div class="resbar"/);
if (kpi) {
  const txt = kpi[0].replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').replace(/\s+/g, ' ');
  console.log('KPI:', txt.slice(0, 220));
}

console.log('خطای اتصال در صفحه:', /خطا در اتصال/.test(h) ? 'دارد ✗' : 'ندارد ✓');
console.log('چیپ‌های موضوع:', (h.match(/class="chip/g) || []).length);
console.log('کارت منبع:', (h.match(/class="srcitem/g) || []).length);
