'use strict';
// 局域网 Web 服务器: 手机浏览器访问书库
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

let server = null;
let SESSION_TOKEN = null;

function getConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(require('electron').app.getPath('userData'), 'config.json'), 'utf8')); }
  catch (e) { return {}; }
}
function saveConfig(c) {
  try { fs.writeFileSync(path.join(require('electron').app.getPath('userData'), 'config.json'), JSON.stringify(c, null, 2), 'utf8'); } catch (e) {}
}
function getIP() {
  const os = require('node:os');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}
function dbg(msg) {
  try { fs.appendFileSync(path.join(require('electron').app.getPath('userData'), 'web-dbg.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {}
}

function checkAuth(req, u) {
  // 优先 URL token(手机浏览器兼容性最好)
  if (u && u.searchParams.get('t') === SESSION_TOKEN) return true;
  const cookie = req.headers.cookie || '';
  return cookie.includes('ml_session=' + SESSION_TOKEN);
}
function sendHTML(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}
function sendJSON(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}
function sendError(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}
function streamFile(res, filePath, mime) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return sendError(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': mime || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'public, max-age=86400' });
    fs.createReadStream(filePath).pipe(res);
  });
}
function loadComics(libRoot) {
  try {
    var html = fs.readFileSync(path.join(libRoot, '书库.html'), 'utf8');
    var m = html.match(/var COMICS\s*=\s*(\[[\s\S]*?\]);/);
    if (m) return JSON.parse(m[1]);
  } catch (e) {}
  return [];
}
function loadLibraryJson(libRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(libRoot, 'library.json'), 'utf8')); }
  catch (e) { return { comics: {} }; }
}

