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
  viewerPageIdx: 0,
  zoomScale: 1.0, panX: 0, panY: 0,
  filterMode: 'normal',
  isAnnotating: false, annotTool: 'pen', annotColor: '#ef4444',
  annotHistory: [],
  isStageMode: false, wakeLock: null,
  selColor: '#a78bfa', selEmoji: '🎵', selDiff: 0,
  editCatId: null, editScoreId: null,
  pendingFiles: [],
  expandedFolders: new Set(),
  folderModalScoreId: null,
  uploadMode: 'new',
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
function hexToRgba(hex, alpha){
  let c = hex.replace('#','');
  if(c.length===3) c=c.split('').map(x=>x+x).join('');
  const num=parseInt(c,16);
  return `rgba(${(num>>16)&255}, ${(num>>8)&255}, ${num&255}, ${alpha})`;
}

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
  updateAppendTargetSelect();
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
    const pages = (score.pages && score.pages.length) ? score.pages : [score.dataURL];
    const pagesCount = pages.length;
    const isFolder = pagesCount > 1;
    const isExpanded = S.expandedFolders.has(score.id);

    card.className='score-card' + (isFolder ? ' is-folder' : '');
    card.dataset.id=score.id;

    const pageBadge = isFolder
      ? `<div class="card-pages-badge is-folder">📁 乐谱夹 · ${pagesCount}页</div>`
      : '';
    const pageTagHtml = isFolder
      ? `<span class="tag" style="background:rgba(167,139,250,.22);color:var(--primary);font-weight:600">📁 ${pagesCount}页</span>`
      : '';
    const tagsHtml=(score.tags||[]).slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join('');
    const diffHtml=score.difficulty?`<div class="diff-badge">${DIFF_LABELS[score.difficulty]||''}</div>`:'';
    const isFav=score.favorite;

    let folderBarHtml = '';
    let folderExpandedHtml = '';
    if(isFolder){
      folderBarHtml = `
        <div class="card-folder-bar">
          <button class="folder-toggle-btn${isExpanded ? ' is-expanded' : ''}" data-act="toggle-folder" title="${isExpanded ? '折叠各页' : '展开各页预览'}">
            <span>${isExpanded ? '📁 折叠' : '📂 展开'} (${pagesCount}页)</span>
            <span class="folder-chevron">▼</span>
          </button>
          <button class="folder-manage-btn" data-act="manage-folder" title="管理此乐谱夹 (页面排序/增减)">⚙️</button>
        </div>`;
      if(isExpanded){
        const miniPagesHtml = pages.map((pUrl, pIdx) => `
          <div class="card-mini-page" data-act="jump-page" data-page="${pIdx}" title="点击看第 ${pIdx+1} 页">
            <img src="${pUrl}" alt="第 ${pIdx+1} 页" loading="lazy" />
            <span class="mini-page-num">${pIdx+1}</span>
          </div>`).join('');
        folderExpandedHtml = `
          <div class="card-folder-expanded">
            <div class="card-folder-pages-strip">
              ${miniPagesHtml}
              <button class="card-mini-page-add" data-act="append-page" title="追加图片到此乐谱夹">
                <span>➕</span>
                <span>加页</span>
              </button>
            </div>
          </div>`;
      }
    }

    if(S.viewMode==='grid'){
      card.innerHTML=`
        <div class="card-thumb">
          ${pageBadge}
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
          <div class="card-tags">${pageTagHtml}${tagsHtml}</div>
          ${diffHtml}
          ${folderBarHtml}
          ${folderExpandedHtml}
        </div>`;
    } else {
      card.innerHTML=`
        <div class="card-thumb">
          ${pageBadge}
          <img src="${score.dataURL}" alt="${esc(score.title)}" loading="lazy"/>
        </div>
        <div class="card-body">
          <div class="card-main">
            ${cat?`<div class="card-cat" style="color:${cat.color}">${esc((cat.emoji||'')+' '+cat.name)}</div>`:''}
            <div class="card-title">${esc(score.title)}</div>
            ${score.composer?`<div class="card-composer">🎼 ${esc(score.composer)}</div>`:''}
            <div class="card-tags">${pageTagHtml}${tagsHtml}${diffHtml}</div>
          </div>
          <span class="card-date">${fmtDate(score.createdAt)}</span>
          ${isFolder ? `<button class="folder-manage-btn" data-act="manage-folder" title="管理此乐谱夹" style="margin-left:8px">📁</button>` : ''}
        </div>`;
    }

    card.querySelector('.fav-btn')?.addEventListener('click',e=>{ e.stopPropagation(); toggleFav(score.id); });

    card.querySelectorAll('[data-act="toggle-folder"]').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        if(S.expandedFolders.has(score.id)){
          S.expandedFolders.delete(score.id);
        } else {
          S.expandedFolders.add(score.id);
        }
        renderScores();
      });
    });

    card.querySelectorAll('[data-act="manage-folder"]').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        openFolderModal(score.id);
      });
    });

    card.querySelectorAll('[data-act="jump-page"]').forEach(el=>{
      el.addEventListener('click', e=>{
        e.stopPropagation();
        const pIdx = parseInt(el.dataset.page) || 0;
        openViewer(idx, list, pIdx);
      });
    });

    card.querySelectorAll('[data-act="append-page"]').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        promptAppendScore(score.id);
      });
    });

    card.addEventListener('click',()=>openViewer(idx,list,0));
    grid.appendChild(card);
  });
}

function updateStorage(){
  const bytes=S.scores.reduce((a,s)=>a+(s.fileSize||0),0);
  $('storageSize').textContent=fmtSize(bytes);
  $('storageFill').style.width=Math.min((bytes/(100*1048576))*100,100)+'%';
}

