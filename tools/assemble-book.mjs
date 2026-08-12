/* 把 workflow 的跨頁重述組成 deep/<bookId>.json。
 *
 * 用法：node assemble-book.mjs <bookId> <task-output.json> [補跑的.json ...]
 * 後面的檔案會覆蓋前面同名跨頁的結果，補跑失敗的那幾張時直接加在後面就好。
 *
 * 跟第一本那支一次性腳本的差別：章別改由書眉的章號決定，不再寫死頁碼範圍。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 以這支腳本的位置推出專案根目錄，不要寫死絕對路徑
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [bookId, ...taskPaths] = process.argv.slice(2);
if (!bookId || !taskPaths.length) {
  console.error('用法：node assemble-book.mjs <bookId> <task-output.json> [...]');
  process.exit(1);
}

const BOOKS = path.join(ROOT, 'books.json');
const db = JSON.parse(fs.readFileSync(BOOKS, 'utf8'));
const book = db.books.find(b => b.id === bookId);
if (!book) { console.error(`books.json 裡沒有 ${bookId}`); process.exit(1); }

// 合併多次跑的結果，保留第一次的檔案順序
const order = [], byFile = new Map();
for (const p of taskPaths) {
  for (const sp of JSON.parse(fs.readFileSync(p, 'utf8')).result.spreads) {
    if (!byFile.has(sp.file)) order.push(sp.file);
    if (sp.data || !byFile.has(sp.file)) byFile.set(sp.file, sp.data);
  }
}

/* 視覺模型會把異體字正規化掉（書上印「祕」卻讀成「秘」），同一章就被拆成兩章。
   分組時把常見異體字折成同一個字；顯示用的章名仍取原樣，由多數決決定。 */
const VARIANTS = { 祕:'秘', 裏:'裡', 爲:'為', 臺:'台', 着:'著', 羣:'群', 産:'產', 温:'溫', 綫:'線', 衆:'眾', 牀:'床', 麪:'麵' };
const normKey = s => String(s || '').replace(/[祕裏爲臺着羣産温綫衆牀麪]/g, c => VARIANTS[c]);

/* 逐字比對照片後確認的寫法。放這裡而不是直接改資料，是為了留下「這是人工核對過的」痕跡。 */
const TITLE_FIX = {
  '自制力的秘密': '自制力的祕密',   // IMG_4819 書眉放大確認是礻部的「祕」
};

/* 頁碼覆蓋值。橫拍（書躺著、文字轉 90 度）的照片，頁碼會被系統性誤讀，
   而且兩次跑會給出不同答案——《看穿內心情緒》那批 8 張橫拍就有 4 張兩輪不一致。
   頁碼現在是去重的唯一判準，讀錯會把不同跨頁合併掉、靜默丟內容，
   所以這幾張由我把照片轉正後逐張看過，寫死在這裡。 */
const PAGE_FIX = {
  'IMG_5109': '134-135',
  'IMG_5111': '138-139',
  'IMG_5112': '140-141',
  'IMG_5113': '164-165',
  'IMG_5114': '166-167',
  'IMG_5115': '168-169',
  'IMG_5116': '170-171',
  'IMG_5117': '172-173',
};

/* 節標題覆蓋值。跟 PAGE_FIX 同一批橫拍照片：頁碼讀錯的那幾張，
   節標題也跟著錯位（p.166-167 被掛上前一節的標題）或整個漏掉。
   一樣是我把照片轉正後逐張看過的結果。 */
const HEADING_FIX = {
  'IMG_5109': '13 可否信任？看「攀談頻率」能知道',
  'IMG_5111': '14 偏愛哪種異性？暗藏性格大不同',
  'IMG_5114': '09 抽菸手勢與吐煙方式，直通內心世界',
};