function mobileHTML(authed) {
  return `<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>书库</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow-x:hidden}
body{background:#0d0e10;color:#ddd;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:8px;padding-bottom:env(safe-area-inset-bottom)}
.topbar{position:sticky;top:0;background:#0d0e10;padding:8px 0;z-index:10;border-bottom:1px solid #1a1b1f}
.topbar input{flex:1;padding:10px 14px;border:1px solid #24262c;border-radius:10px;background:#191a1f;color:#fff;font-size:15px;outline:none}
#filterBtn{padding:8px 12px;background:#191a1f;border:1px solid #24262c;border-radius:10px;color:#aaa;font-size:13px;cursor:pointer;white-space:nowrap}
#filterBtn.on{background:#2f6df6;color:#fff;border-color:#2f6df6}
.catbar{display:flex;gap:6px;padding:8px 0;overflow-x:auto;-webkit-overflow-scrolling:touch}
.chip{padding:5px 14px;border-radius:14px;background:#191a1f;border:1px solid #24262c;font-size:13px;cursor:pointer;white-space:nowrap;color:#aaa}
.chip.on{background:#2f6df6;color:#fff;border-color:#2f6df6}
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px;padding-bottom:20px}
#grid .ghead{grid-column:1/-1;font-size:12px;color:#888;padding:8px 0 4px;font-weight:bold}
.card{cursor:pointer;border-radius:8px;overflow:hidden;background:#191a1f;border:1px solid #24262c;display:flex;flex-direction:column;transition:transform .1s}
.card:active{transform:scale(.97)}
.card .cov{position:relative;width:100%;aspect-ratio:3/4;background:#222;overflow:hidden}
.card .cov img{width:100%;height:100%;object-fit:cover;display:block}
.card .bar{height:3px;background:#2a2d34;width:100%}
.card .bar i{display:block;height:100%;background:#2f6df6}
.card .meta{padding:5px 8px 7px;min-width:0}
.card .t{font-size:12px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3}
.card .p{font-size:10px;color:#666;margin-top:2px}
#reader{display:none;position:fixed;inset:0;background:#000;z-index:100;overflow:hidden;touch-action:none}
#rimg{width:100%;height:100%;object-fit:contain;user-select:none;pointer-events:none}
#close{position:fixed;top:10px;right:10px;z-index:101;background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:38px;height:38px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
#pgnum{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.6);color:#fff;padding:4px 14px;border-radius:12px;font-size:12px;z-index:101;display:none}
#modebar{position:fixed;top:10px;left:10px;z-index:101;display:flex;gap:4px}
#modebar button{background:rgba(0,0,0,.5);color:#aaa;border:1px solid #444;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
#modebar button.on{background:#2f6df6;color:#fff;border-color:#2f6df6}
#chDrawer{display:none;position:fixed;top:0;left:0;bottom:0;width:260px;background:#1a1b1f;z-index:102;overflow-y:auto;padding-top:50px}
#chList div{padding:10px 16px;color:#ccc;font-size:13px;cursor:pointer;border-bottom:1px solid #24262c}
#chList div.cur{background:#2f6df6;color:#fff}
#chList div:hover{background:#2a2b30}
#ctxMenu{display:none;position:fixed;background:#1a1b1f;border:1px solid #333;border-radius:10px;z-index:200;min-width:160px;overflow:hidden}
#ctxMenu div{padding:12px 16px;color:#ddd;font-size:14px;cursor:pointer;border-bottom:1px solid #24262c}
#ctxMenu div:last-child{border-bottom:none}
#ctxMenu div:active{background:#2a2b30}
#ctxMenu .danger{color:#f55}
#thumbStrip{display:none;position:fixed;bottom:0;left:0;right:0;height:100px;background:rgba(20,20,20,.95);z-index:102;overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding:8px;justify-content:flex-start;touch-action:pan-x}
#thumbStrip img{height:80px;width:auto;display:inline-block;margin-right:4px;border-radius:4px;cursor:pointer;opacity:.6}
#thumbStrip img.cur{opacity:1;border:2px solid #2f6df6}
#longview{display:none;width:100%;overflow-y:auto;height:100%;-webkit-overflow-scrolling:touch}
#longview img{width:100%;display:block}
#dimg{display:none;width:100%;height:100%;object-fit:contain}
#login{max-width:300px;margin:80px auto;text-align:center}
#login h2{margin-bottom:20px;color:#ccc}
#login input{width:100%;padding:12px;border:1px solid #24262c;border-radius:10px;background:#191a1f;color:#fff;font-size:16px;text-align:center;margin:8px 0}
#login button{width:100%;padding:12px;background:#2f6df6;border:none;border-radius:10px;color:#fff;font-size:16px;cursor:pointer;margin-top:8px}
#empty{text-align:center;color:#555;padding:40px 0;font-size:14px}
</style></head><body>
<div id="login" style="display:${authed ? 'none' : 'block'}">
<h2>书库</h2>
<input type="password" id="pw" placeholder="密码">
<button onclick="login()">进入</button>
</div>
<div id="app" style="display:${authed ? 'block' : 'none'}">
<div class="topbar">
<input id="search" placeholder="搜索书名..." oninput="render()">
<button id="filterBtn" onclick="toggleFilter()">筛选</button>
</div>
<div id="filterPanel" style="display:none;padding:8px;background:#191a1f;border-bottom:1px solid #24262c">
<div style="font-size:12px;color:#888;margin:4px 0">分组</div>
<select id="fGroup" style="width:100%;padding:6px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;font-size:13px"></select>
<div style="font-size:12px;color:#888;margin:8px 0 4px">平台</div>
<div id="fPlat" style="display:flex;gap:4px;flex-wrap:wrap"></div>
<div style="font-size:12px;color:#888;margin:8px 0 4px">作者/标签过滤</div>
<input id="fText" placeholder="输入作者或标签..." style="width:100%;padding:6px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;font-size:13px">
<div style="font-size:12px;color:#888;margin:8px 0 4px">评分</div>
<div id="fRate" style="display:flex;gap:4px"></div>
<div style="font-size:12px;color:#888;margin:8px 0 4px">排序</div>
<select id="fSort" style="width:100%;padding:6px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;font-size:13px"></select>
</div>
<div class="catbar" id="cats"></div>
<div id="grid"></div>
<div id="empty" style="display:none">没有找到书</div>
</div>
<div id="reader">
<button id="close" onclick="closeReader()">✕</button>
<div id="modebar">
<button onclick="setMode('single')" id="m-single">单页</button>
<button onclick="setMode('long')" id="m-long">长条</button>
<button onclick="showChapters()">目录</button>
<button onclick="toggleThumbs()" id="m-thumbs">缩略图</button>
</div>
<div id="chDrawer">
<div id="chList"></div>
<button onclick="hideChapters()" style="margin:8px;padding:8px;background:#2f6df6;color:#fff;border:none;border-radius:8px;width:calc(100% - 16px)">关闭</button>
</div>
<div id="thumbStrip"></div>
<div id="pgnum"></div>
<img id="rimg">
<div id="longview"></div>
</div>
<div id="ctxMenu"></div>
<script>
let BOOKS=[],CAT="all",Q="";
let fPlat="all",fSort="recent",fGroup="none",fRate="all",fText="";
let cur=null,chIdx=0,pi=0,totalPages=0,chList=[];
let rmode="single"; // single/long
let scale=1,tx=0,ty=0,tSx=0,tSy=0,tSt=0,lastDist=0;
let thumbsOpen=false;
function ls(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function lss(k,v){try{localStorage.setItem(k,v);}catch(e){}}
function applyT(){document.getElementById("rimg").style.transform="translate("+tx+"px,"+ty+"px) scale("+scale+")";}
function resetZ(){scale=1;tx=0;ty=0;applyT();}
async function api(u){const r=await fetch(u);if(r.status===401){location.href="/";throw new Error("auth");}return r.json();}
async function login(){const pw=document.getElementById("pw").value;const r=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pw})});if(r.ok){location.href="/";}else{alert("密码错");}}
async function init(){
  // 恢复上次的筛选和搜索
  var savedCat=ls("m_cat"); if(savedCat)CAT=savedCat;
  var savedQ=ls("m_q"); if(savedQ)document.getElementById("search").value=savedQ;
  Q=savedQ||"";
  try{const d=await api("/api/library");BOOKS=d.books;
    var savedPlat=ls("m_plat");if(savedPlat)fPlat=savedPlat;
    var savedSort=ls("m_sort");if(savedSort)fSort=savedSort;
    var savedGroup=ls("m_group");if(savedGroup)fGroup=savedGroup;
    renderCats();buildFilter();render();
    // 恢复滚动位置
    setTimeout(function(){var sy=parseInt(ls("m_scroll")||"0");if(sy)window.scrollTo(0,sy);},100);
  }catch(e){}
}
function renderCats(){const c=document.getElementById("cats");let h='<span class="chip'+(CAT==="all"?" on":"")+'" onclick="setCat(\\'all\\')">全部</span>';const cats=[...new Set(BOOKS.flatMap(b=>b.categories||[]))];cats.sort();cats.forEach(function(x){h+='<span class="chip'+(CAT===x?" on":"")+'" onclick="setCat(\\''+x+'\\')">'+x+'</span>';});c.innerHTML=h;}
function setCat(x){CAT=x;lss("m_cat",x);render();}
function toggleFilter(){
  var p=document.getElementById("filterPanel");
  var b=document.getElementById("filterBtn");
  var show=p.style.display==="none";
  p.style.display=show?"block":"none";
  b.className=show?"on":"";
}
function buildFilter(){
  // 分组下拉
  var fg=document.getElementById("fGroup");
  fg.innerHTML='<option value="none">不分组</option><option value="work">按作品</option><option value="char">按角色</option><option value="author">按作者</option><option value="plat">按平台</option>';
  fg.value=fGroup;
  fg.onchange=function(){fGroup=this.value;lss("m_group",fGroup);render();};
  // 平台
  var plats=[...new Set(BOOKS.map(b=>b.source).filter(Boolean))].sort();
  var fp=document.getElementById("fPlat");
  fp.innerHTML='<span class="chip'+(fPlat==="all"?" on":"")+'" onclick="setPlat(\\'all\\')">全部</span>';
  plats.forEach(function(p){fp.innerHTML+='<span class="chip'+(fPlat===p?" on":"")+'" onclick="setPlat(\\''+p+'\\')">'+p+'</span>';});
  // 评分
  var fr=document.getElementById("fRate");
  fr.innerHTML='<span class="chip'+(fRate==="all"?" on":"")+'" onclick="setRate(\\'all\\')">全部</span><span class="chip'+(fRate==="fav"?" on":"")+'" onclick="setRate(\\'fav\\')">收藏</span><span class="chip'+(fRate==="rated"?" on":"")+'" onclick="setRate(\\'rated\\')">有评分</span>';
  // 文本过滤
  var ft=document.getElementById("fText");
  ft.value=fText;
  ft.oninput=function(){fText=this.value.trim().toLowerCase();render();};
  // 排序下拉
  var fs=document.getElementById("fSort");
  fs.innerHTML='<option value="recent">最近阅读</option><option value="name">书名</option><option value="pages">页数多</option><option value="time_desc">时间新→旧</option><option value="time_asc">时间旧→新</option>';
  fs.value=fSort;
  fs.onchange=function(){fSort=this.value;lss("m_sort",fSort);render();};
}
function setPlat(p){fPlat=p;lss("m_plat",p);buildFilter();render();}
function setRate(r){fRate=r;buildFilter();render();}
function render(){
  lss("m_q",document.getElementById("search").value);
  const g=document.getElementById("grid");
  let list=BOOKS;
  if(CAT!=="all")list=list.filter(b=>(b.categories||[]).includes(CAT));
  if(fPlat!=="all")list=list.filter(b=>b.source===fPlat);
  if(fRate==="fav")list=list.filter(b=>ls("m_fav_"+b.dir)==="1");
  if(fRate==="rated")list=list.filter(b=>b.rating>0);
  if(fText){list=list.filter(b=>(b.author||"").toLowerCase().includes(fText)||(b.tags||[]).some(t=>t.toLowerCase().includes(fText)));}
  Q=document.getElementById("search").value;
  if(Q)list=list.filter(b=>b.name.toLowerCase().includes(Q.toLowerCase()));
  // 排序
  if(fSort==="name")list=list.slice().sort((a,b)=>a.name.localeCompare(b.name,"zh"));
  else if(fSort==="pages")list=list.slice().sort((a,b)=>b.pages-a.pages);
  else if(fSort==="time_desc")list=list.slice().sort((a,b)=>(b.mtime||0)-(a.mtime||0));
  else if(fSort==="time_asc")list=list.slice().sort((a,b)=>(a.mtime||0)-(b.mtime||0));
  else list=list.slice().sort(function(a,b){
    var pa=ls("m_prog_"+a.dir),pb=ls("m_prog_"+b.dir);
    var ta=pa?JSON.parse(pa).ts||0:0,tb=pb?JSON.parse(pb).ts||0:0;
    return tb-ta;
  });
  // 分组
  var html="";
  if(fGroup!=="none"){
    var groups={};
    list.forEach(function(b){
      var key=fGroup==="author"?(b.author||"未标注"):fGroup==="work"?(b.work||"未标注"):fGroup==="plat"?(b.source||"未标注"):"";
      (groups[key]=groups[key]||[]).push(b);
    });
    var keys=Object.keys(groups).sort(function(a,b){return groups[b].length-groups[a].length;});
    keys.forEach(function(k){
      html+='<div class="ghead">'+k+' ('+groups[k].length+')</div>';
      groups[k].forEach(function(b){html+=cardHtml(b);});
    });
  }else{
    list.forEach(function(b){html+=cardHtml(b);});
  }
  g.innerHTML=html;
  document.getElementById("empty").style.display=list.length?"none":"block";
}
function cardHtml(b){
  var fav=ls("m_fav_"+b.dir)==="1";
  var prog=ls("m_prog_"+b.dir);
  var pct="";
  if(prog){var p=JSON.parse(prog);pct=Math.round(p.pi/(p.total||1)*100);}
  var bar=pct?'<div class="bar"><i style="width:'+pct+'%"></i></div>':'';
  var ptext=pct?pct+"%":"刚开";
  var star=fav?'<span style="color:#f55">★</span>':'';
  return '<div class="card" data-dir="'+b.dir+'" onclick="openBook(\\''+b.dir+'\\')" ontouchstart="cardTouchStart(event,\\''+b.dir+'\\')" ontouchend="cardTouchEnd()" ontouchmove="cardTouchMove()"><div class="cov"><img loading="lazy" src="/img?dir='+encodeURIComponent(b.dir)+'&cover=1"></div>'+bar+'<div class="meta"><div class="t">'+b.name+'</div><div class="p">'+b.pages+'页 · '+ptext+' '+star+'</div></div></div>';
}
var lpTimer=null,lpDir=null,lpMoved=false;
function cardTouchStart(e,dir){lpDir=dir;lpMoved=false;lpTimer=setTimeout(function(){lpShowMenu(dir,e.touches[0].clientX,e.touches[0].clientY);},600);}
function cardTouchMove(){lpMoved=true;clearTimeout(lpTimer);}
function cardTouchEnd(){clearTimeout(lpTimer);}
function lpShowMenu(dir,x,y){
  if(lpMoved)return;
  var fav=ls("m_fav_"+dir)==="1";
  var m=document.getElementById("ctxMenu");
  m.innerHTML='<div onclick="lpFav(\\''+dir+'\\')">'+(fav?"★ 取消收藏":"☆ 加入收藏")+'</div><div class="danger" onclick="lpDelete(\\''+dir+'\\')">🗑 删除本书</div>';
  m.style.display="block";
  m.style.left=Math.min(x,innerWidth-180)+"px";
  m.style.top=Math.min(y,innerHeight-120)+"px";
}
document.addEventListener("click",function(){document.getElementById("ctxMenu").style.display="none";});
function lpFav(dir){
  var cur=ls("m_fav_"+dir)==="1";
  if(cur)localStorage.removeItem("m_fav_"+dir);else lss("m_fav_"+dir,"1");
  document.getElementById("ctxMenu").style.display="none";
  render();
}
async function lpDelete(dir){
  if(!confirm("确定删除这本书？磁盘文件也会删除，不可恢复。"))return;
  document.getElementById("ctxMenu").style.display="none";
  try{
    await fetch("/api/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({dir:dir})});
    // 从列表移除
    BOOKS=BOOKS.filter(b=>b.dir!==dir);
    render();
    alert("已删除");
  }catch(e){alert("删除失败: "+e.message);}
}
async function openBook(dir){
  cur=dir;
  const d=await api("/api/book?dir="+encodeURIComponent(dir));
  chList=d.chapters;chIdx=0;pi=0;totalPages=chList[0].pages;
  var saved=ls("m_prog_"+dir);
  if(saved){var p=JSON.parse(saved);if(p.ci!==undefined&&p.ci<chList.length){chIdx=p.ci;totalPages=chList[chIdx].pages;pi=Math.min(p.pi||0,totalPages-1);}}
  rmode=ls("m_rmode")||"single";
  document.getElementById("reader").style.display="block";
  document.getElementById("pgnum").style.display="block";
  document.getElementById("close").style.display="flex";
  document.getElementById("modebar").style.display="flex";
  setMode(rmode,true);
  document.body.style.overflow="hidden";
}
function setMode(m,skipSave){
  rmode=m;if(!skipSave)lss("m_rmode",m);
  document.getElementById("m-single").className=m==="single"?"on":"";
  document.getElementById("m-long").className=m==="long"?"on":"";
  var rimg=document.getElementById("rimg"),lv=document.getElementById("longview");
  if(m==="long"){
    rimg.style.display="none";lv.style.display="block";
    loadLongView();
  }else{
    rimg.style.display="block";lv.style.display="none";
    loadPage();
  }
}
function loadLongView(){
  if(!cur)return;
  var lv=document.getElementById("longview");
  var html="";
  for(var ci=0;ci<chList.length;ci++){
    for(var p=0;p<chList[ci].pages;p++){
      html+='<img src="/page?dir='+encodeURIComponent(cur)+'&ch='+ci+'&p='+p+'" loading="lazy">';
    }
  }
  lv.innerHTML=html;
  document.getElementById("pgnum").style.display="none";
}
function saveProg(){if(!cur)return;lss("m_prog_"+cur,JSON.stringify({ci:chIdx,pi:pi,total:totalPages,ts:Date.now()}));}
function loadPage(){
  if(!cur)return;
  document.getElementById("rimg").src="/page?dir="+encodeURIComponent(cur)+"&ch="+chIdx+"&p="+pi;
  document.getElementById("pgnum").textContent=(pi+1)+" / "+totalPages;
  resetZ();saveProg();
  // 更新缩略图高亮
  if(thumbsOpen){var imgs=document.getElementById("thumbStrip").querySelectorAll("img");if(imgs[pi]){imgs.forEach(function(im,i){im.className=i===pi?"cur":"";});imgs[pi].scrollIntoView({inline:"center"});}}
}
function closeReader(){saveProg();document.getElementById("reader").style.display="none";document.getElementById("pgnum").style.display="none";document.getElementById("modebar").style.display="none";document.getElementById("chDrawer").style.display="none";document.getElementById("thumbStrip").style.display="none";thumbsOpen=false;document.body.style.overflow="";cur=null;}
function showChapters(){
  var cl=document.getElementById("chList");
  cl.innerHTML=chList.map(function(c,i){
    var label=c.label||("第"+(i+1)+"话");
    return '<div class="'+(i===chIdx?"cur":"")+'" onclick="jumpToCh('+i+')">'+label+' ('+c.pages+'页)</div>';
  }).join("");
  document.getElementById("chDrawer").style.display="block";
}
function hideChapters(){document.getElementById("chDrawer").style.display="none";}
function jumpToCh(i){chIdx=i;pi=0;totalPages=chList[i].pages;hideChapters();loadPage();if(thumbsOpen)buildThumbs();}
function toggleThumbs(){
  thumbsOpen=!thumbsOpen;
  var ts=document.getElementById("thumbStrip");
  ts.style.display=thumbsOpen?"flex":"none";
  if(thumbsOpen)buildThumbs();
}
function buildThumbs(){
  if(!cur)return;
  var ts=document.getElementById("thumbStrip");
  var html="";
  for(var i=0;i<totalPages;i++){
    var cls=i===pi?"cur":"";
    html+='<img class="'+cls+'" loading="lazy" src="/page?dir='+encodeURIComponent(cur)+'&ch='+chIdx+'&p='+i+'" onclick="jumpToPage('+i+')">';
  }
  ts.innerHTML=html;
  // 滚动到当前页
  var curImg=ts.querySelector(".cur");
  if(curImg)curImg.scrollIntoView({inline:"center"});
}
function jumpToPage(p){pi=p;loadPage();if(thumbsOpen){var imgs=document.getElementById("thumbStrip").querySelectorAll("img");imgs.forEach(function(im,i){im.className=i===pi?"cur":"";});var curImg=document.getElementById("thumbStrip").querySelector(".cur");if(curImg)curImg.scrollIntoView({inline:"center"});}}
function nextPage(){
  if(rmode==="long")return;
  if(pi<totalPages-1){pi++;loadPage();}
  else if(chIdx<chList.length-1){chIdx++;pi=0;totalPages=chList[chIdx].pages;loadPage();if(thumbsOpen)buildThumbs();}
  else{closeReader();}
}
function prevPage(){
  if(rmode==="long")return;
  if(pi>0){pi--;loadPage();}
  else if(chIdx>0){chIdx--;totalPages=chList[chIdx].pages;pi=totalPages-1;loadPage();if(thumbsOpen)buildThumbs();}
}
var rdr=document.getElementById("reader");
rdr.addEventListener("touchstart",function(e){if(e.touches.length===2){var dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;lastDist=Math.sqrt(dx*dx+dy*dy);}else if(e.touches.length===1){tSx=e.touches[0].clientX;tSy=e.touches[0].clientY;tSt=Date.now();}});
rdr.addEventListener("touchmove",function(e){
  if(rmode==="long")return;
  // 缩略图条和目录抽屉内不拦截, 允许滚动
  if(e.target.closest && (e.target.closest("#thumbStrip")||e.target.closest("#chDrawer")))return;
  e.preventDefault();
  if(e.touches.length===2){var dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;var dist=Math.sqrt(dx*dx+dy*dy);if(lastDist>0){scale=Math.max(1,Math.min(5,scale*dist/lastDist));applyT();}lastDist=dist;}else if(e.touches.length===1&&scale>1){tx+=e.touches[0].clientX-tSx;ty+=e.touches[0].clientY-tSy;tSx=e.touches[0].clientX;tSy=e.touches[0].clientY;applyT();}},{passive:false});
rdr.addEventListener("touchend",function(e){if(e.touches.length===1){lastDist=0;}if(scale>1||rmode==="long")return;if(e.target.closest&&(e.target.closest("button")||e.target.closest("#thumbStrip")||e.target.closest("#chDrawer")))return;var dx=e.changedTouches[0].clientX-tSx,dy=e.changedTouches[0].clientY-tSy,dt=Date.now()-tSt;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)&&dt<500){if(dx<0)nextPage();else prevPage();}else if(Math.abs(dx)<10&&Math.abs(dy)<10&&dt<300){var x=e.changedTouches[0].clientX;if(x<innerWidth*0.25)prevPage();else if(x>innerWidth*0.75)nextPage();}});
// 保存滚动位置
window.addEventListener("scroll",function(){lss("m_scroll",String(window.scrollY));},{passive:true});
${authed ? 'init();' : ''}
</script></body></html>`;
}