// ─────────────────────────────────────────
// Upload & Folder Append
// ─────────────────────────────────────────
function setUploadMode(mode){
  S.uploadMode = mode;
  const isAppend = mode === 'append';
  $('uploadModeNew')?.classList.toggle('active', !isAppend);
  $('uploadModeAppend')?.classList.toggle('active', isAppend);
  if($('appendTargetGroup')) $('appendTargetGroup').style.display = isAppend ? 'block' : 'none';
  if($('newScoreFields')) $('newScoreFields').style.display = isAppend ? 'none' : 'block';
  if(isAppend) updateAppendTargetSelect();
}

function updateAppendTargetSelect(){
  const sel = $('appendTargetSelect');
  if(!sel) return;
  if(!S.scores.length){
    sel.innerHTML = '<option value="">(暂无乐谱，请先新建乐谱)</option>';
    return;
  }
  sel.innerHTML = S.scores.map(s => {
    const pCount = (s.pages && s.pages.length) ? s.pages.length : 1;
    const prefix = pCount > 1 ? `📁 [乐谱夹 · ${pCount}页]` : `📄 [单页]`;
    return `<option value="${s.id}">${prefix} ${esc(s.title)}</option>`;
  }).join('');
}

function openUploadModal(){
  S.pendingFiles=[];
  $('uploadPreviewList').innerHTML='';
  $('uploadForm').style.display='none';
  $('uploadModalFooter').style.display='none';
  setUploadMode('new');
  if($('mergePagesGroup')) $('mergePagesGroup').style.display='none';
  if($('mergePagesCheck')) $('mergePagesCheck').checked=true;
  $('uploadTitle').value=''; $('uploadComposer').value='';
  $('uploadTags').value=''; $('uploadNotes').value='';
  $('uploadCategory').value=''; S.selDiff=0;
  setDiffActive($('difficultyGroup'), 0);
  renderTagSuggestions();
  updateAppendTargetSelect();
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
  if($('mergePagesGroup')){
    $('mergePagesGroup').style.display = S.pendingFiles.length > 1 ? 'block' : 'none';
  }
  if(S.pendingFiles.length===1 && !$('uploadTitle').value)
    $('uploadTitle').value=S.pendingFiles[0].name.replace(/\.[^.]+$/,'');
}

function movePendingFile(idx, dir){
  const target = idx + dir;
  if(target < 0 || target >= S.pendingFiles.length) return;
  const item = S.pendingFiles.splice(idx, 1)[0];
  S.pendingFiles.splice(target, 0, item);
  renderUploadPreviews();
}

function renderUploadPreviews(){
  const list=$('uploadPreviewList'); list.innerHTML='';
  S.pendingFiles.forEach((file, fIdx)=>{
    const url=URL.createObjectURL(file);
    const div=document.createElement('div'); div.className='upload-preview-item';
    div.innerHTML=`
      <div class="upload-preview-thumb"><img src="${url}" alt=""/></div>
      <div class="upload-preview-info">
        <div class="upload-preview-name">${esc(file.name)}</div>
        <div class="upload-preview-size">${fmtSize(file.size)} · 第 ${fIdx+1} 页</div>
      </div>
      <div class="upload-preview-actions">
        <button type="button" class="upload-preview-btn up" data-idx="${fIdx}" title="前移一位" ${fIdx===0?'disabled':''}>▲</button>
        <button type="button" class="upload-preview-btn down" data-idx="${fIdx}" title="后移一位" ${fIdx===S.pendingFiles.length-1?'disabled':''}>▼</button>
      </div>
      <button type="button" class="upload-preview-remove" title="移除">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button>`;
    
    div.querySelectorAll('.upload-preview-btn.up').forEach(b=>{
      b.addEventListener('click',()=>movePendingFile(fIdx, -1));
    });
    div.querySelectorAll('.upload-preview-btn.down').forEach(b=>{
      b.addEventListener('click',()=>movePendingFile(fIdx, 1));
    });
    div.querySelector('.upload-preview-remove').addEventListener('click',()=>{
      S.pendingFiles=S.pendingFiles.filter(f=>f!==file);
      renderUploadPreviews();
      if($('mergePagesGroup')) $('mergePagesGroup').style.display = S.pendingFiles.length > 1 ? 'block' : 'none';
      if(!S.pendingFiles.length){ $('uploadForm').style.display='none'; $('uploadModalFooter').style.display='none'; }
    });
    list.appendChild(div);
  });
}

