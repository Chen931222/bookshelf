// 產 deep/_meta.json：深讀索引頁要的那幾個數字（涵蓋頁、字數、分鐘、章數）。
// 以前索引頁是把七篇全文（約 1.9MB）全抓下來現算，只為了顯示這幾個數字；
// 改成這裡先算好，索引頁只抓一個 1KB 的檔。改了任何 deep/*.json 之後重跑：
//   node tools/deep-meta.mjs
// tools/check.mjs 會比對這個檔跟 deep/*.json 是否一致，過期就不給上線。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = f => path.join(ROOT, f);

// 跟 index.html 的 deepStats 算法一致（只留索引頁用得到的欄位）
export function statsOf(d) {
  const chs = d.chapters || [];
  const groups = chs.reduce((a, c) => a.concat(c.groups || []), []);
  const chars = groups.reduce((n, g) => n + (g.blocks || []).reduce((m, b) => m + (b.v || '').length, 0), 0);
  const nums = groups.reduce((a, g) => a.concat((String(g.pages || '').match(/\d+/g) || []).map(Number)), []);
  return {
    span: nums.length ? 'p.' + Math.min.apply(null, nums) + '–' + Math.max.apply(null, nums) : '',
    words: (Math.round(chars / 100) * 100).toLocaleString('en-US'),
    mins: Math.max(1, Math.round(chars / 400)),
    chs: chs.length,
  };
}

export function buildMeta() {
  const db = JSON.parse(fs.readFileSync(R('books.json'), 'utf8'));
  const out = {};
  for (const b of db.books.filter(x => x.deep)) {
    const f = R(`deep/${b.id}.json`);
    if (!fs.existsSync(f)) continue;
    out[b.id] = statsOf(JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const meta = buildMeta();
  // 跟 books.json 一樣用 CRLF，免得整檔 diff 爆掉
  fs.writeFileSync(R('deep/_meta.json'), JSON.stringify(meta, null, 1).replace(/\n/g, '\r\n') + '\r\n');
  console.log(`deep/_meta.json：${Object.keys(meta).length} 篇`);
}
