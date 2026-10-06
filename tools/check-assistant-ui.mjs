// tools/check-assistant-ui.mjs — آزمون رابط کاربری دستیار با مرورگر واقعی
// اجرا: از پوشهٔ workspace با NODE_PATH تنظیم‌شده
import puppeteer from 'puppeteer';

const URL = process.env.TR_URL || 'http://127.0.0.1:3731/';
const OUT = process.env.OUT_DIR || 'C:/Users/behzad/tender-radar/tools/_tmp';
const QUERY = process.env.Q || 'جدول‌گذاری فردیس';
const WAIT = Number(process.env.WAIT || 45000);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 1.2 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
page.on('requestfailed', r => { if (!/favicon/.test(r.url())) errs.push('REQFAIL: ' + r.url() + ' ' + r.failure()?.errorText); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));

const has = await page.evaluate(() => ({
  fab: !!document.getElementById('aiFab'),
  panel: !!document.getElementById('aiPanel'),
  btn: !!document.getElementById('btnAssistant'),
  cfgModal: !!document.getElementById('aiCfgModal'),
}));
console.log('اجزای رابط:', JSON.stringify(has));

// باز کردن پنل
await page.evaluate(() => document.getElementById('aiFab').click());
await new Promise(r => setTimeout(r, 600));
console.log('پنل باز شد:', await page.evaluate(() => document.getElementById('aiPanel').classList.contains('on')));

// تنظیم گزینه‌ها: بدون به‌روزرسانی زنده (سریع)، با مدل زبانی
await page.evaluate(() => { const l = document.getElementById('aiLive'); if (l) l.checked = false; });

// نوشتن پرسش و ارسال
await page.evaluate(q => { document.getElementById('aiText').value = q; }, QUERY);
await page.evaluate(() => document.getElementById('aiSend').click());

// انتظار برای پایان پاسخ
const t0 = Date.now();
let done = false;
while (Date.now() - t0 < WAIT) {
  await new Promise(r => setTimeout(r, 900));
  const st = await page.evaluate(() => {
    const msgs = document.querySelectorAll('#aiBody .ai-msg.ai');
    const last = msgs[msgs.length - 1];
    return {
      count: msgs.length,
      steps: last ? last.querySelectorAll('.ai-step').length : 0,
      running: last ? last.querySelectorAll('.ai-step.run').length : 0,
      cards: last ? last.querySelectorAll('.ai-card').length : 0,
      textLen: last ? (last.querySelector('.ai-md')?.innerText || '').length : 0,
      meta: last ? (last.querySelector('.ai-meta')?.innerText || '') : '',
      sendDisabled: document.getElementById('aiSend').disabled,
    };
  });
  if (st.count && !st.running && st.textLen > 0 && !st.sendDisabled) { done = true; console.log('پایان پاسخ:', JSON.stringify(st)); break; }
}

await page.screenshot({ path: OUT + '/assistant-panel.png' });
const report = await page.evaluate(() => {
  const last = document.querySelectorAll('#aiBody .ai-msg.ai');
  const el = last[last.length - 1];
  return {
    steps: [...el.querySelectorAll('.ai-step')].map(s => s.innerText.replace(/\s+/g, ' ').trim()),
    chips: [...el.querySelectorAll('.ai-chip')].map(s => s.innerText.trim()),
    answer: (el.querySelector('.ai-md')?.innerText || '').slice(0, 900),
    cards: [...el.querySelectorAll('.ai-card')].map(c => c.innerText.replace(/\s+/g, ' ').trim().slice(0, 130)),
    actions: [...el.querySelectorAll('.ai-act')].map(a => a.innerText.trim()),
    meta: el.querySelector('.ai-meta')?.innerText || '',
  };
});
console.log('\n=== گام‌ها ===\n' + report.steps.join('\n'));
console.log('\n=== چیپ‌های تفسیر ===\n' + report.chips.join(' | '));
console.log('\n=== پاسخ ===\n' + report.answer);
console.log('\n=== کارت نتایج (' + report.cards.length + ') ===\n' + report.cards.join('\n'));
console.log('\n=== دکمه‌های اقدام ===\n' + report.actions.join(' | '));
console.log('\n=== متا ===\n' + report.meta);
console.log('\n=== خطاها ===\n' + (errs.length ? errs.slice(0, 12).join('\n') : 'ندارد ✓'));
console.log('\ndone=' + done);

await browser.close();