function startServer(libRoot) {
  if (server) return;
  const cfg = getConfig();
  const password = cfg.webPassword || '';
  const PORT = 9527;
  SESSION_TOKEN = Math.random().toString(36).slice(2);

  server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost:' + PORT);
      const pathname = u.pathname;

      if (pathname === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', function (c) { body += c; });
        req.on('end', function () {
          try {
            var d = JSON.parse(body);
            dbg('login attempt: pw=' + d.pw + ' expected=' + password + ' match=' + (d.pw === password));
            if (d.pw === password) {
              res.writeHead(200, { 'Set-Cookie': 'ml_session=' + SESSION_TOKEN + '; Path=/; HttpOnly', 'Content-Type': 'application/json' });
              res.end('{"ok":true}');
            } else { res.writeHead(403); res.end('{"ok":false}'); }
          } catch (e) { res.writeHead(400); res.end(); }
        });
        return;
      }

      var authed = checkAuth(req, u);
      dbg(req.method + ' ' + pathname + ' authed=' + authed + ' cookie=' + (req.headers.cookie || 'none'));
      if (!authed) {
        if (pathname === '/' || pathname === '/login') return sendHTML(res, mobileHTML(false));
        return sendError(res, 401, 'Unauthorized');
      }
      if (pathname === '/' || pathname === '/login') return sendHTML(res, mobileHTML(true));

      if (pathname === '/api/library') {
        var comics = loadComics(libRoot);
        var lib = loadLibraryJson(libRoot);
        var books = comics.map(function (m) {
          var meta = (lib.comics || {})[m.dir] || {};
          var mtime = 0;
          try { mtime = fs.statSync(path.join(libRoot, m.dir)).mtimeMs; } catch (e) {}
          return { dir: m.dir, name: m.name, chapters: m.chapters || [], categories: meta.categories || [], tags: meta.tags || [],
            author: m.author || '', source: (m.source && m.source.site) || '', work: m.work || '',
            favorite: meta.favorite || false, rating: meta.rating || 0,
            pages: (m.chapters||[]).reduce((s,c)=>s+(c.files?c.files.length:(c.n||0)),0),
            mtime: mtime };
        });
        return sendJSON(res, { books: books });
      }
      if (pathname === '/api/book') {
        var dir2 = u.searchParams.get('dir');
        if (!dir2) return sendError(res, 400, 'No dir');
        var comics2 = loadComics(libRoot);
        var b = null;
        for (var i = 0; i < comics2.length; i++) if (comics2[i].dir === dir2) { b = comics2[i]; break; }
        if (!b) return sendError(res, 404, 'Book not found');
        return sendJSON(res, { name: b.name, chapters: (b.chapters || []).map(function (c) {
          var files = c.files || [];
          var pages = files.length || c.n || 0;
          return { path: c.path, pages: pages, files: files, pad: c.pad || 3, ext: c.ext || '.jpg' };
        }) });
      }
      if (pathname === '/img') {
        var dir3 = u.searchParams.get('dir');
        var comics3 = loadComics(libRoot);
        var b3 = null;
        for (var j = 0; j < comics3.length; j++) if (comics3[j].dir === dir3) { b3 = comics3[j]; break; }
        if (!b3 || !b3.chapters || !b3.chapters.length) return sendError(res, 404, 'No cover');
        var ch0 = b3.chapters[0];
        var files0 = ch0.files || [];
        var coverPath;
        if (files0.length > 0) {
          coverPath = path.join(libRoot, dir3, files0[0]);
        } else {
          coverPath = path.join(libRoot, dir3, ch0.path, String(1).padStart(ch0.pad || 3, '0') + (ch0.ext || '.jpg'));
        }
        return streamFile(res, coverPath, 'image/jpeg');
      }
      if (pathname === '/page') {
        var dir4 = u.searchParams.get('dir');
        var ch = parseInt(u.searchParams.get('ch') || '0');
        var p = parseInt(u.searchParams.get('p') || '0');
        var comics4 = loadComics(libRoot);
        var b4 = null;
        for (var k = 0; k < comics4.length; k++) if (comics4[k].dir === dir4) { b4 = comics4[k]; break; }
        if (!b4 || !b4.chapters || !b4.chapters[ch]) return sendError(res, 404, 'Chapter not found');
        var chInfo = b4.chapters[ch];
        var files = chInfo.files || [];
        var fp;
        if (files.length > 0) {
          if (p < 0 || p >= files.length) return sendError(res, 404, 'Page out of range');
          fp = files[p];
        } else {
          var n = chInfo.n || 0;
          if (p < 0 || p >= n) return sendError(res, 404, 'Page out of range');
          fp = chInfo.path + '/' + String(p + 1).padStart(chInfo.pad || 3, '0') + (chInfo.ext || '.jpg');
        }
        var ext = path.extname(fp).toLowerCase();
        var mime = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
        return streamFile(res, path.join(libRoot, dir4, fp), mime);
      }
      // 删除本书(含磁盘文件)
      if (pathname === '/api/delete' && req.method === 'POST') {
        let body2 = '';
        req.on('data', function (c) { body2 += c; });
        req.on('end', function () {
          try {
            var delDir = JSON.parse(body2).dir;
            if (!delDir || typeof delDir !== 'string' || !delDir.startsWith('漫画/')) return sendError(res, 400, 'Invalid dir');
            const full = path.join(libRoot, delDir);
            if (!full.startsWith(libRoot + path.sep)) return sendError(res, 403, '拒绝');
            // 删磁盘文件
            try { fs.rmSync(full, { recursive: true, force: true }); } catch (e) {}
            // 删 library.json 条目
            try {
              var lib = loadLibraryJson(libRoot);
              if (lib.comics && lib.comics[delDir]) { delete lib.comics[delDir]; fs.writeFileSync(path.join(libRoot, 'library.json'), JSON.stringify(lib, null, 2), 'utf8'); }
            } catch (e) {}
            // 触发书库重建
            setTimeout(function () {
              try {
                const { spawn } = require('node:child_process');
                const script = path.join(libRoot, '_scripts', 'build-library.mjs');
                spawn(process.execPath, [script, '--lib', libRoot, '--offline'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
              } catch (e) {}
            }, 500);
            sendJSON(res, { ok: true });
          } catch (e) { sendError(res, 500, String(e.message || e)); }
        });
        return;
      }
      sendError(res, 404, 'Not found: ' + pathname);
    } catch (e) { sendError(res, 500, String(e.message || e)); }
  });

  server.listen(PORT, '0.0.0.0', function () {
    dbg('server started on port ' + PORT + ' token=' + SESSION_TOKEN + ' pw=' + password);
  });
}

function stopServer() {
  if (server) { try { server.close(); } catch (e) {} server = null; }
}

module.exports = { startServer: startServer, stopServer: stopServer, getIP: getIP };
