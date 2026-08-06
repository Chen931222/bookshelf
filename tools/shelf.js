/* 書櫃本機工具 —— 只在自己電腦上跑，不會部署。
 *
 *   node tools/shelf.js
 *   然後開 http://localhost:5174
 *
 * 為什麼要一個伺服器，而不是雙擊開 HTML：
 *   1. 瀏覽器不讓 file:// 用相機（不是 secure context），localhost 才行。
 *   2. 網頁不能寫檔案。有伺服器才能把筆記直接存回 books.json，
 *      省掉「複製 JSON 再貼進檔案」那一步 —— 那一步會讓習慣撐不過三天。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'books.json');
const PORT = 5174;

const readDB = () => JSON.parse(fs.readFileSync(DB, 'utf8'));

// 先寫暫存再改名，中途斷電不會留下半個壞掉的 books.json
function writeDB(data) {
  const tmp = DB + '.tmp';
  fs.copyFileSync(DB, DB + '.bak');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, DB);
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

// 收完整個 body 再一次解碼。逐塊 `s += chunk` 會在多位元組字元剛好跨塊時
// 把中文切成兩半，解出 U+FFFD —— 中文筆記一長就會踩到。
const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let len = 0;
  req.on('data', c => {
    chunks.push(c); len += c.length;
    if (len > 2e6) req.destroy(new Error('body too large'));
  });
  req.on('error', reject);
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
    catch (e) { reject(e); }
  });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') return send(res, 200, PAGE, 'text/html');

  // 封面圖給編輯介面看
  if (url.pathname.startsWith('/covers/')) {
    const f = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!f.startsWith(path.join(ROOT, 'covers'))) return send(res, 403, { error: 'no' });
    return fs.readFile(f, (e, d) => e ? send(res, 404, { error: 'no cover' })
      : (res.writeHead(200, { 'Content-Type': 'image/webp' }), res.end(d)));
  }

  if (url.pathname === '/api/books' && req.method === 'GET') {
    return send(res, 200, readDB());
  }

  // 存一本書的筆記
  if (url.pathname === '/api/note' && req.method === 'POST') {
    try {
      const { id, note, quotes, tags, skip } = await readBody(req);
      const db = readDB();
      const b = db.books.find(x => x.id === id);
      if (!b) return send(res, 404, { error: '找不到這本書' });
      if (skip) { b.noteSkip = 1; }
      else {
        b.note = (note || '').trim();
        b.quotes = (quotes || []).map(q => q.trim()).filter(Boolean);
        b.tags = (tags || []).map(t => t.trim()).filter(Boolean);
        delete b.noteSkip;
      }
      writeDB(db);
      const done = db.books.filter(x => x.note && x.note.trim()).length;
      return send(res, 200, { ok: true, done, total: db.books.length });
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  }

  // 新增一本書
  if (url.pathname === '/api/add' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!b.t) return send(res, 400, { error: '至少要有書名' });
      const db = readDB();
      const n = db.books.filter(x => x.c === b.c).length + 1;
      const book = {
        id: `${b.c}-new-${String(n).padStart(3, '0')}`,
        t: b.t, a: b.a || '', c: b.c || 'misc',
        ly: Number(b.ly) || 1, o: b.o || 'spine',
        note: '', quotes: [], tags: []
      };
      if (b.isbn) book.isbn = b.isbn;
      if (b.pub) book.pub = b.pub;
      if (b.yr) book.yr = Number(b.yr);
      if (b.syn) book.syn = b.syn;
      if (b.coverUrl) book.coverUrl = b.coverUrl;   // 先記網址，之後再下載成本地檔
      db.books.push(book);
      writeDB(db);
      return send(res, 200, { ok: true, id: book.id, total: db.books.length });
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  }

  send(res, 404, { error: 'not found' });
}).listen(PORT, () => {
  const db = readDB();
  const done = db.books.filter(b => b.note && b.note.trim()).length;
  console.log(`\n  書櫃工具  →  http://localhost:5174`);
  console.log(`  目前 ${done} / ${db.books.length} 本有筆記\n`);
});

const PAGE = `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>書櫃工具</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--ink:#141310;--paper:#F2ECE0;--dim:rgba(242,236,224,.45);--faint:rgba(242,236,224,.16);--gold:#C08A4E;
 --serif:"Noto Serif TC",serif;--mono:ui-monospace,Menlo,Consolas,monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--ink);color:var(--paper);font-family:var(--serif);min-height:100vh}
.wrap{max-width:min(820px,92vw);margin:0 auto;padding:clamp(28px,6vh,64px) 0 90px}
.top{display:flex;justify-content:space-between;align-items:baseline;
 border-bottom:1px solid var(--faint);padding-bottom:14px;margin-bottom:clamp(24px,5vh,44px)}
.top b{font-size:19px;font-weight:600;letter-spacing:.12em}
.tabs{display:flex;gap:16px}
.tabs button{background:none;border:none;color:var(--dim);font-family:var(--mono);font-size:12px;
 letter-spacing:.16em;cursor:pointer;padding:4px 0;border-bottom:1px solid transparent}
.tabs button.on{color:var(--paper);border-bottom-color:var(--gold)}
.bar{height:2px;background:var(--faint);margin-bottom:8px}
.bar i{display:block;height:100%;background:var(--gold);width:0;transition:width .4s}
.prog{font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--dim);margin-bottom:clamp(22px,4vh,38px)}
.book{display:flex;gap:clamp(16px,3vw,30px);align-items:flex-start;margin-bottom:26px}
.book img{width:clamp(88px,13vw,130px);aspect-ratio:2/3;object-fit:cover;flex:none;background:#222}
.book .noimg{width:clamp(88px,13vw,130px);aspect-ratio:2/3;flex:none;border:1px solid var(--faint);
 display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:10px;color:var(--dim)}
.book h2{font-size:clamp(21px,2.6vw,30px);font-weight:600;line-height:1.25}
.book .who{color:var(--dim);font-size:14px;margin-top:8px}
.book .out{margin-top:12px;font-size:13.5px;line-height:1.8;color:rgba(242,236,224,.62);
 max-height:6.2em;overflow:hidden}
label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--gold);
 margin:22px 0 8px}
textarea,input{width:100%;background:transparent;color:var(--paper);border:1px solid var(--faint);
 border-radius:2px;padding:.8em .9em;font-family:var(--serif);font-size:15px;line-height:1.7;resize:vertical}
textarea:focus,input:focus{outline:none;border-color:rgba(242,236,224,.45)}
.hint{font-family:var(--mono);font-size:10.5px;color:var(--dim);margin-top:6px;letter-spacing:.06em}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}
button.go{background:transparent;color:var(--paper);border:1px solid rgba(242,236,224,.4);border-radius:2px;
 padding:.75em 1.7em;font-family:var(--mono);font-size:12px;letter-spacing:.16em;cursor:pointer}
button.go:hover{border-color:var(--paper)}
button.go.primary{border-color:var(--gold);color:var(--gold)}
button.go:disabled{opacity:.4;cursor:default}
.msg{font-family:var(--mono);font-size:11.5px;color:var(--gold);margin-top:14px;min-height:1.2em;letter-spacing:.08em}
.done{text-align:center;padding:70px 0;line-height:2;color:var(--dim)}
.done b{display:block;font-size:24px;color:var(--paper);font-weight:600;margin-bottom:12px}
video{width:100%;max-width:420px;border:1px solid var(--faint);border-radius:2px;background:#000}
.warn{border:1px solid var(--faint);border-left:2px solid var(--gold);padding:12px 14px;margin:16px 0;
 font-size:13px;line-height:1.8;color:rgba(242,236,224,.7)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:620px){.grid{grid-template-columns:1fr}.book{flex-direction:column}}
</style></head><body><div class="wrap">
<div class="top"><b>書櫃工具</b><div class="tabs">
<button id="tabNote" class="on">寫筆記</button><button id="tabAdd">加書</button></div></div>

<section id="paneNote">
  <div class="bar"><i id="barFill"></i></div>
  <p class="prog" id="prog">載入中…</p>
  <div id="noteBody"></div>
</section>

<section id="paneAdd" hidden>
  <div class="warn" id="scanWarn"></div>
  <video id="cam" playsinline hidden></video>
  <div class="row">
    <button class="go" id="scanBtn">開相機掃 ISBN</button>
    <button class="go" id="stopBtn" hidden>停止</button>
  </div>
  <label>ISBN（掃到會自動填，也可以手打）</label>
  <input id="fIsbn" placeholder="9789573317249">
  <div class="row" style="margin-top:12px"><button class="go" id="lookupBtn">查書目</button></div>
  <div class="grid">
    <div><label>書名</label><input id="fT"></div>
    <div><label>作者</label><input id="fA"></div>
    <div><label>出版社</label><input id="fPub"></div>
    <div><label>年份</label><input id="fYr"></div>
    <div><label>分類</label><select id="fC" style="width:100%;background:var(--ink);color:var(--paper);
      border:1px solid var(--faint);border-radius:2px;padding:.8em .9em;font-family:var(--serif);font-size:15px"></select></div>
    <div><label>第幾層</label><input id="fLy" value="1"></div>
  </div>
  <div class="row"><button class="go primary" id="addBtn">加進書櫃</button></div>
  <p class="msg" id="addMsg"></p>
</section>
</div>
<script type="module">
const $=id=>document.getElementById(id);
let DB=null, cur=null, pool=[];

async function load(){
  DB=await fetch('/api/books').then(r=>r.json());
  $('fC').innerHTML=DB.categories.map(c=>'<option value="'+c.key+'">'+c.name+'</option>').join('');
  next();
}
/* 抽一本還沒筆記、也沒被跳過的書。一次只給一本 —— 給一整份清單只會讓人不想開始。 */
function next(){
  pool=DB.books.filter(b=>!(b.note&&b.note.trim())&&!b.noteSkip&&!b.t.startsWith('待指認'));
  const done=DB.books.filter(b=>b.note&&b.note.trim()).length;
  $('prog').textContent=done+' / '+DB.books.length+' 本有筆記　·　還沒寫的還有 '+pool.length+' 本';
  $('barFill').style.width=(done/DB.books.length*100)+'%';
  if(!pool.length){
    $('noteBody').innerHTML='<div class="done"><b>都寫完了</b>每本書都有筆記了。<br>問書櫃現在有東西可以串了。</div>';
    return;
  }
  cur=pool[Math.floor(Math.random()*pool.length)];
  const out=(cur.res&&cur.res.outline)||cur.syn||'';
  $('noteBody').innerHTML=
    '<div class="book">'+
      (cur.cover?'<img src="/'+cur.cover+'" alt="">':'<div class="noimg">沒有封面</div>')+
      '<div><h2>'+esc(cur.t)+'</h2>'+
      '<p class="who">'+esc(cur.a||'作者不詳')+(cur.yr?'　·　'+cur.yr:'')+'</p>'+
      (out?'<p class="out">'+esc(out)+'</p>':'')+
    '</div></div>'+
    '<label>讀後心得</label>'+
    '<textarea id="nNote" rows="4" placeholder="三句話就好。它讓你想到什麼？改變了什麼？"></textarea>'+
    '<p class="hint">會顯示在公開網站上，而且進了 git 歷史就撤不回來 —— '+
      '用「印在名片背面也無所謂」的標準寫。真正私人的感想寫進 private/（不進版控）。</p>'+
    '<label>劃線句子</label>'+
    '<textarea id="nQ" rows="3" placeholder="一行一句，直接打或抄書上劃線的"></textarea>'+
    '<label>概念標籤</label>'+
    '<input id="nTags" placeholder="自由、決策、九〇年代　—— 用頓號或逗號分開">'+
    '<div class="row">'+
      '<button class="go primary" id="save">存起來，下一本</button>'+
      '<button class="go" id="skip">這本跳過</button>'+
    '</div><p class="msg" id="noteMsg"></p>';
  $('nNote').focus();
  $('save').onclick=save;
  $('skip').onclick=()=>post({id:cur.id,skip:1});
  $('noteBody').addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();save();}
  });
}
function save(){
  post({ id:cur.id, note:$('nNote').value,
    quotes:$('nQ').value.split('\\n'),
    tags:$('nTags').value.split(/[、,，]/) });
}
async function post(payload){
  const btns=document.querySelectorAll('#noteBody button'); btns.forEach(b=>b.disabled=true);
  try{
    const r=await fetch('/api/note',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)}).then(r=>r.json());
    if(r.error) throw new Error(r.error);
    DB=await fetch('/api/books').then(r=>r.json());
    next();
  }catch(e){ $('noteMsg').textContent='存檔失敗：'+e.message; btns.forEach(b=>b.disabled=false); }
}
const esc=s=>String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