const POLLUTION = /<\/?narrative|<parameter|antml|<\/?function|```/i;
// agent 偶爾會在章名後面補一句說明（「書眉只看得到⋯前面被裁掉」），那不是章名
const META_NOTE = /（[^）]*(書眉|裁掉|看不到|看得到|照片|模糊)[^）]*）/g;
const problems = [], repairs = [], merges = [], dedupes = [], partFills = [], pageFixes = [], headFixes = [], corrected = [];

/* 拿原始照片抽驗後發現的事實錯誤，更正寫在 pipeline/corrections.json。
   在這裡套用而不是手改 deep/*.json，是為了重新組裝時不會被洗掉，
   而且每一筆都留著「為什麼改、依據哪張照片」。 */
const CORR = (() => {
  const f = path.join(ROOT, 'pipeline', 'corrections.json');
  if (!fs.existsSync(f)) return [];
  return (JSON.parse(fs.readFileSync(f, 'utf8'))[bookId] || []);
})();
const applyCorr = txt => {
  let out = txt;
  for (const c of CORR) {
    if (!out.includes(c.from)) continue;
    out = out.split(c.from).join(c.to);
    corrected.push(`${c.src}：${c.why}`);
    c._hit = true;
  }
  return out;
};

/* ---------- 一、收跨頁（維持檔案順序） ---------- */
const rows = [];
let skipped = 0;
for (const file of order) {
  const d = byFile.get(file);
  if (!d) { problems.push(`${file}: 沒有資料（agent 失敗）`); continue; }
  if (d.skip) { skipped++; continue; }

  if (POLLUTION.test(d.narrative || '')) problems.push(`${file}: narrative 有標記殘留`);
  if (!(d.narrative || '').trim()) { problems.push(`${file}: 敘事是空的（但沒標 skip）`); continue; }

  const head = (() => {
    const h = HEADING_FIX[file];
    if (h && h !== (d.heading || '').trim()) headFixes.push(`${file}：agent 讀成「${(d.heading||'(空)')}」，人工核對是「${h}」`);
    return h || (d.heading || '').trim();
  })();
  const blocks = applyCorr(d.narrative || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
    .map(v => ({ t: 'text', v }));

  const rawPages = PAGE_FIX[file] || d.pages || '';
  if (PAGE_FIX[file] && String(d.pages || '') !== PAGE_FIX[file]) {
    pageFixes.push(`${file}：agent 讀成 p.${d.pages || '?'}，人工核對是 p.${PAGE_FIX[file]}`);
  }
  const nums = String(rawPages).match(/\d+/g) || [];
  const from = nums.length ? +nums[0] : null;
  const to = nums.length ? +(nums[1] || nums[0]) : null;

  (d.keyQuotes || [])
    .filter(q => q.text && q.text.trim())
    .filter(q => q.text.trim() !== head)
    .filter(q => {
      if (POLLUTION.test(q.text)) { problems.push(`${file}: 引文有標記殘留`); return false; }
      return true;
    })
    .sort((a, b) => (b.redbox ? 1 : 0) - (a.redbox ? 1 : 0))
    .slice(0, 4)
    .forEach(q => {
      const qp = (String(q.page || '').match(/\d+/) || [])[0] || (from != null ? String(from) : '');
      blocks.push({ t: 'quote', v: q.text.trim(), p: qp, kind: q.redbox ? '書中強調' : '' });
    });

  rows.push({
    file, from, to,
    // 有些書在「章」之上還有一層（《深度說服力》的「原則 1 獨特」）
    part: (d.part || '').trim(),
    no: (() => { const n = (String(d.chapterNo || '').match(/\d+/) || [''])[0]; return n ? String(parseInt(n, 10)) : ''; })(),
    noRaw: (String(d.chapterNo || '').match(/\d+/) || [''])[0],
    ct: (() => { const c = (d.chapter || '').replace(META_NOTE, '').trim(); return TITLE_FIX[c] || c; })(),
    h: head, blocks
  });
}

// 更正對不上原文＝資料變了卻沒人發現，比沒更正更危險
for (const c of CORR) if (!c._hit) problems.push(`更正對不上原文：「${c.from.slice(0, 28)}」（${c.src}）`);

if (problems.length) {
  console.error('停止組裝，發現問題：');
  problems.forEach(p => console.error('  ' + p));
  process.exit(1);
}

/* ---------- 一之二、同一個跨頁被拍多張就去重 ----------
   主人有時候會重拍同一個跨頁（角度、對焦不同），檔案雜湊不同但內容一樣。
   照頁碼分組，內容重疊超過一半就只留最完整的那一份。
   沒有頁碼的（章首頁、章末重點整理）不參與，它們本來就不印頁碼。 */
const grams = s => {
  const t = String(s).replace(/[\s　，、。？！：；「」『』（）()]/g, '');
  const o = new Set();
  for (let i = 0; i < t.length - 7; i++) o.add(t.slice(i, i + 8));
  return o;
};
const overlap = (a, b) => {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let i = 0; A.forEach(x => { if (B.has(x)) i++; });
  return i / Math.min(A.size, B.size);
};
const bucket = {};
for (const r of rows) {
  if (r.from == null) continue;
  const k = `${r.from}-${r.to}`;
  (bucket[k] = bucket[k] || []).push(r);
}
/* 判準是頁碼不是文字相似度。頁碼印在書上是事實；文字則是 agent 各自改寫的，
   同一個跨頁被拍四張時，四份重述的 n-gram 重疊只有 24–45%，用相似度門檻會全部漏掉。
   重疊率仍然算出來當健康指標：低到不像同一段內容時，多半是某張的頁碼讀錯了。 */
const dupOut = new Set();
for (const [k, group] of Object.entries(bucket)) {
  if (group.length < 2) continue;
  const text = r => r.blocks.filter(b => b.t === 'text').map(b => b.v).join('');
  const keep = group.slice().sort((a, b) => text(b).length - text(a).length)[0];
  for (const r of group) {
    if (r === keep) continue;
    const ov = overlap(text(keep), text(r));
    dupOut.add(r);
    dedupes.push(`p.${k}：${r.file} 與 ${keep.file} 同頁（重疊 ${(ov*100).toFixed(0)}%），保留較完整的 ${keep.file}`);
    if (ov < 0.15) problems.push(`${r.file} 與 ${keep.file} 都標成 p.${k}，但內容重疊只有 ${(ov*100).toFixed(0)}%——可能有一張的頁碼讀錯了，請人工確認`);
  }
}
if (dupOut.size) {
  for (let i = rows.length - 1; i >= 0; i--) if (dupOut.has(rows[i])) rows.splice(i, 1);
}

/* ---------- 二、排序：頁碼優先，讀不到頁碼的沿用檔案順序 ---------- */
// 不替讀不到頁碼的跨頁編一個頁碼出來——它只是排在前一張後面，畫面上也不標頁碼
let last = 0;
rows.forEach(r => {
  if (r.from != null) { r.key = r.from; last = r.from; }
  else { r.key = last + 0.5; }
});
rows.sort((a, b) => a.key - b.key);

/* ---------- 三、補章號、章名取多數決 ---------- */
/* 章號的第一位數字有時會被照片邊界裁掉（讀成 9，其實是 59）。
   已依頁碼排序，章號必然遞增；只有在「補上前綴後恰好只有一個值落在
   前後章之間」時才修，湊不出唯一解就原樣留著並警告。 */
const numbered = rows.filter(r => r.no);
for (let i = 0; i < numbered.length; i++) {
  const cur = +numbered[i].no;
  const prev = i > 0 ? +numbered[i - 1].no : 0;
  if (cur >= prev) continue;      // 同一章的連續跨頁章號相同，只有「變小」才是被裁掉了
  const next = (() => { for (let j = i + 1; j < numbered.length; j++) if (+numbered[j].no > prev) return +numbered[j].no; return Infinity; })();
  const cand = [];
  for (let pre = 1; pre <= 9; pre++) {
    const x = +(String(pre) + numbered[i].no);
    if (x > prev && x < next) cand.push(x);
  }
  if (cand.length === 1) {
    repairs.push(`章號 ${numbered[i].no} → ${cand[0]}（夾在 ${prev} 與 ${next === Infinity ? '結尾' : next} 之間，唯一解）  ${numbered[i].file}`);
    // noRaw 是顯示用的，也要一起修，否則畫面上會退回被裁掉的那個數字
    numbered[i].no = numbered[i].noRaw = String(cand[0]);
  } else {
    problems.push(`${numbered[i].file}: 章號 ${numbered[i].no} 排在 ${prev} 之後，補不出唯一解（候選 ${cand.join('/') || '無'}）`);
  }
}

// 去重與章號修補階段也會發現問題，這裡要再擋一次（上面那道在它們之前）
if (problems.length) {
  console.error('停止組裝，發現需要人工確認的問題：');
  problems.forEach(p => console.error('  ' + p));
  process.exit(1);
}
if (repairs.length) { console.log('自動修補：'); repairs.forEach(r => console.log('  ' + r)); }

/* 章別 key：不同書的書眉格式不一樣——《講好你的故事》印「25 ｜ 章名」，
   《原子習慣》只印章名不印章號。所以：有章號優先用章號；只有章名時，
   若同一個章名在別處看過章號就沿用那個章號，否則直接拿章名當 key；
   兩者都沒有就是前一章的續頁。 */
// 帶刪節號＝agent 自己說沒讀全，這種章名沒資格開新章，只能當續頁
const usableCt = r => (r.ct && !/⋯|…|\.\.\./.test(r.ct)) ? r.ct : '';

const titleToNo = {};
for (const r of rows) if (r.no && usableCt(r)) titleToNo[normKey(usableCt(r))] = r.no;

let carry = '';
for (const r of rows) {
  const ck = normKey(usableCt(r));
  const k = r.no || titleToNo[ck] || ck || '';
  r.key = k || carry || '?';
  if (k) carry = k;
}

const vote = {};
for (const r of rows) {
  // 帶刪節號的是 agent 自己表示沒讀全，不能拿來當章名
  if (!r.ct || /⋯|…|\.\.\./.test(r.ct)) continue;
  (vote[r.key] = vote[r.key] || {})[r.ct] = (vote[r.key][r.ct] || 0) + 1;
}
// 票數優先；同票取較長的寫法（短的通常是書眉被裁掉一截）
const titleOf = k => {
  const v = vote[k];
  if (!v) return /^\d+$/.test(k) ? '' : k;
  return Object.entries(v).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
};
/* 顯示用的章號保留書上的寫法（這本印「01」，上一本印「25」），
   但分組一律用去掉前導零的整數，否則「04」和「4」會被當成兩章。 */
const noVote = {};
for (const r of rows) if (r.noRaw) (noVote[r.key] = noVote[r.key] || {})[r.noRaw] = (noVote[r.key][r.noRaw] || 0) + 1;
const noOf = {};
for (const k of Object.keys(noVote))
  noOf[k] = Object.entries(noVote[k]).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];

/* ---------- 四、依章分組 ---------- */
const chapters = [];
for (const r of rows) {
  const cur = chapters[chapters.length - 1];
  const t = titleOf(r.key);
  if (cur && cur.key === r.key) {
    // 同一章，直接接上
  } else if (cur && !noOf[r.key] && cur.title && t &&
             (cur.title.includes(t) || t.includes(cur.title))) {
    // 書眉被裁掉一截會把同一章拆成兩章（「難以抗拒」vs「如何讓習慣變得難以抗拒」），
    // 章名互為子字串就併回去，並升級成較完整的那個寫法
    if (t.length > cur.title.length) cur.title = t;
    merges.push(`${r.file}：章名「${t}」併入「${cur.title}」`);
  } else {
    chapters.push({ key: r.key, label: noOf[r.key] || '', title: t, part: r.part || '', groups: [] });
  }
  chapters[chapters.length - 1].groups.push({
    pages: r.from == null ? '' : (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`),
    h: r.h, blocks: r.blocks
  });
}
chapters.forEach(c => {
  // 章首頁往往讀不到 part，跟同章其他跨頁借
  if (!c.part) { const r = rows.find(x => x.key === c.key && x.part); if (r) c.part = r.part; }
});
/* 整章都只有章首頁（讀不到書眉）時 part 會是空的。
   只在「前後兩章屬於同一個 part」時才補——夾在中間必然同屬，這是唯一解；
   前後不同就留空，不猜。 */
