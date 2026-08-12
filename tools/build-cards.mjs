/* 把萃取出來的情境卡組成 cards.json。
 *
 * 這支腳本的核心職責不是排版，是把關：
 * 「可以這樣說」的每一句都必須在深讀筆記裡逐字找得到，找不到就丟掉。
 * 使用者會拿這些句子去對真人講，編出來的句子不能混進去。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const T = path.join(ROOT, 'pipeline');
const OUT = path.join(ROOT, 'cards.json');

const TOPICS = ['破冰','閒聊','初次見面','稱讚','傾聽','提問','拒絕','衝突','道歉','冷場','尷尬',
  '自我介紹','說服','談判','職場','上司','同事','家人','伴侶','朋友','金錢','工作意義',
  '人生方向','習慣與改變','情緒','界線'];
// agent 偶爾會寫出清單外的相近詞
const TOPIC_FIX = { '工作':'工作意義', '溝通':'說服', '人際':'閒聊', '自我':'人生方向' };

// 每加一本書就把它的萃取輸出接在後面
const TASKS = ['wsn22flpd', 'wb23c6it5', 'wc9136ixg', 'wk04cg0su'];
const raw = { chapters: TASKS.flatMap(t =>
  JSON.parse(fs.readFileSync(path.join(T, 'runs', `${t}.json`), 'utf8')).result.chapters) };
const meta = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(T, 'chaps', 'index.json'), 'utf8')).map(x => [x.name, x]));

// 標點與空白在重述與卡片之間會有出入，比對前先抹掉
const norm = s => String(s).replace(/[「」『』〔〕（）()，、。？！：；\s\u3000·—－\-…"']/g, '');
const body = {};
for (const id of ['money-051','money-066','lit-046','money-054','money-048','lit-049']) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'deep', `${id}.json`), 'utf8'));
  body[id] = norm(d.chapters.flatMap(c => c.groups).map(g => g.blocks.map(b => b.v).join('')).join(''));
}

/* 標題覆寫。卡片的 one 是最大字、也是唯一會被掃讀到的一行；
   證據薄弱又會被拿去貼在真人身上的說法，不能只把但書塞在下面的小字裡。
   內容不刪（why 仍完整交代書上怎麼說），但標題要自己承載懷疑。 */
const ONE_FIX = {
  '愛穿紅的佔有慾強，黑的表裡不一，白的其實自卑':
    '「顏色看個性」這套很不可靠，別拿來判斷人',
  '煙往前吐偏強勢，往上吐偏自信，往下旁邊吐較顧慮人':
    '吐煙方向可以留意，但推不出對方的性格',
};

const cards = [], dropped = [], badTopic = new Set(), oneFixed = [];
let n = 0;
for (const ch of raw.chapters) {
  const m = meta[ch.file];
  for (const k of (ch.data && ch.data.cards) || []) {
    const say = (k.say || []).filter(s => {
      const hit = (body[m.bookId] || '').includes(norm(s));
      if (!hit) dropped.push({ ch: m.ch, s });
      return hit;
    });

    let topic = (k.topic || '').trim();
    if (!TOPICS.includes(topic)) {
      if (TOPIC_FIX[topic]) topic = TOPIC_FIX[topic];
      else { badTopic.add(topic); topic = '閒聊'; }
    }

    const sit = (k.sit || []).map(s => s.trim()).filter(Boolean);
    if (!sit.length || !(k.one || '').trim()) continue;   // 沒有情境或沒有結論的卡沒有用

    cards.push({
      id: 'c' + String(++n).padStart(3, '0'),
      sit, topic,
      one: (() => {
        const o = k.one.trim();
        if (ONE_FIX[o]) { oneFixed.push(`「${o}」→「${ONE_FIX[o]}」`); return ONE_FIX[o]; }
        return o;
      })(),
      say,
      why: (k.why || '').trim(),
      caution: (k.caution || '').trim(),
      src: { b: m.bookId, book: m.book, ch: m.ch, label: m.label || '', span: m.span || '' }
    });
  }
}

fs.writeFileSync(OUT, JSON.stringify({
  topics: TOPICS.filter(t => cards.some(c => c.topic === t)),
  cards
}, null, 1), 'utf8');

console.log(`卡片 ${cards.length} 張`);
console.log(`可直接說的句子 ${cards.reduce((a, c) => a + c.say.length, 0)} 句（全部通過逐字比對）`);
if (oneFixed.length) { console.log('標題覆寫（證據薄弱又會被拿去判斷真人）：'); oneFixed.forEach(m => console.log('  ' + m)); }
console.log(`丟掉找不到出處的句子 ${dropped.length} 句：`);
dropped.forEach(d => console.log(`  [${d.ch}]「${d.s.slice(0, 40)}」`));
if (badTopic.size) console.log(`清單外的主題（已歸到「閒聊」）：${[...badTopic].join('、')}`);