async function confirmUpload(){
  if(!S.pendingFiles.length){ toast('请先选择图片','error'); return; }
  const btn=$('uploadConfirm'); btn.disabled=true; btn.textContent='保存中…';
  try{
    if(S.uploadMode === 'append'){
      const targetId = $('appendTargetSelect')?.value;
      const targetScore = S.scores.find(s=>s.id===targetId);
      if(!targetScore){ toast('请选择要追加的目标乐谱','error'); return; }
      
      const newUrls = [];
      let addSize = 0;
      for(let i=0; i<S.pendingFiles.length; i++){
        const file = S.pendingFiles[i];
        addSize += file.size;
        const dUrl = await fileToDataURL(file);
        newUrls.push(dUrl);
      }
      
      if(!targetScore.pages || !targetScore.pages.length){
        targetScore.pages = [targetScore.dataURL];
      }
      targetScore.pages.push(...newUrls);
      targetScore.fileSize = (targetScore.fileSize || 0) + addSize;
      await dbPut('scores', targetScore);
      
      closeUploadModal();
      renderAll();
      toast(`已成功将 ${newUrls.length} 张乐谱追加至《${targetScore.title}》（现共 ${targetScore.pages.length} 页） 🎵`, 'success');
      S.pendingFiles = [];
      return;
    }

    const title=$('uploadTitle').value.trim()||'未命名乐谱';
    const categoryId=$('uploadCategory').value;
    const composer=$('uploadComposer').value.trim();
    const tags=$('uploadTags').value.split(',').map(t=>t.trim()).filter(Boolean);
    const notes=$('uploadNotes').value.trim();
    const difficulty=S.selDiff;
    const shouldMerge = S.pendingFiles.length > 1 && $('mergePagesCheck')?.checked;

    if(shouldMerge){
      const dataURLs = [];
      let totalSize = 0;
      for(let i=0; i<S.pendingFiles.length; i++){
        const file = S.pendingFiles[i];
        totalSize += file.size;
        const dUrl = await fileToDataURL(file);
        dataURLs.push(dUrl);
      }
      const score = {
        id: uid(),
        title,
        categoryId,
        composer,
        tags,
        notes,
        difficulty,
        dataURL: dataURLs[0],
        pages: dataURLs,
        annotations: {},
        filterMode: 'normal',
        fileSize: totalSize,
        fileType: S.pendingFiles[0].type,
        favorite: false,
        createdAt: Date.now()
      };
      await dbPut('scores', score);
      S.scores.push(score);
      closeUploadModal();
      renderAll();
      toast(`已保存乐谱文件夹《${title}》（共 ${dataURLs.length} 页） 🎵`, 'success');
      S.pendingFiles = [];
      return;
    }

    for(let i=0;i<S.pendingFiles.length;i++){
      const file=S.pendingFiles[i];
      const dataURL=await fileToDataURL(file);
      const score={
        id:uid(),
        title:S.pendingFiles.length>1?`${title} (${i+1})`:title,
        categoryId, composer, tags, notes, difficulty,
        dataURL,
        pages: [dataURL],
        annotations: {},
        filterMode: 'normal',
        fileSize:file.size,
        fileType:file.type,
        favorite:false,
        createdAt:Date.now()
      };
      await dbPut('scores',score);
      S.scores.push(score);
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
// Enhanced Viewer
// ─────────────────────────────────────────
const FILTER_NAMES = {
  normal: '原图模式',
  sepia: '护眼羊皮纸 (暖色)',
  invert: '夜间黑底反相',
  contrast: '高对比度锐化'
};

function openViewer(idx, list, pageIdx = 0){
  S.viewerList = list;
  S.viewerIdx = idx;
  S.viewerPageIdx = pageIdx;
  if(S.isAnnotating) toggleAnnotate();
  if(S.isStageMode) toggleStageMode();
  renderViewer();
  $('viewerBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeViewer(){
  saveAnnotation();
  if(S.isAnnotating) toggleAnnotate();
  if(S.isStageMode) toggleStageMode();
  $('filterDropdown').classList.remove('open');
  if($('viewerThumbsDrawer')) $('viewerThumbsDrawer').style.display='none';
  $('viewerBackdrop').classList.remove('open');
  document.body.style.overflow = '';
}

function renderViewer(){
  const score = S.viewerList[S.viewerIdx];
  if(!score) return;
  const cat = S.categories.find(c=>c.id===score.categoryId);
  const pages = (score.pages && score.pages.length) ? score.pages : [score.dataURL];

  if(S.viewerPageIdx >= pages.length) S.viewerPageIdx = pages.length - 1;
  if(S.viewerPageIdx < 0) S.viewerPageIdx = 0;

  $('viewerTitle').textContent = score.title;
  $('viewerCat').textContent = cat ? `${cat.emoji||''} ${cat.name}` : '未分类';
  $('viewerComposer').textContent = score.composer ? `🎼 ${score.composer}` : '';
  $('viewerDiff').textContent = score.difficulty ? (DIFF_LABELS[score.difficulty]||'') : '';

  if(pages.length > 1){
    $('viewerPagePill').style.display = 'flex';
    $('viewerPageTag').style.display = 'inline-block';
    $('viewerPageTag').textContent = `${S.viewerPageIdx+1}/${pages.length}`;
    $('pagePillText').textContent = `第 ${S.viewerPageIdx+1} / ${pages.length} 页`;
    $('pagePillPrev').disabled = (S.viewerPageIdx === 0 && S.viewerIdx === 0);
    $('pagePillNext').disabled = (S.viewerPageIdx === pages.length - 1 && S.viewerIdx === S.viewerList.length - 1);
  } else {
    $('viewerPagePill').style.display = 'none';
    $('viewerPageTag').style.display = 'none';
  }

  $('viewerCounter').textContent = `曲目 ${S.viewerIdx+1} / ${S.viewerList.length}`;

  const isFav = score.favorite;
  const vFav = $('viewerFav');
  vFav.classList.toggle('is-fav', isFav);
  vFav.querySelector('svg path').setAttribute('fill', isFav ? '#fbbf24' : 'none');
  vFav.querySelector('svg path').setAttribute('stroke', isFav ? '#fbbf24' : 'currentColor');

  $('viewerTags').innerHTML = (score.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('');
  $('viewerPrev').style.display = S.viewerIdx > 0 ? '' : 'none';
  $('viewerNext').style.display = S.viewerIdx < S.viewerList.length - 1 ? '' : 'none';

  setViewerFilter(score.filterMode || 'normal', false);
  resetZoom();

  const img = $('viewerImg');
  const targetSrc = pages[S.viewerPageIdx];
  if(img.src !== targetSrc){
    img.src = targetSrc;
  } else {
    setupAnnotationCanvas();
  }
  if($('viewerThumbsDrawer')?.style.display !== 'none') updateViewerThumbsDrawer();
}

function setupAnnotationCanvas(){
  const img = $('viewerImg');
  const cvs = $('annotationCanvas');
  if(!cvs || !img.naturalWidth || !img.naturalHeight) return;
  cvs.width = img.naturalWidth;
  cvs.height = img.naturalHeight;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  S.annotHistory = [];

  const score = S.viewerList[S.viewerIdx];
  if(score && score.annotations && score.annotations[S.viewerPageIdx]){
    const annotImg = new Image();
    annotImg.onload = () => {
      ctx.drawImage(annotImg, 0, 0);
      S.annotHistory.push(cvs.toDataURL('image/png'));
    };
    annotImg.src = score.annotations[S.viewerPageIdx];
  } else {
    S.annotHistory.push(cvs.toDataURL('image/png'));
  }
}

function viewerTurnPage(dir){
  saveAnnotation();
  const score = S.viewerList[S.viewerIdx];
  if(!score) return;
  const pages = (score.pages && score.pages.length) ? score.pages : [score.dataURL];
  const nextPg = S.viewerPageIdx + dir;

  if(nextPg >= 0 && nextPg < pages.length){
    S.viewerPageIdx = nextPg;
    renderViewer();
  } else if(nextPg < 0 && S.viewerIdx > 0){
    S.viewerIdx--;
    const prevScore = S.viewerList[S.viewerIdx];
    const prevPages = (prevScore.pages && prevScore.pages.length) ? prevScore.pages : [prevScore.dataURL];
    S.viewerPageIdx = prevPages.length - 1;
    renderViewer();
    toast(`已切换至曲谱：《${prevScore.title}》`);
  } else if(nextPg >= pages.length && S.viewerIdx < S.viewerList.length - 1){
    S.viewerIdx++;
    S.viewerPageIdx = 0;
    const nextScore = S.viewerList[S.viewerIdx];
    renderViewer();
    toast(`已切换至曲谱：《${nextScore.title}》`);
  }
}

function viewerNavScore(dir){
  saveAnnotation();
  const newIdx = S.viewerIdx + dir;
  if(newIdx < 0 || newIdx >= S.viewerList.length) return;
  S.viewerIdx = newIdx;
  S.viewerPageIdx = 0;
  const img = $('viewerImg');
  img.style.opacity = '0';
  img.style.transform = `translateX(${dir > 0 ? '40px' : '-40px'})`;
  setTimeout(() => {
    renderViewer();
    img.style.transition = 'opacity .18s,transform .18s';
    img.style.opacity = '1';
    img.style.transform = 'translateX(0)';
    setTimeout(() => img.style.transition = '', 200);
  }, 80);
}

// ─────────────────────────────────────────
// Zoom & Pan
// ─────────────────────────────────────────
function updateTransform(){
  const layer = $('viewerStageLayer');
  if(!layer) return;
  layer.style.transform = `translate(${S.panX}px, ${S.panY}px) scale(${S.zoomScale})`;
  $('zoomResetBtn').textContent = `${Math.round(S.zoomScale * 100)}%`;
}

function resetZoom(){
  S.zoomScale = 1.0;
  S.panX = 0;
  S.panY = 0;
  updateTransform();
}

function setZoom(newScale, focalX, focalY){
  const oldScale = S.zoomScale;
  const clampedScale = Math.min(Math.max(newScale, 0.5), 4.0);
  if(clampedScale === oldScale) return;

  if(focalX != null && focalY != null){
    const ratio = clampedScale / oldScale;
    S.panX = focalX - (focalX - S.panX) * ratio;
    S.panY = focalY - (focalY - S.panY) * ratio;
  }
  S.zoomScale = clampedScale;
  if(S.zoomScale <= 1.0){
    S.panX = 0;
    S.panY = 0;
  }
  updateTransform();
}

function fitZoom(){
  const vp = $('viewerViewport');
  const img = $('viewerImg');
  if(!vp || !img.naturalWidth){ resetZoom(); return; }
  const vw = vp.clientWidth - 32;
  const vh = vp.clientHeight - 32;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.min(vw / iw, vh / ih, 1.0);
  S.zoomScale = Math.max(scale, 0.5);
  S.panX = 0;
  S.panY = 0;
  updateTransform();
}

// ─────────────────────────────────────────
// Visual Filters
// ─────────────────────────────────────────
function setViewerFilter(mode, save = true){
  S.filterMode = mode;
  const layer = $('viewerStageLayer');
  if(!layer) return;
  layer.classList.remove('viewer-filter-normal', 'viewer-filter-sepia', 'viewer-filter-invert', 'viewer-filter-contrast');
  layer.classList.add(`viewer-filter-${mode}`);

  document.querySelectorAll('.filter-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === mode);
  });

  if(save){
    const score = S.viewerList[S.viewerIdx];
    if(score){
      score.filterMode = mode;
      dbPut('scores', score);
    }
    toast(`已切换至：${FILTER_NAMES[mode] || mode}`);
  }
}

function toggleFilterDropdown(){
  $('filterDropdown').classList.toggle('open');
}

// ─────────────────────────────────────────
// Drawing & Annotations
// ─────────────────────────────────────────
let isDrawing = false;
let lastDrawX = 0, lastDrawY = 0;

function toggleAnnotate(){
  S.isAnnotating = !S.isAnnotating;
  $('viewerAnnotBtn').classList.toggle('active', S.isAnnotating);
  $('annotToolbar').style.display = S.isAnnotating ? 'flex' : 'none';
  $('viewerStageLayer').classList.toggle('is-annotating', S.isAnnotating);
  if(!S.isAnnotating){
    saveAnnotation();
  } else {
    resetZoom();
  }
}

function getCanvasPos(e){
  const cvs = $('annotationCanvas');
  const rect = cvs.getBoundingClientRect();
  const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
  const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
  return {
    x: (clientX - rect.left) * (cvs.width / rect.width),
    y: (clientY - rect.top) * (cvs.height / rect.height)
  };
}

function startDraw(e){
  if(!S.isAnnotating) return;
  isDrawing = true;
  const pos = getCanvasPos(e);
  lastDrawX = pos.x;
  lastDrawY = pos.y;
}

function drawMove(e){
  if(!isDrawing || !S.isAnnotating) return;
  const cvs = $('annotationCanvas');
  const ctx = cvs.getContext('2d');
  const pos = getCanvasPos(e);
  const baseScale = Math.max(cvs.width, cvs.height) / 1200;

  if(S.annotTool === 'pen'){
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = S.annotColor;
    ctx.lineWidth = Math.max(2, 3.5 * baseScale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastDrawX, lastDrawY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  } else if(S.annotTool === 'highlighter'){
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hexToRgba(S.annotColor, 0.35);
    ctx.lineWidth = Math.max(14, 24 * baseScale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastDrawX, lastDrawY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  } else if(S.annotTool === 'eraser'){
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = Math.max(18, 30 * baseScale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastDrawX, lastDrawY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }
  lastDrawX = pos.x;
  lastDrawY = pos.y;
}

function endDraw(){
  if(!isDrawing) return;
  isDrawing = false;
  const cvs = $('annotationCanvas');
  if(S.annotHistory.length > 20) S.annotHistory.shift();
  S.annotHistory.push(cvs.toDataURL('image/png'));
  saveAnnotation();
}

function saveAnnotation(){
  const cvs = $('annotationCanvas');
  const score = S.viewerList[S.viewerIdx];
  if(!score || !cvs || !cvs.width || !cvs.height) return;
  score.annotations = score.annotations || {};
  score.annotations[S.viewerPageIdx] = cvs.toDataURL('image/png');
  dbPut('scores', score);
}

function undoAnnot(){
  if(S.annotHistory.length <= 1) return;
  S.annotHistory.pop();
  const prevData = S.annotHistory[S.annotHistory.length - 1];
  const cvs = $('annotationCanvas');
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  if(prevData){
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = prevData;
  }
  saveAnnotation();
}

function clearAnnot(){
  const cvs = $('annotationCanvas');
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  S.annotHistory.push(cvs.toDataURL('image/png'));
  saveAnnotation();
  toast('已清空当前页标注');
}

// ─────────────────────────────────────────
// Stage Mode & WakeLock
// ─────────────────────────────────────────
function toggleStageMode(){
  S.isStageMode = !S.isStageMode;
  const vb = $('viewerBackdrop');
  vb.classList.toggle('stage-mode', S.isStageMode);
  $('viewerStageBtn').classList.toggle('active', S.isStageMode);

  if(S.isStageMode){
    if(document.documentElement.requestFullscreen){
      document.documentElement.requestFullscreen().catch(() => {});
    }
    if('wakeLock' in navigator){
      navigator.wakeLock.request('screen').then(lock => {
        S.wakeLock = lock;
      }).catch(() => {});
    }
    const hint = $('stageModeHint');
    hint.classList.add('active');
    setTimeout(() => hint.classList.remove('active'), 3200);
  } else {
    if(document.fullscreenElement && document.exitFullscreen){
      document.exitFullscreen().catch(() => {});
    }
    if(S.wakeLock){
      S.wakeLock.release().catch(() => {});
      S.wakeLock = null;
    }
  }
}

async function toggleFav(id){
  const s = S.scores.find(x => x.id === id);
  if(!s) return;
  s.favorite = !s.favorite;
  await dbPut('scores', s);
  renderAll();
  if($('viewerBackdrop').classList.contains('open')) renderViewer();
  toast(s.favorite ? '已收藏 ❤️' : '已取消收藏');
}

async function deleteScore(id){
  if(!confirm('确定删除这张乐谱？此操作不可恢复。')) return;
  await dbDel('scores', id);
  S.scores = S.scores.filter(s => s.id !== id);
  closeViewer();
  renderAll();
  toast('已删除');
}

function downloadScore(score){
  const pages = (score.pages && score.pages.length) ? score.pages : [score.dataURL];
  const currentImgUrl = pages[S.viewerPageIdx] || score.dataURL;
  const a = document.createElement('a');
  a.href = currentImgUrl;
  const pageSuffix = pages.length > 1 ? `_第${S.viewerPageIdx+1}页` : '';
  a.download = `${score.title}${pageSuffix}.${(score.fileType || 'image/jpeg').split('/')[1] || 'jpg'}`;
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

  const pagesCount = (s.pages && s.pages.length) ? s.pages.length : 1;
  if($('editPagesCountText')){
    $('editPagesCountText').textContent = pagesCount > 1
      ? `共 ${pagesCount} 页 (乐谱文件夹)`
      : `共 1 页 (单张乐谱)`;
  }
  if($('editOpenFolderBtn')){
    $('editOpenFolderBtn').onclick = () => {
      closeEditModal();
      openFolderModal(s.id);
    };
  }

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
// Score Folder Modal (乐谱文件夹管理)
// ─────────────────────────────────────────
function openFolderModal(scoreId){
  const s = S.scores.find(x => x.id === scoreId);
  if(!s) return;
  S.folderModalScoreId = scoreId;
  renderFolderModal();
  $('folderModalBackdrop').classList.add('open');
}

function closeFolderModal(){
  $('folderModalBackdrop').classList.remove('open');
  S.folderModalScoreId = null;
}

function renderFolderModal(){
  const s = S.scores.find(x => x.id === S.folderModalScoreId);
  if(!s) return;
  const pages = (s.pages && s.pages.length) ? s.pages : [s.dataURL];
  $('folderModalTitle').textContent = `📁 乐谱文件夹 · 《${s.title}》`;
  $('folderModalPageCount').textContent = `共 ${pages.length} 页`;
  $('folderModalMeta').innerHTML = `
    <span>🎼 作曲/来源：${esc(s.composer || '未填写')}</span>
    <span>·</span>
    <span>📅 添加时间：${fmtDate(s.createdAt)}</span>
  `;

  const grid = $('folderPagesGrid');
  grid.innerHTML = '';

  pages.forEach((pUrl, pIdx) => {
    const item = document.createElement('div');
    item.className = 'folder-page-item';
    item.innerHTML = `
      <div class="folder-page-thumb" title="点击直接打开全屏看谱 (第 ${pIdx+1} 页)">
        <img src="${pUrl}" alt="第 ${pIdx+1} 页" loading="lazy" />
        <span class="folder-page-num">第 ${pIdx+1} 页</span>
      </div>
      <div class="folder-page-actions">
        <button type="button" class="folder-page-btn" data-act="prev" title="前移一位" ${pIdx===0?'disabled':''}>⬅️</button>
        <button type="button" class="folder-page-btn" data-act="next" title="后移一位" ${pIdx===pages.length-1?'disabled':''}>➡️</button>
        <button type="button" class="folder-page-btn" data-act="dl" title="下载本页">📥</button>
        <button type="button" class="folder-page-btn danger" data-act="del" title="删除本页">🗑️</button>
      </div>
    `;

    item.querySelector('.folder-page-thumb').addEventListener('click', () => {
      closeFolderModal();
      const scoreIdx = S.scores.findIndex(x => x.id === s.id);
      openViewer(scoreIdx, S.scores, pIdx);
    });

    item.querySelector('[data-act="prev"]').addEventListener('click', () => {
      moveScorePage(s.id, pIdx, -1);
    });
    item.querySelector('[data-act="next"]').addEventListener('click', () => {
      moveScorePage(s.id, pIdx, 1);
    });
    item.querySelector('[data-act="dl"]').addEventListener('click', () => {
      downloadSinglePage(s, pIdx);
    });
    item.querySelector('[data-act="del"]').addEventListener('click', () => {
      deleteScorePage(s.id, pIdx);
    });

    grid.appendChild(item);
  });
}

async function moveScorePage(scoreId, pIdx, dir){
  const s = S.scores.find(x => x.id === scoreId);
  if(!s) return;
  const pages = (s.pages && s.pages.length) ? s.pages : [s.dataURL];
  const targetIdx = pIdx + dir;
  if(targetIdx < 0 || targetIdx >= pages.length) return;

  const tmpPage = pages[pIdx];
  pages[pIdx] = pages[targetIdx];
  pages[targetIdx] = tmpPage;
  s.pages = pages;
  s.dataURL = pages[0];

  if(s.annotations){
    const a1 = s.annotations[pIdx];
    const a2 = s.annotations[targetIdx];
    delete s.annotations[pIdx];
    delete s.annotations[targetIdx];
    if(a1) s.annotations[targetIdx] = a1;
    if(a2) s.annotations[pIdx] = a2;
  }

  await dbPut('scores', s);
  renderFolderModal();
  renderAll();
  if($('viewerBackdrop').classList.contains('open') && S.viewerList[S.viewerIdx]?.id === scoreId){
    renderViewer();
  }
}

async function deleteScorePage(scoreId, pIdx){
  const s = S.scores.find(x => x.id === scoreId);
  if(!s) return;
  const pages = (s.pages && s.pages.length) ? s.pages : [s.dataURL];
  if(pages.length <= 1){
    if(confirm('该乐谱夹仅剩最后一页图片，删除将彻底删除整首乐谱，确定继续吗？')){
      await dbDel('scores', scoreId);
      S.scores = S.scores.filter(x => x.id !== scoreId);
      closeFolderModal();
      closeViewer();
      renderAll();
      toast('乐谱已删除');
    }
    return;
  }

  if(!confirm(`确定从《${s.title}》中删除第 ${pIdx+1} 页图片？`)) return;

  pages.splice(pIdx, 1);
  s.pages = pages;
  s.dataURL = pages[0];

  if(s.annotations){
    const newAnnot = {};
    Object.keys(s.annotations).forEach(k => {
      const idx = parseInt(k);
      if(idx < pIdx) newAnnot[idx] = s.annotations[idx];
      else if(idx > pIdx) newAnnot[idx - 1] = s.annotations[idx];
    });
    s.annotations = newAnnot;
  }

  await dbPut('scores', s);
  renderFolderModal();
  renderAll();
  if($('viewerBackdrop').classList.contains('open') && S.viewerList[S.viewerIdx]?.id === scoreId){
    if(S.viewerPageIdx >= pages.length) S.viewerPageIdx = pages.length - 1;
    renderViewer();
  }
  toast(`已删除第 ${pIdx+1} 页，现剩余 ${pages.length} 页`);
}

async function appendPagesToScore(scoreId, files){
  const s = S.scores.find(x => x.id === scoreId);
  if(!s) return;
  const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
  if(!imgs.length){ toast('请选择有效的乐谱图片文件', 'error'); return; }

  const newUrls = [];
  let totalAddSize = 0;
  for(let i=0; i<imgs.length; i++){
    const file = imgs[i];
    totalAddSize += file.size;
    const dUrl = await fileToDataURL(file);
    newUrls.push(dUrl);
  }

  if(!s.pages || !s.pages.length) s.pages = [s.dataURL];
  s.pages.push(...newUrls);
  s.fileSize = (s.fileSize || 0) + totalAddSize;
  await dbPut('scores', s);

  renderFolderModal();
  renderAll();
  if($('viewerBackdrop').classList.contains('open') && S.viewerList[S.viewerIdx]?.id === scoreId){
    renderViewer();
  }
  toast(`成功追加 ${newUrls.length} 张图片至《${s.title}》（共 ${s.pages.length} 页） 🎵`, 'success');
}

function promptAppendScore(scoreId){
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener('change', async e => {
    if(e.target.files && e.target.files.length){
      await appendPagesToScore(scoreId, e.target.files);
    }
    inp.remove();
  });
  inp.click();
}

function downloadSinglePage(score, pageIdx){
  const pages = (score.pages && score.pages.length) ? score.pages : [score.dataURL];
  const url = pages[pageIdx] || score.dataURL;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${score.title}_第${pageIdx+1}页.${(score.fileType || 'image/jpeg').split('/')[1] || 'jpg'}`;
  a.click();
}

// ─────────────────────────────────────────
// Viewer Thumbnail Drawer
// ─────────────────────────────────────────
function toggleViewerThumbsDrawer(){
  const drawer = $('viewerThumbsDrawer');
  if(!drawer) return;
  const isOpen = drawer.style.display !== 'none';
  if(isOpen){
    drawer.style.display = 'none';
  } else {
    drawer.style.display = 'block';
    updateViewerThumbsDrawer();
  }
}

function updateViewerThumbsDrawer(){
  const drawer = $('viewerThumbsDrawer');
  if(!drawer || drawer.style.display === 'none') return;
  const score = S.viewerList[S.viewerIdx];
  if(!score) return;
  const pages = (score.pages && score.pages.length) ? score.pages : [score.dataURL];
  const list = $('viewerThumbsList');
  if(!list) return;
  list.innerHTML = '';

  pages.forEach((pUrl, pIdx) => {
    const item = document.createElement('div');
    const isActive = pIdx === S.viewerPageIdx;
    item.className = 'viewer-thumb-item' + (isActive ? ' active' : '');
    item.title = `第 ${pIdx+1} 页`;
    item.innerHTML = `
      <img src="${pUrl}" alt="第 ${pIdx+1} 页" loading="lazy" />
      <span class="viewer-thumb-num">${pIdx+1}</span>
    `;
    item.addEventListener('click', () => {
      saveAnnotation();
      S.viewerPageIdx = pIdx;
      renderViewer();
      updateViewerThumbsDrawer();
    });
    list.appendChild(item);
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
// Gestures & Canvas Interaction
// ─────────────────────────────────────────
let isPanning = false;
let panStartX = 0, panStartY = 0;
let initialPinchDist = 0;
let initialPinchScale = 1.0;
let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
let lastTapTime = 0;

function setupViewportGestures(){
  const vp = $('viewerViewport');
  const layer = $('viewerStageLayer');
  if(!vp || !layer) return;

  // Mouse Wheel Zoom
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    const focalX = e.clientX - rect.left - rect.width / 2;
    const focalY = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom(S.zoomScale * factor, focalX, focalY);
  }, { passive: false });

  // Mouse Drag to Pan
  layer.addEventListener('mousedown', e => {
    if(S.isAnnotating) return;
    if(e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX - S.panX;
    panStartY = e.clientY - S.panY;
    layer.classList.add('is-dragging');
  });

  window.addEventListener('mousemove', e => {
    if(!isPanning || S.isAnnotating) return;
    S.panX = e.clientX - panStartX;
    S.panY = e.clientY - panStartY;
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    if(isPanning){
      isPanning = false;
      layer.classList.remove('is-dragging');
    }
  });

  // Double Click / Double Tap to Toggle Zoom
  layer.addEventListener('dblclick', e => {
    if(S.isAnnotating) return;
    const rect = vp.getBoundingClientRect();
    const focalX = e.clientX - rect.left - rect.width / 2;
    const focalY = e.clientY - rect.top - rect.height / 2;
    if(S.zoomScale > 1.1){
      resetZoom();
    } else {
      setZoom(2.2, focalX, focalY);
    }
  });

  // Touch Handling: Pinch-to-zoom + Swipe to Turn Page + Pan
  vp.addEventListener('touchstart', e => {
    if(S.isAnnotating) return;
    if(e.touches.length === 2){
      isPanning = false;
      initialPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialPinchScale = S.zoomScale;
    } else if(e.touches.length === 1){
      const now = Date.now();
      if(now - lastTapTime < 320){
        // Double tap!
        const rect = vp.getBoundingClientRect();
        const focalX = e.touches[0].clientX - rect.left - rect.width / 2;
        const focalY = e.touches[0].clientY - rect.top - rect.height / 2;
        if(S.zoomScale > 1.1) resetZoom();
        else setZoom(2.2, focalX, focalY);
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      isPanning = true;
      panStartX = e.touches[0].clientX - S.panX;
      panStartY = e.touches[0].clientY - S.panY;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = now;
      layer.classList.add('is-dragging');
    }
  }, { passive: true });

  vp.addEventListener('touchmove', e => {
    if(S.isAnnotating) return;
    if(e.touches.length === 2){
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if(initialPinchDist > 0){
        const factor = currentDist / initialPinchDist;
        const rect = vp.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - rect.width / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top - rect.height / 2;
        setZoom(initialPinchScale * factor, midX, midY);
      }
    } else if(e.touches.length === 1 && isPanning){
      if(S.zoomScale > 1.05){
        e.preventDefault();
        S.panX = e.touches[0].clientX - panStartX;
        S.panY = e.touches[0].clientY - panStartY;
        updateTransform();
      }
    }
  }, { passive: false });

  vp.addEventListener('touchend', e => {
    if(S.isAnnotating) return;
    if(e.touches.length < 2) initialPinchDist = 0;
    if(e.touches.length === 0){
      isPanning = false;
      layer.classList.remove('is-dragging');

      // Detect horizontal swipe to turn page when scale is normal
      if(S.zoomScale <= 1.05 && e.changedTouches.length === 1){
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        const dt = Date.now() - touchStartTime;
        if(Math.abs(deltaX) > 50 && Math.abs(deltaY) < 60 && dt < 400){
          viewerTurnPage(deltaX < 0 ? 1 : -1);
        }
      }
    }
  }, { passive: true });

  // Canvas Drawing Pointer Events
  const cvs = $('annotationCanvas');
  if(cvs){
    cvs.addEventListener('pointerdown', e => {
      if(!S.isAnnotating) return;
      cvs.setPointerCapture(e.pointerId);
      startDraw(e);
    });
    cvs.addEventListener('pointermove', e => {
      if(!S.isAnnotating) return;
      drawMove(e);
    });
    cvs.addEventListener('pointerup', e => {
      if(!S.isAnnotating) return;
      cvs.releasePointerCapture(e.pointerId);
      endDraw();
    });
    cvs.addEventListener('pointercancel', () => {
      if(!S.isAnnotating) return;
      endDraw();
    });
  }

  // Image load event to configure annotation canvas dimensions
  $('viewerImg').addEventListener('load', () => {
    setupAnnotationCanvas();
  });
}

// ─────────────────────────────────────────
// Keyboard & Pedals
// ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if($('viewerBackdrop').classList.contains('open')){
    if(e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter'){
      e.preventDefault();
      viewerTurnPage(1);
    } else if(e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace'){
      e.preventDefault();
      viewerTurnPage(-1);
    } else if(e.key === '+' || e.key === '='){
      e.preventDefault();
      setZoom(S.zoomScale + 0.25);
    } else if(e.key === '-'){
      e.preventDefault();
      setZoom(S.zoomScale - 0.25);
    } else if(e.key === '0'){
      e.preventDefault();
      resetZoom();
    } else if(e.key === 'Escape'){
      if($('filterDropdown').classList.contains('open')){
        $('filterDropdown').classList.remove('open');
      } else if(S.isAnnotating){
        toggleAnnotate();
      } else if(S.isStageMode){
        toggleStageMode();
      } else {
        closeViewer();
      }
    }
  } else if(e.key === 'Escape'){
    if($('uploadModalBackdrop').classList.contains('open')) closeUploadModal();
    if($('categoryModalBackdrop').classList.contains('open')) closeCatModal();
    if($('editModalBackdrop').classList.contains('open')) closeEditModal();
    if($('folderModalBackdrop')?.classList.contains('open')) closeFolderModal();
    if($('settingsPanel').classList.contains('open')) closeSettings();
  }
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

  // Viewer Actions
  $('viewerClose').addEventListener('click',closeViewer);
  $('viewerPrev').addEventListener('click',()=>viewerNavScore(-1));
  $('viewerNext').addEventListener('click',()=>viewerNavScore(1));
  $('pagePillPrev').addEventListener('click',()=>viewerTurnPage(-1));
  $('pagePillNext').addEventListener('click',()=>viewerTurnPage(1));
  $('viewerFav').addEventListener('click',()=>{ const s=S.viewerList[S.viewerIdx]; if(s) toggleFav(s.id); });
  $('viewerEdit').addEventListener('click',()=>{ const s=S.viewerList[S.viewerIdx]; if(s) openEditModal(s.id); });
  $('viewerDownload').addEventListener('click',()=>{ const s=S.viewerList[S.viewerIdx]; if(s) downloadScore(s); });
  $('viewerDelete').addEventListener('click',()=>{ const s=S.viewerList[S.viewerIdx]; if(s) deleteScore(s.id); });

  // Zoom Bar
  $('zoomInBtn').addEventListener('click',()=>setZoom(S.zoomScale+0.25));
  $('zoomOutBtn').addEventListener('click',()=>setZoom(S.zoomScale-0.25));
  $('zoomResetBtn').addEventListener('click',resetZoom);
  $('zoomFitBtn').addEventListener('click',fitZoom);

  // Filters
  $('viewerFilterBtn').addEventListener('click',e=>{
    e.stopPropagation();
    toggleFilterDropdown();
  });
  document.querySelectorAll('.filter-opt').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      setViewerFilter(btn.dataset.filter, true);
      $('filterDropdown').classList.remove('open');
    });
  });
  document.addEventListener('click', e => {
    if($('filterDropdown').classList.contains('open') && !$('filterDropdown').contains(e.target) && e.target !== $('viewerFilterBtn') && !$('viewerFilterBtn').contains(e.target)){
      $('filterDropdown').classList.remove('open');
    }
  });

  // Annotations
  $('viewerAnnotBtn').addEventListener('click',toggleAnnotate);
  document.querySelectorAll('.annot-tool-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.annot-tool-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      S.annotTool = btn.dataset.tool;
    });
  });
  document.querySelectorAll('.annot-color-dot').forEach(dot=>{
    dot.addEventListener('click',()=>{
      document.querySelectorAll('.annot-color-dot').forEach(d=>d.classList.remove('active'));
      dot.classList.add('active');
      S.annotColor = dot.dataset.color;
    });
  });
  $('annotUndoBtn').addEventListener('click',undoAnnot);
  $('annotClearBtn').addEventListener('click',clearAnnot);
  $('annotDoneBtn').addEventListener('click',toggleAnnotate);

  // Stage Mode & Tap Zones
  $('viewerStageBtn').addEventListener('click',toggleStageMode);
  $('viewerZoneLeft').addEventListener('click',()=>viewerTurnPage(-1));
  $('viewerZoneRight').addEventListener('click',()=>viewerTurnPage(1));
  $('viewerZoneCenter').addEventListener('click',()=>{
    $('viewerBackdrop').classList.toggle('show-controls');
  });

  // Setup Viewport Gestures
  setupViewportGestures();

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
  $('viewerBackdrop').addEventListener('click',e=>{
    if(e.target===$('viewerBackdrop')) closeViewer();
  });
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
