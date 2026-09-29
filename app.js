'use strict';
// ─────────────────────────────────────────
// IndexedDB
// ─────────────────────────────────────────
const DB_NAME = 'MusicScoreDB2', DB_VER = 2;
let db = null;

function initDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('scores')) {
        const s = d.createObjectStore('scores', { keyPath: 'id' });
        s.createIndex('categoryId', 'categoryId', { unique: false });
      }
      if (!d.objectStoreNames.contains('categories'))
        d.createObjectStore('categories', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings'))
        d.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = e => { db = e.target.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}
const dbAll  = store => new Promise((res,rej)=>{ const r=db.transaction(store,'readonly').objectStore(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
const dbPut  = (store,item) => new Promise((res,rej)=>{ const r=db.transaction(store,'readwrite').objectStore(store).put(item); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
const dbDel  = (store,id)   => new Promise((res,rej)=>{ const r=db.transaction(store,'readwrite').objectStore(store).delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
const dbGet  = (store,key)  => new Promise((res,rej)=>{ const r=db.transaction(store,'readonly').objectStore(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });

// ─────────────────────────────────────────
// State
// ─────────────────────────────────────────
const S = {
  scores: [], categories: [],
  filter: 'all', search: '', sort: 'date-desc',
  viewMode: 'grid', cardSize: 'medium',
  theme: 'midnight',
  bgDataURL: null, bgBlur: 8, bgOverlay: 60,
  viewerList: [], viewerIdx: -1,
  selColor: '#a78bfa', selEmoji: '🎵', selDiff: 0,
  editCatId: null, editScoreId: null,
  pendingFiles: [],
};

const DIFF_LABELS = ['','★ 入门','★★ 初级','★★★ 中级','★★★★ 高级','★★★★★ 专业'];
const TAG_PRESETS = ['钢琴','古典','流行','练习曲','奏鸣曲','协奏曲','爵士','民谣','指弹','弦乐'];

// ─────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────
const $ = id => document.getElementById(id);
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function fmtDate(ts){ const d=new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtSize(b){ if(b<1024)return b+'B'; if(b<1048576)return(b/1024).toFixed(1)+'KB'; return(b/1048576).toFixed(2)+'MB'; }
function fileToDataURL(file){ return new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file); }); }

function toast(msg, type=''){
  const el=document.createElement('div');
  el.className='toast'+(type?' '+type:'');
  el.textContent=msg;
  $('toastContainer').appendChild(el);
  setTimeout(()=>{ el.style.animation='toastOut .3s ease forwards'; setTimeout(()=>el.remove(),300); },2500);
}

// ─────────────────────────────────────────
// Theme
// ─────────────────────────────────────────
function applyTheme(theme){
  S.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  // update meta theme-color
  const colors = { midnight:'#0d0f1a', daylight:'#f8fafc', amethyst:'#130d1a', ocean:'#060f1a', warm:'#141008', emerald:'#071510' };
  const mc = document.querySelector('meta[name="theme-color"]');
  if(mc) mc.content = colors[theme]||'#0d0f1a';
  // update theme cards
  document.querySelectorAll('.theme-card').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.theme===theme);
  });
  saveSetting('theme', theme);
}

// ─────────────────────────────────────────
// Background
// ─────────────────────────────────────────
function applyBackground(){
  const layer = $('bgLayer');
  const overlay = $('bgOverlay');
  if(S.bgDataURL){
    layer.style.backgroundImage = `url("${S.bgDataURL}")`;
    layer.style.filter = `blur(${S.bgBlur}px)`;
    layer.style.transform = 'scale(1.05)';
    layer.style.opacity = '1';
    overlay.style.opacity = String(S.bgOverlay/100);
  } else {
    layer.style.backgroundImage = '';
    layer.style.opacity = '0';
    overlay.style.opacity = '1';
  }
}

function updateBgSliders(){
  $('bgBlur').value = S.bgBlur;
  $('bgOverlayOpacity').value = S.bgOverlay;
  $('blurVal').textContent = S.bgBlur+'px';
  $('overlayVal').textContent = S.bgOverlay+'%';
}

async function setBgImage(dataURL){
  S.bgDataURL = dataURL;
  applyBackground();
  // show preview
  $('bgPreviewImg').src = dataURL;
  $('bgPreviewWrap').style.display = 'block';
  $('bgUploadHint').style.display = 'none';
  await saveSetting('bgDataURL', dataURL);
  await saveSetting('bgBlur', S.bgBlur);
  await saveSetting('bgOverlay', S.bgOverlay);
}

async function removeBgImage(){
  S.bgDataURL = null;
  applyBackground();
  $('bgPreviewWrap').style.display = 'none';
  $('bgUploadHint').style.display = '';
  $('bgPreviewImg').src = '';
  await saveSetting('bgDataURL', null);
}

// ─────────────────────────────────────────
// Settings persistence
// ─────────────────────────────────────────
async function saveSetting(key, value){
  await dbPut('settings', { key, value });
}
async function loadSettings(){
  const rows = await dbAll('settings');
  rows.forEach(r=>{
    if(r.key==='theme' && r.value) S.theme=r.value;
    if(r.key==='bgDataURL') S.bgDataURL=r.value;
    if(r.key==='bgBlur' && r.value!=null) S.bgBlur=r.value;
    if(r.key==='bgOverlay' && r.value!=null) S.bgOverlay=r.value;
    if(r.key==='cardSize' && r.value) S.cardSize=r.value;
    if(r.key==='viewMode' && r.value) S.viewMode=r.value;
    if(r.key==='sort' && r.value) S.sort=r.value;
  });
}

// ─────────────────────────────────────────
// Sidebar toggle
// ─────────────────────────────────────────
function toggleSidebar(){
  const sb = $('sidebar');
  const main = $('mainContent');
  const isMobile = window.innerWidth<=768;
  if(isMobile){
    sb.classList.toggle('mobile-open');
    $('sidebarOverlay').classList.toggle('active', sb.classList.contains('mobile-open'));
  } else {
    sb.classList.toggle('collapsed');
    main.classList.toggle('expanded', sb.classList.contains('collapsed'));
  }
}
function closeMobileSidebar(){
  $('sidebar').classList.remove('mobile-open');
  $('sidebarOverlay').classList.remove('active');
}

// ─────────────────────────────────────────
// Filter / Sort
// ─────────────────────────────────────────
function setFilter(f){
  S.filter = f;
  ['navAll','navFavorites','navRecent'].forEach(id=>{
    const el=$(id); if(el) el.classList.remove('active');
  });
  document.querySelectorAll('.cat-nav-btn').forEach(b=>b.classList.remove('active'));
  if(f==='all') $('navAll').classList.add('active');
  else if(f==='favorites') $('navFavorites').classList.add('active');
  else if(f==='recent') $('navRecent').classList.add('active');
  else {
    const btn = document.querySelector(`.cat-nav-btn[data-filter="${f}"]`);
    if(btn) btn.classList.add('active');
  }
  renderPageTitle();
  renderScores();
  if(window.innerWidth<=768) closeMobileSidebar();
}

function getFiltered(){
  let list = [...S.scores];
  if(S.filter==='favorites') list=list.filter(s=>s.favorite);
  else if(S.filter==='recent'){
    const cutoff = Date.now()-7*24*3600*1000;
    list=list.filter(s=>s.createdAt>=cutoff);
  } else if(S.filter!=='all') list=list.filter(s=>s.categoryId===S.filter);
  if(S.search){
    const q=S.search.toLowerCase();
    list=list.filter(s=>
      s.title.toLowerCase().includes(q)||
      (s.composer||'').toLowerCase().includes(q)||
      (s.tags||[]).some(t=>t.toLowerCase().includes(q))||
      (s.notes||'').toLowerCase().includes(q)
    );
  }
  list.sort((a,b)=>{
    if(S.sort==='date-desc') return b.createdAt-a.createdAt;
    if(S.sort==='date-asc')  return a.createdAt-b.createdAt;
    if(S.sort==='name-asc')  return a.title.localeCompare(b.title,'zh');
    if(S.sort==='name-desc') return b.title.localeCompare(a.title,'zh');
    return 0;
  });
  return list;
}

// ─────────────────────────────────────────
// Render
// ─────────────────────────────────────────
function renderAll(){
  updateBadges();
  renderCategories();
  updateCatSelects();
  renderPageTitle();
  renderScores();
  updateStorage();
}

function updateBadges(){
  $('badgeAll').textContent=S.scores.length;
  $('badgeFav').textContent=S.scores.filter(s=>s.favorite).length;
  const cutoff=Date.now()-7*24*3600*1000;
  $('badgeRecent').textContent=S.scores.filter(s=>s.createdAt>=cutoff).length;
}

function renderPageTitle(){
  const t=$('pageTitle'), sub=$('pageSubtitle');
  if(S.filter==='all'){ t.textContent='全部乐谱'; sub.textContent='所有曲谱'; }
  else if(S.filter==='favorites'){ t.textContent='收藏'; sub.textContent='我的收藏'; }
  else if(S.filter==='recent'){ t.textContent='最近上传'; sub.textContent='最近7天'; }
  else {
    const cat=S.categories.find(c=>c.id===S.filter);
    t.textContent=cat?`${cat.emoji||''} ${cat.name}`:'分类';
    sub.textContent=cat?`${S.scores.filter(s=>s.categoryId===cat.id).length} 首`:'';
  }
}

function renderCategories(){
  const list=$('categoryList'); list.innerHTML='';
  S.categories.forEach(cat=>{
    const count=S.scores.filter(s=>s.categoryId===cat.id).length;
    const wrap=document.createElement('div');
    wrap.className='cat-nav-item';
    const btn=document.createElement('button');
    btn.className='nav-item cat-nav-btn'+(S.filter===cat.id?' active':'');
    btn.dataset.filter=cat.id;
    btn.innerHTML=`
      <span style="font-size:15px;flex-shrink:0">${esc(cat.emoji||'🎵')}</span>
      <span class="nav-item-text">${esc(cat.name)}</span>
      <span class="badge">${count}</span>`;
    btn.addEventListener('click',()=>setFilter(cat.id));
    const acts=document.createElement('div');
    acts.className='cat-actions';
    acts.innerHTML=`
      <button class="cat-action" title="编辑" data-id="${cat.id}" data-act="edit">✏️</button>
      <button class="cat-action del" title="删除" data-id="${cat.id}" data-act="del">🗑</button>`;
    acts.querySelectorAll('button').forEach(b=>b.addEventListener('click',e=>{
      e.stopPropagation();
      b.dataset.act==='edit'?openCatModal(cat.id):deleteCategory(cat.id);
    }));
    wrap.appendChild(btn); wrap.appendChild(acts);
    list.appendChild(wrap);
  });
}

function updateCatSelects(){
  const opts='<option value="">— 不分类 —</option>'+
    S.categories.map(c=>`<option value="${c.id}">${esc((c.emoji||'')+' '+c.name)}</option>`).join('');
  $('uploadCategory').innerHTML=opts;
  $('editCategory').innerHTML=opts;
}

function renderScores(){
  const list=getFiltered();
  const grid=$('scoreGrid'), empty=$('emptyState');
  grid.innerHTML='';
  grid.className='score-grid'+(S.viewMode==='list'?' list-view':'');
  document.documentElement.setAttribute('data-card-size',S.cardSize);

  if(!list.length){
    grid.style.display='none'; empty.style.display='flex';
    if(S.search){
      $('emptyTitle').textContent='没有找到结果';
      $('emptyDesc').textContent=`没有与"${S.search}"匹配的乐谱`;
      $('emptyUploadBtn').style.display='none';
    } else if(S.filter==='favorites'){
      $('emptyTitle').textContent='还没有收藏';
      $('emptyDesc').textContent='浏览乐谱时点击心形图标收藏';
      $('emptyUploadBtn').style.display='none';
    } else {
      $('emptyTitle').textContent='还没有乐谱';
      $('emptyDesc').textContent='点击右上角「上传乐谱」开始添加！';
      $('emptyUploadBtn').style.display='flex';
    }
    return;
  }
  grid.style.display=''; empty.style.display='none';

  list.forEach((score,idx)=>{
    const cat=S.categories.find(c=>c.id===score.categoryId);
    const card=document.createElement('div');
    card.className='score-card'; card.dataset.id=score.id;
    const tagsHtml=(score.tags||[]).slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join('');
    const diffHtml=score.difficulty?`<div class="diff-badge">${DIFF_LABELS[score.difficulty]||''}</div>`:'';
    const isFav=score.favorite;

    if(S.viewMode==='grid'){
      card.innerHTML=`
        <div class="card-thumb">
          <img src="${score.dataURL}" alt="${esc(score.title)}" loading="lazy"/>
          <div class="card-overlay">
            <button class="card-quick-btn fav-btn${isFav?' is-fav':''}" data-id="${score.id}" title="收藏">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav?'#fbbf24':'none'}">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="${isFav?'#fbbf24':'currentColor'}" stroke-width="2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="card-body">
          ${cat?`<div class="card-cat" style="color:${cat.color}">${esc((cat.emoji||'')+'  '+cat.name)}</div>`:''}
          <div class="card-title">${esc(score.title)}</div>
          ${score.composer?`<div class="card-composer">🎼 ${esc(score.composer)}</div>`:''}
          <div class="card-tags">${tagsHtml}</div>
          ${diffHtml}
        </div>`;
    } else {
      card.innerHTML=`
        <div class="card-thumb"><img src="${score.dataURL}" alt="${esc(score.title)}" loading="lazy"/></div>
        <div class="card-body">
          <div class="card-main">
            ${cat?`<div class="card-cat" style="color:${cat.color}">${esc((cat.emoji||'')+' '+cat.name)}</div>`:''}
            <div class="card-title">${esc(score.title)}</div>
            ${score.composer?`<div class="card-composer">🎼 ${esc(score.composer)}</div>`:''}
            <div class="card-tags">${tagsHtml}${diffHtml}</div>
          </div>
          <span class="card-date">${fmtDate(score.createdAt)}</span>
        </div>`;
    }
    card.querySelector('.fav-btn')?.addEventListener('click',e=>{ e.stopPropagation(); toggleFav(score.id); });
    card.addEventListener('click',()=>openViewer(idx,list));
    grid.appendChild(card);
  });
}

function updateStorage(){
  const bytes=S.scores.reduce((a,s)=>a+(s.fileSize||0),0);
  $('storageSize').textContent=fmtSize(bytes);
  $('storageFill').style.width=Math.min((bytes/(100*1048576))*100,100)+'%';
}

// ─────────────────────────────────────────
// Upload
// ─────────────────────────────────────────
function openUploadModal(){
  S.pendingFiles=[];
  $('uploadPreviewList').innerHTML='';
  $('uploadForm').style.display='none';
  $('uploadModalFooter').style.display='none';
  $('uploadTitle').value=''; $('uploadComposer').value='';
  $('uploadTags').value=''; $('uploadNotes').value='';
  $('uploadCategory').value=''; S.selDiff=0;
  setDiffActive($('difficultyGroup'), 0);
  renderTagSuggestions();
  $('uploadModalBackdrop').classList.add('open');
}
function closeUploadModal(){ $('uploadModalBackdrop').classList.remove('open'); S.pendingFiles=[]; }

function renderTagSuggestions(){
  const existing=(S.scores.flatMap(s=>s.tags||[]));
  const all=[...new Set([...TAG_PRESETS,...existing])].slice(0,14);
  $('tagSuggestions').innerHTML=all.map(t=>`<button class="tag-suggest-chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  $('tagSuggestions').querySelectorAll('button').forEach(b=>{
    b.addEventListener('click',()=>{
      const cur=$('uploadTags').value;
      const tags=cur.split(',').map(x=>x.trim()).filter(Boolean);
      if(!tags.includes(b.dataset.tag)){ tags.push(b.dataset.tag); $('uploadTags').value=tags.join(', '); }
    });
  });
}

async function handleFiles(files){
  const imgs=Array.from(files).filter(f=>f.type.startsWith('image/'));
  if(!imgs.length){ toast('请选择图片文件','error'); return; }
  imgs.forEach(f=>{ if(!S.pendingFiles.find(x=>x.name===f.name&&x.size===f.size)) S.pendingFiles.push(f); });
  renderUploadPreviews();
  $('uploadForm').style.display='block';
  $('uploadModalFooter').style.display='flex';
  if(S.pendingFiles.length===1 && !$('uploadTitle').value)
    $('uploadTitle').value=S.pendingFiles[0].name.replace(/\.[^.]+$/,'');
}

function renderUploadPreviews(){
  const list=$('uploadPreviewList'); list.innerHTML='';
  S.pendingFiles.forEach(file=>{
    const url=URL.createObjectURL(file);
    const div=document.createElement('div'); div.className='upload-preview-item';
    div.innerHTML=`
      <div class="upload-preview-thumb"><img src="${url}" alt=""/></div>
      <div class="upload-preview-info">
        <div class="upload-preview-name">${esc(file.name)}</div>
        <div class="upload-preview-size">${fmtSize(file.size)}</div>
      </div>
      <button class="upload-preview-remove" title="移除">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button>`;
    div.querySelector('.upload-preview-remove').addEventListener('click',()=>{
      S.pendingFiles=S.pendingFiles.filter(f=>f!==file);
      renderUploadPreviews();
      if(!S.pendingFiles.length){ $('uploadForm').style.display='none'; $('uploadModalFooter').style.display='none'; }
    });
    list.appendChild(div);
  });
}

async function confirmUpload(){
  if(!S.pendingFiles.length){ toast('请先选择图片','error'); return; }
  const btn=$('uploadConfirm'); btn.disabled=true; btn.textContent='保存中…';
  try{
    const title=$('uploadTitle').value.trim()||'未命名乐谱';
    const categoryId=$('uploadCategory').value;
    const composer=$('uploadComposer').value.trim();
    const tags=$('uploadTags').value.split(',').map(t=>t.trim()).filter(Boolean);
    const notes=$('uploadNotes').value.trim();
    const difficulty=S.selDiff;
    for(let i=0;i<S.pendingFiles.length;i++){
      const file=S.pendingFiles[i];
      const dataURL=await fileToDataURL(file);
      const score={ id:uid(), title:S.pendingFiles.length>1?`${title} (${i+1})`:title, categoryId, composer, tags, notes, difficulty, dataURL, fileSize:file.size, fileType:file.type, favorite:false, createdAt:Date.now() };
      await dbPut('scores',score); S.scores.push(score);
    }
    closeUploadModal(); renderAll();
    toast(`已添加 ${S.pendingFiles.length} 张乐谱 🎵`,'success');
    S.pendingFiles=[];
  } catch(e){ console.error(e); toast('保存失败','error'); }
  finally{ btn.disabled=false; btn.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> 保存乐谱'; }
}

// ─────────────────────────────────────────
// Category modal
// ─────────────────────────────────────────
function openCatModal(editId=null){
  S.editCatId=editId;
  if(editId){
    const c=S.categories.find(x=>x.id===editId);
    $('catModalTitle').textContent='编辑分类';
    $('categoryName').value=c.name;
    S.selColor=c.color||'#a78bfa';
    S.selEmoji=c.emoji||'🎵';
    $('categoryConfirm').textContent='保存';
  } else {
    $('catModalTitle').textContent='新建分类';
    $('categoryName').value='';
    S.selColor='#a78bfa'; S.selEmoji='🎵';
    $('categoryConfirm').textContent='创建';
  }
  document.querySelectorAll('.color-dot').forEach(d=>d.classList.toggle('active',d.dataset.color===S.selColor));
  document.querySelectorAll('.emoji-btn').forEach(b=>b.classList.toggle('active',b.dataset.emoji===S.selEmoji));
  $('categoryModalBackdrop').classList.add('open');
  setTimeout(()=>$('categoryName').focus(),80);
}
function closeCatModal(){ $('categoryModalBackdrop').classList.remove('open'); }

async function saveCat(){
  const name=$('categoryName').value.trim();
  if(!name){ toast('请输入分类名称','error'); return; }
  if(S.editCatId){
    const c=S.categories.find(x=>x.id===S.editCatId);
    c.name=name; c.color=S.selColor; c.emoji=S.selEmoji;
    await dbPut('categories',c); toast('分类已更新','success');
  } else {
    const c={ id:uid(), name, color:S.selColor, emoji:S.selEmoji, createdAt:Date.now() };
    S.categories.push(c); await dbPut('categories',c); toast('分类已创建','success');
  }
  closeCatModal(); renderAll();
}

async function deleteCategory(id){
  if(!confirm('删除此分类？其中的乐谱将变为未分类。')) return;
  const affected=S.scores.filter(s=>s.categoryId===id);
  for(const s of affected){ s.categoryId=''; await dbPut('scores',s); }
  await dbDel('categories',id);
  S.categories=S.categories.filter(c=>c.id!==id);
  if(S.filter===id) setFilter('all'); else renderAll();
  toast('分类已删除');
}

// ─────────────────────────────────────────
// Viewer
// ─────────────────────────────────────────
function openViewer(idx, list){
  S.viewerList=list; S.viewerIdx=idx;
  renderViewer();
  $('viewerBackdrop').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeViewer(){ $('viewerBackdrop').classList.remove('open'); document.body.style.overflow=''; }

function renderViewer(){
  const score=S.viewerList[S.viewerIdx]; if(!score) return;
  const cat=S.categories.find(c=>c.id===score.categoryId);
  $('viewerImg').src=score.dataURL;
  $('viewerTitle').textContent=score.title;
  $('viewerCat').textContent=cat?`${cat.emoji||''} ${cat.name}`:'未分类';
  $('viewerComposer').textContent=score.composer?`🎼 ${score.composer}`:'';
  $('viewerDiff').textContent=score.difficulty?DIFF_LABELS[score.difficulty]||'':'';
  $('viewerCounter').textContent=`${S.viewerIdx+1} / ${S.viewerList.length}`;
  const isFav=score.favorite;
  const vFav=$('viewerFav');
  vFav.classList.toggle('is-fav',isFav);
  vFav.querySelector('svg path').setAttribute('fill',isFav?'#fbbf24':'none');
  vFav.querySelector('svg path').setAttribute('stroke',isFav?'#fbbf24':'currentColor');
  $('viewerTags').innerHTML=(score.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('');
  $('viewerPrev').style.display=S.viewerIdx>0?'':'none';
  $('viewerNext').style.display=S.viewerIdx<S.viewerList.length-1?'':'none';
}

function viewerNav(dir){
  const newIdx=S.viewerIdx+dir;
  if(newIdx<0||newIdx>=S.viewerList.length) return;
  S.viewerIdx=newIdx;
  const img=$('viewerImg');
  img.style.opacity='0'; img.style.transform=`translateX(${dir>0?'40px':'-40px'})`;
  setTimeout(()=>{ renderViewer(); img.style.transition='opacity .18s,transform .18s'; img.style.opacity='1'; img.style.transform='translateX(0)'; setTimeout(()=>img.style.transition='',200); },80);
}

async function toggleFav(id){
  const s=S.scores.find(x=>x.id===id); if(!s) return;
  s.favorite=!s.favorite; await dbPut('scores',s);
  renderAll();
  if($('viewerBackdrop').classList.contains('open')) renderViewer();
  toast(s.favorite?'已收藏 ❤️':'已取消收藏');
}

async function deleteScore(id){
  if(!confirm('确定删除这张乐谱？此操作不可恢复。')) return;
  await dbDel('scores',id); S.scores=S.scores.filter(s=>s.id!==id);
  closeViewer(); renderAll(); toast('已删除');
}

function downloadScore(score){
  const a=document.createElement('a');
  a.href=score.dataURL;
  a.download=score.title+'.'+(score.fileType||'image/jpeg').split('/')[1];
  a.click();
}

// ─────────────────────────────────────────
// Edit modal
// ─────────────────────────────────────────
function openEditModal(id){
  const s=S.scores.find(x=>x.id===id); if(!s) return;
  S.editScoreId=id;
  $('editTitle').value=s.title;
  $('editComposer').value=s.composer||'';
  $('editCategory').value=s.categoryId||'';
  $('editTags').value=(s.tags||[]).join(', ');
  $('editNotes').value=s.notes||'';
  S.selDiff=s.difficulty||0;
  setDiffActive($('editDifficultyGroup'), S.selDiff);
  $('editModalBackdrop').classList.add('open');
  setTimeout(()=>$('editTitle').focus(),80);
}
function closeEditModal(){ $('editModalBackdrop').classList.remove('open'); }

async function saveEdit(){
  const s=S.scores.find(x=>x.id===S.editScoreId); if(!s) return;
  s.title=$('editTitle').value.trim()||s.title;
  s.composer=$('editComposer').value.trim();
  s.categoryId=$('editCategory').value;
  s.tags=$('editTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  s.notes=$('editNotes').value.trim();
  s.difficulty=S.selDiff;
  await dbPut('scores',s);
  closeEditModal(); renderAll();
  if($('viewerBackdrop').classList.contains('open')) renderViewer();
  toast('已保存','success');
}

// ─────────────────────────────────────────
// Difficulty helper
// ─────────────────────────────────────────
function setDiffActive(group, level){
  group.querySelectorAll('.diff-btn').forEach(b=>{
    b.classList.toggle('active', parseInt(b.dataset.level)===level);
  });
}
function bindDiffGroup(groupId, uploadKey){
  const g=$(groupId);
  g.querySelectorAll('.diff-btn').forEach(b=>{
    b.addEventListener('click',()=>{ S.selDiff=parseInt(b.dataset.level); setDiffActive(g,S.selDiff); });
  });
}

// ─────────────────────────────────────────
// Settings panel
// ─────────────────────────────────────────
function openSettings(){
  $('settingsPanel').classList.add('open');
  $('settingsBackdrop').classList.add('open');
  // sync card size buttons
  document.querySelectorAll('.card-size-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.size===S.cardSize);
  });
  // sync bg preview
  if(S.bgDataURL){
    $('bgPreviewImg').src=S.bgDataURL;
    $('bgPreviewWrap').style.display='block';
    $('bgUploadHint').style.display='none';
  }
  updateBgSliders();
}
function closeSettings(){
  $('settingsPanel').classList.remove('open');
  $('settingsBackdrop').classList.remove('open');
}

// ─────────────────────────────────────────
// Drag & Drop (global)
// ─────────────────────────────────────────
let dragCnt=0;
document.addEventListener('dragenter',e=>{ e.preventDefault(); dragCnt++; $('dropOverlay').classList.add('active'); });
document.addEventListener('dragleave',()=>{ dragCnt--; if(dragCnt<=0){ dragCnt=0; $('dropOverlay').classList.remove('active'); } });
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',e=>{
  e.preventDefault(); dragCnt=0; $('dropOverlay').classList.remove('active');
  if(e.dataTransfer.files.length){ openUploadModal(); handleFiles(e.dataTransfer.files); }
});

// ─────────────────────────────────────────
// Keyboard
// ─────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if($('viewerBackdrop').classList.contains('open')){
    if(e.key==='ArrowLeft') viewerNav(-1);
    if(e.key==='ArrowRight') viewerNav(1);
    if(e.key==='Escape') closeViewer();
  } else if(e.key==='Escape'){
    if($('uploadModalBackdrop').classList.contains('open')) closeUploadModal();
    if($('categoryModalBackdrop').classList.contains('open')) closeCatModal();
    if($('editModalBackdrop').classList.contains('open')) closeEditModal();
    if($('settingsPanel').classList.contains('open')) closeSettings();
  }
});

// Touch swipe in viewer
let txStart=0;
$('viewerBackdrop').addEventListener('touchstart',e=>{ txStart=e.touches[0].clientX; },{passive:true});
$('viewerBackdrop').addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-txStart;
  if(Math.abs(dx)>60) viewerNav(dx<0?1:-1);
});

// ─────────────────────────────────────────
// Bind all events
// ─────────────────────────────────────────
function bindEvents(){
  // Sidebar
  $('sidebarToggle').addEventListener('click',toggleSidebar);
  $('mobileMenuBtn').addEventListener('click',toggleSidebar);
  $('sidebarOverlay').addEventListener('click',closeMobileSidebar);

  // Nav
  $('navAll').addEventListener('click',()=>setFilter('all'));
  $('navFavorites').addEventListener('click',()=>setFilter('favorites'));
  $('navRecent').addEventListener('click',()=>setFilter('recent'));

  // Search
  $('globalSearch').addEventListener('input',()=>{
    S.search=$('globalSearch').value;
    $('searchClear').style.display=S.search?'flex':'none';
    renderScores();
  });
  $('searchClear').addEventListener('click',()=>{
    $('globalSearch').value=''; S.search='';
    $('searchClear').style.display='none'; renderScores();
  });

  // Sort & view
  $('sortSelect').value=S.sort;
  $('sortSelect').addEventListener('change',()=>{ S.sort=$('sortSelect').value; saveSetting('sort',S.sort); renderScores(); });
  $('viewGrid').addEventListener('click',()=>{ S.viewMode='grid'; $('viewGrid').classList.add('active'); $('viewList').classList.remove('active'); saveSetting('viewMode','grid'); renderScores(); });
  $('viewList').addEventListener('click',()=>{ S.viewMode='list'; $('viewList').classList.add('active'); $('viewGrid').classList.remove('active'); saveSetting('viewMode','list'); renderScores(); });
  if(S.viewMode==='list'){ $('viewList').classList.add('active'); $('viewGrid').classList.remove('active'); }

  // Upload
  $('uploadBtn').addEventListener('click',openUploadModal);
  $('emptyUploadBtn').addEventListener('click',openUploadModal);
  $('uploadModalClose').addEventListener('click',closeUploadModal);
  $('uploadCancel').addEventListener('click',closeUploadModal);
  $('uploadConfirm').addEventListener('click',confirmUpload);
  $('browseBtn').addEventListener('click',()=>$('fileInput').click());
  $('uploadZone').addEventListener('click',e=>{ if(e.target!==$('browseBtn')) $('fileInput').click(); });
  $('fileInput').addEventListener('change',e=>{ handleFiles(e.target.files); e.target.value=''; });
  const uz=$('uploadZone');
  uz.addEventListener('dragover',e=>{ e.preventDefault(); e.stopPropagation(); uz.classList.add('drag-over'); });
  uz.addEventListener('dragleave',()=>uz.classList.remove('drag-over'));
  uz.addEventListener('drop',e=>{ e.preventDefault(); e.stopPropagation(); uz.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });

  // Category
  $('addCategoryBtn').addEventListener('click',()=>openCatModal());
  $('categoryModalClose').addEventListener('click',closeCatModal);
  $('categoryCancel').addEventListener('click',closeCatModal);
  $('categoryConfirm').addEventListener('click',saveCat);
  $('categoryName').addEventListener('keydown',e=>{ if(e.key==='Enter') saveCat(); });
  $('colorPicker').querySelectorAll('.color-dot').forEach(d=>{
    d.addEventListener('click',()=>{ S.selColor=d.dataset.color; document.querySelectorAll('.color-dot').forEach(x=>x.classList.remove('active')); d.classList.add('active'); });
  });
  $('emojiPicker').querySelectorAll('.emoji-btn').forEach(b=>{
    b.addEventListener('click',()=>{ S.selEmoji=b.dataset.emoji; document.querySelectorAll('.emoji-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); });
  });

  // Viewer
  $('viewerClose').addEventListener('click',closeViewer);
  $('viewerPrev').addEventListener('click',()=>viewerNav(-1));
  $('viewerNext').addEventListener('click',()=>viewerNav(1));
  $('viewerFav').addEventListener('click',()=>{ const s=S.viewerList[S.viewerIdx]; if(s) toggleFav(s.id); });
  $('viewerEdit').addEventListener('click',()=>{ const s=S.viewerList[S.viewerIdx]; if(s) openEditModal(s.id); });
  $('viewerDownload').addEventListener('click',()=>{ const s=S.viewerList[S.viewerIdx]; if(s) downloadScore(s); });
  $('viewerDelete').addEventListener('click',()=>{ const s=S.viewerList[S.viewerIdx]; if(s) deleteScore(s.id); });

  // Edit modal
  $('editModalClose').addEventListener('click',closeEditModal);
  $('editCancel').addEventListener('click',closeEditModal);
  $('editConfirm').addEventListener('click',saveEdit);

  // Difficulty groups
  bindDiffGroup('difficultyGroup');
  bindDiffGroup('editDifficultyGroup');

  // Settings
  $('settingsBtn').addEventListener('click',openSettings);
  $('settingsClose').addEventListener('click',closeSettings);
  $('settingsBackdrop').addEventListener('click',closeSettings);

  // Themes
  $('themeGrid').querySelectorAll('.theme-card').forEach(btn=>{
    btn.addEventListener('click',()=>applyTheme(btn.dataset.theme));
  });

  // Background
  $('bgSelectBtn').addEventListener('click',()=>$('bgFileInput').click());
  $('bgUploadArea').addEventListener('click',e=>{ if(e.target===$('bgUploadHint')||$('bgUploadHint').contains(e.target)) $('bgFileInput').click(); });
  $('bgFileInput').addEventListener('change',async e=>{
    const file=e.target.files[0]; if(!file) return;
    const url=await fileToDataURL(file);
    await setBgImage(url);
    e.target.value='';
  });
  $('bgRemoveBtn').addEventListener('click',async e=>{ e.stopPropagation(); await removeBgImage(); });
  $('bgBlur').addEventListener('input',async()=>{
    S.bgBlur=parseInt($('bgBlur').value);
    $('blurVal').textContent=S.bgBlur+'px';
    applyBackground();
    await saveSetting('bgBlur',S.bgBlur);
  });
  $('bgOverlayOpacity').addEventListener('input',async()=>{
    S.bgOverlay=parseInt($('bgOverlayOpacity').value);
    $('overlayVal').textContent=S.bgOverlay+'%';
    applyBackground();
    await saveSetting('bgOverlay',S.bgOverlay);
  });

  // Card size
  $('cardSizeGroup').querySelectorAll('.card-size-btn').forEach(b=>{
    b.addEventListener('click',()=>{
      S.cardSize=b.dataset.size;
      document.querySelectorAll('.card-size-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      document.documentElement.setAttribute('data-card-size',S.cardSize);
      saveSetting('cardSize',S.cardSize);
    });
  });

  // Clear all data
  $('clearAllBtn').addEventListener('click',async()=>{
    if(!confirm('确定清空所有乐谱和分类？此操作不可恢复！')) return;
    for(const s of S.scores) await dbDel('scores',s.id);
    for(const c of S.categories) await dbDel('categories',c.id);
    S.scores=[]; S.categories=[];
    await removeBgImage();
    closeSettings(); renderAll();
    toast('已清空所有数据');
  });

  // Backdrop clicks
  $('uploadModalBackdrop').addEventListener('click',e=>{ if(e.target===$('uploadModalBackdrop')) closeUploadModal(); });
  $('categoryModalBackdrop').addEventListener('click',e=>{ if(e.target===$('categoryModalBackdrop')) closeCatModal(); });
  $('editModalBackdrop').addEventListener('click',e=>{ if(e.target===$('editModalBackdrop')) closeEditModal(); });
  $('viewerBackdrop').addEventListener('click',e=>{ if(e.target===$('viewerBackdrop')) closeViewer(); });
}

// ─────────────────────────────────────────
// Boot
// ─────────────────────────────────────────
async function boot(){
  try{
    await initDB();
    await loadSettings();
    const [scores,cats]=await Promise.all([dbAll('scores'),dbAll('categories')]);
    S.scores=scores; S.categories=cats;
    applyTheme(S.theme);
    applyBackground();
    bindEvents();
    renderAll();
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  } catch(err){ console.error(err); toast('初始化失败，请刷新重试','error'); }
}

document.addEventListener('DOMContentLoaded', boot);