/* ---- 加書 ---- */
$('tabNote').onclick=()=>{$('tabNote').classList.add('on');$('tabAdd').classList.remove('on');
  $('paneNote').hidden=false;$('paneAdd').hidden=true;};
$('tabAdd').onclick=()=>{$('tabAdd').classList.add('on');$('tabNote').classList.remove('on');
  $('paneAdd').hidden=false;$('paneNote').hidden=true;};

const native='BarcodeDetector' in window;
$('scanWarn').innerHTML = native
  ? '這台裝置有原生條碼支援，直接開相機就能掃。'
  : '這台裝置<b>沒有</b>原生條碼支援（iPhone／Safari 全都沒有，而且不會報錯只會沒反應）。'
    +'按下去會改載 WASM 版本，第一次要多等一兩秒。';

let stream=null, det=null, loopOn=false;
async function getDetector(){
  if(det) return det;
  if(native){ det=new BarcodeDetector({formats:['ean_13']}); return det; }
  const m=await import('https://cdn.jsdelivr.net/npm/barcode-detector@3/+esm');
  det=new m.BarcodeDetector({formats:['ean_13']}); return det;
}
$('scanBtn').onclick=async()=>{
  try{
    const d=await getDetector();
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    $('cam').srcObject=stream; $('cam').hidden=false; await $('cam').play();
    $('scanBtn').hidden=true; $('stopBtn').hidden=false; loopOn=true;
    (async function tick(){
      while(loopOn){
        try{
          const codes=await d.detect($('cam'));
          if(codes.length){ $('fIsbn').value=codes[0].rawValue; stop(); lookup(); return; }
        }catch(_){}
        await new Promise(r=>setTimeout(r,180));
      }
    })();
  }catch(e){ $('addMsg').textContent='相機打不開：'+e.message+'（確認是用 http://localhost 開，不是雙擊檔案）'; }
};
function stop(){ loopOn=false; if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  $('cam').hidden=true; $('scanBtn').hidden=false; $('stopBtn').hidden=true; }
$('stopBtn').onclick=stop;

