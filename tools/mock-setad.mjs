// mock-setad.mjs — سرور ساختگی ستاد برای آزمون آداپتر (بدون نیاز به IP ایران)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 3799;
const LOG = process.env.MOCK_LOG || path.join('tools', '_tmp', 'mock-requests.jsonl');

/** ثبت دقیق هر درخواست ورودی — برای سنجش وفاداری پیاده‌سازی */
function record(req, u) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({
      at: new Date().toISOString(),
      method: req.method,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams.entries()),
      headers: req.headers,
    }) + '\n', 'utf8');
  } catch { /* بی‌اهمیت */ }
}
const cards = [
  { number: 5105003794000066, title: 'مناقصه عمومی اجرای آسفالت معابر سطح شهر فردیس', boardName: 'مناقصه', orgName: 'شهرداری فردیس', cityName: 'فردیس', provinceName: 'البرز', jalaliLastEditDate: '1405/07/01 - 09:00', jalaliDocumentDeadlineDate: '1405/07/10 - 13:00', jalaliSendDeadlineDate: '1405/07/12 - 13:00', tableId: 502712, reqId: null, basePrice: 45000000000, needType: null },
  { number: 5105003794000067, title: 'مزایده اجاره استخر یاس طالقان', boardName: 'مزایده', orgName: 'شهرداری طالقان', cityName: 'طالقان', provinceName: 'البرز', jalaliLastEditDate: '1405/06/30 - 09:00', jalaliDocumentDeadlineDate: '1405/07/05 - 13:00', jalaliSendDeadlineDate: '1405/07/07 - 13:00', tableId: 502713, reqId: null, basePrice: 9000000000, needType: null },
  { number: 5105003794000068, title: 'استعلام خرید مخازن زباله ۷۷۰ لیتری', boardName: 'استعلام', orgName: 'شهرداری گلستان', cityName: 'گلستان', provinceName: 'تهران', jalaliLastEditDate: '1405/06/29 - 09:00', jalaliDocumentDeadlineDate: null, jalaliSendDeadlineDate: '1405/07/03 - 13:00', tableId: null, reqId: 88421, basePrice: 3200000000, needType: 1431 },
];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = u.pathname;

  // صفحهٔ عمومی تابلوی مناقصه‌ها — میزبان جداگانه، بدون نیاز به کوکی (مثل واقعیت)
  if (p === '/etend/index.action') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!DOCTYPE html><html lang="fa" dir="rtl"><head><title>تابلوی اعلانات مناقصات</title></head><body>
      <h1>تابلوی اعلانات مرکزی مناقصات</h1>
      <table>
        <tr><td>۱</td><td><a href="/etend/centralBoardTenderDetails-execute.action?tenderId=900001">مناقصه عمومی احداث پارک محله‌ای شهر قدس</a></td><td>۱۴۰۵/۰۷/۰۲</td><td>۱۴۰۵/۰۷/۱۲</td></tr>
        <tr><td>۲</td><td><a href="/etend/centralBoardTenderDetails-execute.action?tenderId=900002">مناقصه اجرای آسفالت و جدول‌گذاری معابر شهریار</a></td><td>۱۴۰۵/۰۷/۰۱</td><td>۱۴۰۵/۰۷/۱۱</td></tr>
        <tr><td>۳</td><td><a href="/etend/centralBoardTenderDetails-execute.action?tenderId=900003">تجدید مناقصه عمومی زیرسازی معابر رباط کریم</a></td><td>۱۴۰۵/۰۶/۳۰</td><td>۱۴۰۵/۰۷/۰۹</td></tr>
      </table>
    </body></html>`);
  }

  // برد آگهی‌ها — **بدون نیاز به کوکی** (مطابق واقعیت و کد دیده‌بان)
  if (p === '/api/centralboard/cards/') {
    // اعتبارسنجی: کد شهر باید عدد باشد و sort با %2C کدگذاری شده باشد
    const sel = u.searchParams.get('selectedCities');
    const sort = u.searchParams.get('sort');
    if (!/^\d+(-\d+)?$/.test(String(sel || ''))) { res.writeHead(400); return res.end('{"error":"bad selectedCities"}'); }
    if (sort !== 'insertDate,desc') { res.writeHead(400); return res.end('{"error":"bad sort"}'); }
    // شبیه‌سازی گارد ستاد: هدر خاصی بفرست تا گارد فعال شود
    if (req.headers['x-mock-guard'] === '1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"flag":true}');
    }
    const page = Number(u.searchParams.get('pageNumber') || 0);
    const pageSize = Number(u.searchParams.get('pageSize') || 10);
    const slice = page === 0 ? cards.slice(0, pageSize) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ totalElements: cards.length, content: slice }));
  }

  // نقطهٔ پایانی قدیمی سشن — فقط برای سازگاری (دیگر استفاده نمی‌شود)
  if (p === '/centralboard') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<html><body>centralboard</body></html>');
  }

  // بدون کوکی → ۴۲۸ (رفتار واقعی سامانه برای سایر مسیرها)
  const cookie = req.headers.cookie || '';
  if (!cookie.includes('SESSION=')) { res.writeHead(428); return res.end('{"error":"precondition required"}'); }

  if (p === '/api/centralboard/cards/setadCity') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([{ locId: 430, name: 'تهران', parentLocId: null }, { locId: 431, name: 'البرز', parentLocId: null }]));
  }

  res.writeHead(404); res.end('nope');
});

server.listen(PORT, '127.0.0.1', () => console.log('mock setad on', PORT));
