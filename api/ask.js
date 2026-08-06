// 「問書櫃」— 用 Claude 讀我所有書的筆記來回答問題。
//
// API key 只存在於 Vercel 的環境變數 ANTHROPIC_API_KEY，永遠不會送到瀏覽器。
// 前端只送出問題字串；書單摘要在這裡由 books.json 組出來。

const Anthropic = require('@anthropic-ai/sdk');
const books = require('../books.json');

const MODEL = 'claude-opus-5';
const MAX_QUESTION = 500;      // 問題長度上限，擋掉把整篇文章貼進來當 prompt 用
const MAX_OUTLINE = 140;       // 每本書的大綱截斷長度，控制 prompt 體積

const CAT_NAME = Object.fromEntries(
  (books.categories || []).map(c => [c.key, c.name])
);

/**
 * 把書單壓成給模型讀的摘要。
 * 順序刻意把「我的筆記」排在前面 —— 那是這個書櫃真正獨有的內容，
 * 網路上抓來的大綱與評價只是背景。
 */
function buildDigest() {
  const lines = [];
  for (const b of books.books) {
    if (!b.t || b.t.startsWith('待指認')) continue;

    const head = [
      b.t,
      b.a ? `／${b.a}` : '',
      `（${CAT_NAME[b.c] || b.c}`,
      b.yr ? `，${b.yr}` : '',
      b.pub ? `，${b.pub}` : '',
      '）'
    ].join('');

    const parts = [head];
    if (b.tags && b.tags.length) parts.push(`  標籤：${b.tags.join('、')}`);
    if (b.note && b.note.trim()) parts.push(`  我的心得：${b.note.trim()}`);
    if (b.quotes && b.quotes.length) {
      parts.push(...b.quotes.map(q => `  我劃線：「${q}」`));
    }
    if (b.r) parts.push('  狀態：正在讀');

    const r = b.res || {};
    const outline = (r.outline || b.syn || '').slice(0, MAX_OUTLINE);
    if (outline) parts.push(`  大綱：${outline}`);
    if (r.points && r.points.length) {
      parts.push(`  觀點：${r.points.slice(0, 4).join('；')}`);
    }
    lines.push(parts.join('\n'));
  }
  return lines.join('\n\n');
}

const DIGEST = buildDigest();

const SYSTEM = `你是一座私人書櫃的閱讀夥伴。下面是這個書櫃的完整藏書資料，你只能根據這些內容回答。

回答規則：
- 用繁體中文，語氣像一個讀過這些書的朋友在聊天，不要像客服或報告。
- 一定要指名具體的書。說「《快思慢想》和《底層邏輯》都在談⋯⋯」比說「有幾本書談到⋯⋯」有用得多。
- 標記「我的心得」和「我劃線」的內容是書櫃主人自己寫的，份量比大綱和評價重，優先拿來推論他的想法與關注。
- 書櫃裡找不到答案就直說找不到，不要用常識硬湊，也不要提到不在這份清單上的書。
- 問題如果跟這個書櫃無關，簡短說明你只能聊這座書櫃裡的書。
- 長度控制在四段以內，不要開條列清單堆砌，用完整句子把書串起來。

=== 藏書資料 ===
${DIGEST}`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: '尚未設定 ANTHROPIC_API_KEY' });
    return;
  }

  let question = (req.body && req.body.question) || '';
  if (typeof question !== 'string' || !question.trim()) {
    res.status(400).json({ error: '請輸入問題' });
    return;
  }
  question = question.trim().slice(0, MAX_QUESTION);

  const client = new Anthropic();   // 自動讀 ANTHROPIC_API_KEY

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // 串流：整份書單摘要很長，非串流容易撞到請求逾時，而且邊打字邊出字體感好很多
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,           // 思考與回答共用這個上限，留寬一點
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{ role: 'user', content: question }]
    });

    for await (const chunk of stream.textStream) {
      res.write(chunk);
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      res.write('\n\n（這個問題我沒辦法回答。）');
    }
    res.end();
  } catch (err) {
    console.error('ask failed:', err);
    if (res.headersSent) {
      res.write('\n\n（回答中斷了，請再試一次。）');
      res.end();
    } else {
      const status = err && err.status === 429 ? 429 : 500;
      res.status(status).json({
        error: status === 429 ? '太多人在問了，等一下再試。' : '出了點問題，請再試一次。'
      });
    }
  }
};