$('lookupBtn').onclick=lookup;
async function lookup(){
  const isbn=$('fIsbn').value.replace(/[^0-9Xx]/g,'');
  if(!isbn) return;
  $('addMsg').textContent='查詢中…';
  try{
    const j=await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:'+isbn).then(r=>r.json());
    const v=j.items&&j.items[0]&&j.items[0].volumeInfo;
    if(!v){ $('addMsg').textContent='查不到。2024 年前的舊書常常查不到，手動填就好 —— 這是正常流程，不是壞掉。'; return; }
    $('fT').value=v.title||''; $('fA').value=(v.authors||[]).join('、');
    $('fPub').value=v.publisher||''; $('fYr').value=(v.publishedDate||'').slice(0,4);
    $('addMsg').textContent='查到了，確認一下再送出。';
  }catch(e){ $('addMsg').textContent='查詢失敗：'+e.message; }
}
$('addBtn').onclick=async()=>{
  const body={ isbn:$('fIsbn').value.trim(), t:$('fT').value.trim(), a:$('fA').value.trim(),
    pub:$('fPub').value.trim(), yr:$('fYr').value.trim(), c:$('fC').value, ly:$('fLy').value };
  if(!body.t){ $('addMsg').textContent='至少要有書名。'; return; }
  const r=await fetch('/api/add',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)}).then(r=>r.json());
  if(r.error){ $('addMsg').textContent=r.error; return; }
  $('addMsg').textContent='已加入（'+r.id+'）。書櫃現在 '+r.total+' 本。';
  ['fIsbn','fT','fA','fPub','fYr'].forEach(id=>$(id).value='');
  DB=await fetch('/api/books').then(r=>r.json());
};
load();
</script></body></html>`;
