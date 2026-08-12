/* 上線前的體檢。push 到 main 會直接部署，中間沒有別的關卡，所以這支是唯一的防線。
 *
 *   node tools/check.mjs
 *
 * 有任何一項不過就 exit 1。寧可擋下來，也不要讓壞掉的資料上線。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = p => path.join(ROOT, p);
const read = p => JSON.parse(fs.readFileSync(R(p), 'utf8'));

const fail = [], warn = [];
const ok = m => console.log('  ✔ ' + m);

/* ---------- 資料本身 ---------- */
const db = read('books.json');
const deepBooks = db.books.filter(b => b.deep);
ok(`books.json：${db.books.length} 本，其中 ${deepBooks.length} 本有深讀`);

const POLLUTION = /<\/?narrative|<parameter|antml|<\/?function|```/i;
let groups = 0, quotes = 0;
for (const b of deepBooks) {
  const f = `deep/${b.id}.json`;
  if (!fs.existsSync(R(f))) { fail.push(`${b.t}：books.json 標了 deep，但 ${f} 不存在`); continue; }
  const d = read(f);

  if (!d.chapters || !d.chapters.length) fail.push(`${b.t}：沒有章節`);
  for (const c of d.chapters || []) {
    if (!c.title) warn.push(`${b.t}：有一章沒有章名`);
    for (const g of c.groups || []) {
      groups++;
      for (const bl of g.blocks || []) {
        if (bl.t === 'quote') quotes++;
        if (POLLUTION.test(bl.v || '')) fail.push(`${b.t} p.${g.pages}：內容有標記殘留`);
        if (!(bl.v || '').trim()) fail.push(`${b.t} p.${g.pages}：有空的段落`);
      }
    }
  }
  // 同一頁碼出現兩次＝去重沒清乾淨，會讓同一段內容顯示兩遍
  const seen = {};
  for (const c of d.chapters || []) for (const g of c.groups || []) {
    if (!g.pages) continue;
    if (seen[g.pages]) fail.push(`${b.t}：p.${g.pages} 有兩個段落群（重複內容）`);
    seen[g.pages] = 1;
  }
  // 導讀的重點章節必須指得到真的章，否則畫面上是死連結
  for (const k of (d.claude && d.claude.keys) || []) {
    if (!(d.chapters || []).some(c => c.title === k.t))
      fail.push(`${b.t}：導讀指向不存在的章「${k.t}」`);
  }
}
ok(`深讀：${groups} 個段落群、${quotes} 句引文，無標記殘留、無重複頁碼`);

/* ---------- 速查卡 ---------- */
const { cards, topics } = read('cards.json');
const norm = s => String(s).replace(/[「」『』〔〕（）()，、。？！：；\s　·—－\-…"']/g, '');
const body = {};
for (const b of deepBooks) {
  const d = read(`deep/${b.id}.json`);
  body[b.id] = norm(d.chapters.flatMap(c => c.groups).map(g => g.blocks.map(x => x.v).join('')).join(''));
}
let says = 0, ghost = 0;
for (const c of cards) {
  if (!c.sit || !c.sit.length) fail.push(`${c.id}：沒有情境說法，搜不到`);
  if (!c.one) fail.push(`${c.id}：沒有一句話結論`);
  if (!topics.includes(c.topic)) fail.push(`${c.id}：主題「${c.topic}」不在清單裡`);
  if (!body[c.src.b]) { fail.push(`${c.id}：出處書 ${c.src.b} 沒有深讀筆記`); continue; }
  for (const s of c.say || []) {
    says++;
    // 這是整個 App 最重要的一條線：可以直接講出口的句子必須真的來自書
    if (!body[c.src.b].includes(norm(s))) { ghost++; fail.push(`${c.id}：例句在原書找不到「${s.slice(0, 24)}」`); }
  }
}
ok(`速查卡：${cards.length} 張、${says} 句例句全部回得到原文（憑空捏造 ${ghost} 句）`);

/* ---------- 前端會用到的檔案 ---------- */
const html = fs.readFileSync(R('index.html'), 'utf8');
for (const f of ['books.json', 'cards.json']) {
  if (!html.includes(f)) fail.push(`index.html 沒有引用 ${f}`);
}
for (const b of deepBooks) {
  if (!fs.existsSync(R(`covers/${(db.books.find(x => x.id === b.id) || {}).cover || ''}`.replace('covers/covers/', 'covers/'))))
    warn.push(`${b.t}：封面圖找不到（深讀頁的門面會空著）`);
}
// 頁面有多個 <script>，要逐塊檢查——貪婪比對會把兩塊之間的標籤也吃進去
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocks.length) fail.push('index.html 找不到任何 <script>');
blocks.forEach((code, i) => {
  try { new Function(code); }
  catch (e) { if (!/await is only valid/.test(e.message)) fail.push(`index.html 第 ${i + 1} 塊 script 語法錯誤：${e.message}`); }
});
try { new Function(fs.readFileSync(R('sw.js'), 'utf8')); }
catch (e) { fail.push(`sw.js 語法錯誤：${e.message}`); }
JSON.parse(fs.readFileSync(R('manifest.webmanifest'), 'utf8'));
ok('index.html 語法正確、資料檔都引用得到');

/* ---------- 不該上線的東西 ---------- */
const ignore = fs.readFileSync(R('.vercelignore'), 'utf8');
for (const p of ['raw/', 'pipeline/', 'tools/', '*.bak']) {
  if (!ignore.includes(p)) fail.push(`.vercelignore 沒有擋 ${p}`);
}
ok('.vercelignore 擋住了原始照片與管線資料');

/* ---------- 結果 ---------- */
console.log('');
if (warn.length) { console.log('提醒：'); warn.forEach(w => console.log('  · ' + w)); console.log(''); }
if (fail.length) {
  console.error(`不能上線，${fail.length} 個問題：`);
  fail.forEach(f => console.error('  ✘ ' + f));
  process.exit(1);
}
console.log('全部通過，可以上線。');