chapters.forEach((c, i) => {
  if (c.part || i === 0 || i === chapters.length - 1) return;
  const a = chapters[i - 1].part, b = chapters[i + 1].part;
  if (a && a === b) { c.part = a; partFills.push(`${c.label || c.title}：補上「${a}」（前後兩章同屬，唯一解）`); }
});
chapters.forEach(c => {
  const ns = c.groups.flatMap(g => (g.pages.match(/\d+/g) || []).map(Number));
  if (ns.length) {
    const f = Math.min(...ns), t = Math.max(...ns);
    c.span = f === t ? `p.${f}` : `p.${f}–${t}`;
  } else c.span = '';
  delete c.key;
});

/* ---------- 五、寫檔 ---------- */
const dest = path.join(ROOT, 'deep', `${bookId}.json`);
/* 重組只該換掉 chapters。人寫的東西（主人的心得、Claude 導讀）一律沿用舊檔——
   曾經因為只保 note 沒保 claude，重跑一次就把前兩本的導讀洗掉。 */
const prev = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : {};
const out = {
  bookId, title: book.t, titleShort: book.t,
  author: book.a || '', pub: book.pub || '',
  source: '依我拍攝的頁面順序重述',
  chapters,
  note: prev.note || ''
};
if (prev.claude) out.claude = prev.claude;
fs.writeFileSync(dest, JSON.stringify(out, null, 1), 'utf8');

if (!book.deep) {
  book.deep = 1;
  fs.writeFileSync(BOOKS, JSON.stringify(db, null, 1), 'utf8');
  console.log(`books.json：${bookId} 已標記 deep`);
}

const nText = chapters.reduce((n, c) => n + c.groups.reduce((m, g) => m + g.blocks.filter(b => b.t === 'text').reduce((k, b) => k + b.v.length, 0), 0), 0);
const qAll = chapters.flatMap(c => c.groups.flatMap(g => g.blocks.filter(b => b.t === 'quote')));
const nQc = qAll.reduce((n, b) => n + b.v.length, 0);
const noPage = chapters.flatMap(c => c.groups).filter(g => !g.pages).length;

/* 腳本自動處理掉的事情一律列出來。默默修好比修不好更危險——
   下一個人（包括未來的我）會以為資料本來就長這樣。 */
if (corrected.length) { console.log('抽驗後的更正：'); [...new Set(corrected)].forEach(m => console.log('  ' + m)); }
if (pageFixes.length) { console.log('頁碼覆蓋（人工核對）：'); pageFixes.forEach(m => console.log('  ' + m)); }
if (headFixes.length) { console.log('小標覆蓋（人工核對）：'); headFixes.forEach(m => console.log('  ' + m)); }
if (dedupes.length)   { console.log('重拍去重：');   dedupes.forEach(m => console.log('  ' + m)); }
if (merges.length)    { console.log('章名合併：');   merges.forEach(m => console.log('  ' + m)); }
if (partFills.length) { console.log('補上層級：'); partFills.forEach(m => console.log('  ' + m)); }

console.log(`\n《${book.t}》組裝完成`);
console.log(`${chapters.length} 章、${chapters.reduce((n, c) => n + c.groups.length, 0)} 段落群（跳過非內文 ${skipped} 張）`);
console.log(`重述 ${nText.toLocaleString()} 字，引文 ${qAll.length} 句（${nQc.toLocaleString()} 字，佔 ${(nQc / (nQc + nText) * 100).toFixed(1)}%）`);
console.log(`書中強調 ${qAll.filter(b => b.kind).length} 句；讀不到頁碼、不標頁碼的段落群 ${noPage} 個\n`);
chapters.forEach(c => console.log(
  `  ${(c.label || '—').padStart(2)} ${(c.title || '(無章名)').padEnd(18)} ${(c.span || '—').padEnd(12)} ${c.groups.length} 群`));
const bad = chapters.filter(c => !c.title);
if (bad.length) console.log(`\n⚠️ ${bad.length} 章沒讀到章名`);
