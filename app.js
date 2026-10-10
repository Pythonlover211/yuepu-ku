'use strict';
// ─────────────────────────────────────────
// IndexedDB
// ─────────────────────────────────────────
const DB_NAME = 'MusicScoreDB2', DB_VER = 3;
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
      if (!d.objectStoreNames.contains('checkins')) {
        const cs = d.createObjectStore('checkins', { keyPath: 'id' });
        cs.createIndex('date', 'date', { unique: false });
        cs.createIndex('createdAt', 'createdAt', { unique: false });
      }
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
  pendingAppendScoreId: null,
  uploadMode: 'new',
  // Practice & Reminder state
  checkins: [],
  selectedDuration: 30,
  selectedMood: '😊 渐入佳境',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  reminderEnabled: false,
  reminderTime: '20:00',
  reminderText: '🎹 该练琴啦！保持指尖记忆，今天也要坚持弹奏哦～',
  lastRemindedDate: null,
  snoozeUntil: 0,
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
function fileToDataURL(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = e => rej(e);
    r.readAsDataURL(file);
  });
}
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
    if(r.key==='reminderEnabled' && r.value!=null) S.reminderEnabled=Boolean(r.value);
    if(r.key==='reminderTime' && r.value) S.reminderTime=r.value;
    if(r.key==='reminderText' && r.value) S.reminderText=r.value;
    if(r.key==='lastRemindedDate') S.lastRemindedDate=r.value;
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
  updatePracticeBadges();
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
  const imgs = Array.from(files).filter(f => !f.type || f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg|bmp)$/i.test(f.name));
  if(!imgs.length){ toast('请选择有效的乐谱图片文件', 'error'); return; }

  const newUrls = [];
  let totalAddSize = 0;
  for(let i = 0; i < imgs.length; i++){
    const file = imgs[i];
    totalAddSize += file.size || 0;
    try {
      const dUrl = await fileToDataURL(file);
      newUrls.push(dUrl);
    } catch(err){
      console.error('读取图片失败:', file.name, err);
    }
  }

  if(!newUrls.length){ toast('未能成功读取图片文件，请重试', 'error'); return; }

  if(!s.pages || !s.pages.length) s.pages = [s.dataURL];
  s.pages.push(...newUrls);
  s.fileSize = (s.fileSize || 0) + totalAddSize;
  await dbPut('scores', s);

  if(S.folderModalScoreId === scoreId){
    renderFolderModal();
  }
  renderAll();
  if($('viewerBackdrop').classList.contains('open') && S.viewerList[S.viewerIdx]?.id === scoreId){
    renderViewer();
  }
  toast(`成功追加 ${newUrls.length} 张图片至《${s.title}》（共 ${s.pages.length} 页） 🎵`, 'success');
}

function promptAppendScore(scoreId){
  S.pendingAppendScoreId = scoreId;
  const inp = $('folderAppendInput');
  if(inp){
    inp.value = '';
    inp.click();
  } else {
    const fallbackInp = document.createElement('input');
    fallbackInp.type = 'file';
    fallbackInp.accept = 'image/*';
    fallbackInp.multiple = true;
    fallbackInp.style.display = 'none';
    document.body.appendChild(fallbackInp);
    fallbackInp.addEventListener('change', async e => {
      if(e.target.files && e.target.files.length){
        await appendPagesToScore(scoreId, e.target.files);
      }
      fallbackInp.remove();
    });
    fallbackInp.click();
  }
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
    if($('practiceModalBackdrop')?.classList.contains('open')) closePracticeModal();
    if($('reminderNoticeBackdrop')?.classList.contains('open')) closeReminderNotice();
  }
});

// ─────────────────────────────────────────

// ─────────────────────────────────────────
// Practice Checkin & Daily Reminder Functions
// ─────────────────────────────────────────

function getLocalDateStr(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calculatePracticeStats() {
  const datesSet = new Set(S.checkins.map(c => c.date));
  const totalDays = datesSet.size;
  const totalMinutes = S.checkins.reduce((acc, c) => acc + (Number(c.duration) || 0), 0);

  // Current Streak Calculation
  const todayStr = getLocalDateStr(new Date());
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayStr = getLocalDateStr(yesterday);

  let streak = 0;
  if (datesSet.has(todayStr)) {
    streak = 1;
    let checkDate = new Date(Date.now() - 86400000);
    while (datesSet.has(getLocalDateStr(checkDate))) {
      streak++;
      checkDate = new Date(checkDate.getTime() - 86400000);
    }
  } else if (datesSet.has(yesterdayStr)) {
    streak = 1;
    let checkDate = new Date(Date.now() - 2 * 86400000);
    while (datesSet.has(getLocalDateStr(checkDate))) {
      streak++;
      checkDate = new Date(checkDate.getTime() - 86400000);
    }
  }

  // Max Streak
  let maxStreak = 0;
  if (datesSet.size > 0) {
    const sortedDates = Array.from(datesSet).sort();
    let currentSeq = 1;
    maxStreak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prevD = new Date(sortedDates[i - 1] + 'T00:00:00');
      const curD = new Date(sortedDates[i] + 'T00:00:00');
      const diff = Math.round((curD - prevD) / 86400000);
      if (diff === 1) {
        currentSeq++;
        if (currentSeq > maxStreak) maxStreak = currentSeq;
      } else if (diff > 1) {
        currentSeq = 1;
      }
    }
  }

  return { streak, totalDays, totalMinutes, maxStreak };
}

function updatePracticeBadges() {
  const { streak, totalDays, totalMinutes, maxStreak } = calculatePracticeStats();

  const streakBadge = $('badgePracticeStreak');
  if (streakBadge) {
    streakBadge.textContent = streak > 0 ? `${streak}天` : '0';
  }

  const topbarBadge = $('topbarPracticeBadge');
  if (topbarBadge) {
    topbarBadge.textContent = streak > 0 ? `${streak}天` : '打卡';
  }

  const todayStr = getLocalDateStr();
  const checkedToday = S.checkins.some(c => c.date === todayStr);
  const topbarBtn = $('topbarPracticeBtn');
  if (topbarBtn) {
    if (checkedToday) {
      topbarBtn.classList.add('is-checked');
      topbarBtn.title = `今日已打卡（连续 ${streak} 天）`;
    } else {
      topbarBtn.classList.remove('is-checked');
      topbarBtn.title = '今日练琴打卡';
    }
  }

  if ($('statStreak')) $('statStreak').textContent = `${streak} 天`;
  if ($('statTotalDays')) $('statTotalDays').textContent = `${totalDays} 天`;
  if ($('statTotalTime')) {
    $('statTotalTime').textContent = totalMinutes >= 60 ? `${(totalMinutes / 60).toFixed(1)} 小时` : `${totalMinutes} 分钟`;
  }
  if ($('statBestStreak')) $('statBestStreak').textContent = `${maxStreak} 天`;
  if ($('practiceHeaderStreak')) $('practiceHeaderStreak').textContent = `🔥 连续 ${streak} 天`;
}

function updatePracticeScoreSelect() {
  const sel = $('practiceScoreSelect');
  if (!sel) return;
  const curVal = sel.value;
  sel.innerHTML = `
    <option value="">— 选择库中乐谱或手动输入 —</option>
    <option value="__custom__">✍️ 手动输入练习曲 / 基础练习</option>
  `;
  if (S.scores && S.scores.length) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = '🎼 乐谱库曲目';
    S.scores.slice().sort((a,b)=>a.title.localeCompare(b.title, 'zh-Hans-CN')).forEach(score => {
      const opt = document.createElement('option');
      opt.value = score.id;
      const pagesCount = (score.pages && score.pages.length) ? score.pages.length : 1;
      opt.textContent = `${score.title}${score.composer ? ' - ' + score.composer : ''}${pagesCount > 1 ? ' (' + pagesCount + '页)' : ''}`;
      optgroup.appendChild(opt);
    });
    sel.appendChild(optgroup);
  }
  if (curVal) sel.value = curVal;
}

function openPracticeModal(presetScoreId = null) {
  updatePracticeScoreSelect();
  if (presetScoreId) {
    const sel = $('practiceScoreSelect');
    if (sel) sel.value = presetScoreId;
    if ($('practiceCustomScore')) $('practiceCustomScore').style.display = 'none';
  }

  const todayStr = getLocalDateStr();
  if ($('todayBannerDate')) $('todayBannerDate').textContent = todayStr;

  const todayCheckins = S.checkins.filter(c => c.date === todayStr);
  const banner = $('practiceTodayBanner');
  if (banner) {
    if (todayCheckins.length > 0) {
      banner.classList.add('is-done');
      const totalDur = todayCheckins.reduce((s, c) => s + (Number(c.duration) || 0), 0);
      const titles = todayCheckins.map(c => c.scoreTitle).filter(Boolean).join('、');
      if ($('todayBannerTitle')) $('todayBannerTitle').textContent = `🎉 今日已打卡 (${totalDur}分钟)`;
      if ($('todayBannerDesc')) $('todayBannerDesc').textContent = titles ? `已练习：${titles}。继续保持绝佳状态！` : '今日已完成练琴任务，手感渐入佳境！';
      if ($('practiceSubmitBtn')) $('practiceSubmitBtn').innerHTML = '<span>➕ 追加今日练习记录</span>';
    } else {
      banner.classList.remove('is-done');
      if ($('todayBannerTitle')) $('todayBannerTitle').textContent = '今日尚未打卡';
      if ($('todayBannerDesc')) $('todayBannerDesc').textContent = '弹奏一曲，享受音符流淌。记录今天的练琴时长与心得吧！';
      if ($('practiceSubmitBtn')) $('practiceSubmitBtn').innerHTML = '<span>🎵 完成今日打卡</span>';
    }
  }

  updatePracticeBadges();
  updateReminderUIStatus();
  setPracticeTab('checkin');

  $('practiceModalBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePracticeModal() {
  $('practiceModalBackdrop').classList.remove('open');
  document.body.style.overflow = '';
}

function setPracticeTab(tab) {
  ['checkin', 'calendar', 'history'].forEach(t => {
    const btn = $(`practiceTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const content = $(`practice${t.charAt(0).toUpperCase() + t.slice(1)}Content`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (content) content.style.display = t === tab ? 'block' : 'none';
  });

  if (tab === 'calendar') {
    renderPracticeCalendar();
  } else if (tab === 'history') {
    renderPracticeHistory();
  }
}

function renderPracticeCalendar() {
  const grid = $('calendarDaysGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if ($('calendarCurMonth')) {
    $('calendarCurMonth').textContent = `${S.calYear}年 ${S.calMonth + 1}月`;
  }

  const firstDayIdx = new Date(S.calYear, S.calMonth, 1).getDay();
  const totalDays = new Date(S.calYear, S.calMonth + 1, 0).getDate();
  const prevTotalDays = new Date(S.calYear, S.calMonth, 0).getDate();

  const checkinMap = new Map();
  S.checkins.forEach(c => {
    if (!checkinMap.has(c.date)) checkinMap.set(c.date, []);
    checkinMap.get(c.date).push(c);
  });

  // Previous month trailing days
  for (let i = firstDayIdx - 1; i >= 0; i--) {
    const dayNum = prevTotalDays - i;
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell other-month';
    cell.innerHTML = `<span class="day-number">${dayNum}</span>`;
    grid.appendChild(cell);
  }

  // Current month days
  const todayStr = getLocalDateStr();
  for (let d = 1; d <= totalDays; d++) {
    const dStr = `${S.calYear}-${String(S.calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    const dayCheckins = checkinMap.get(dStr) || [];
    const hasChecked = dayCheckins.length > 0;
    if (hasChecked) cell.classList.add('checked');
    if (dStr === todayStr) cell.classList.add('today');

    const totalDur = dayCheckins.reduce((sum, c) => sum + (Number(c.duration) || 0), 0);
    let innerHtml = `<span class="day-number">${d}</span>`;
    if (hasChecked) {
      innerHtml += `<span class="day-check-badge">🎵</span>`;
      if (totalDur > 0) {
        innerHtml += `<span class="day-dur-tag">${totalDur}m</span>`;
      }
    }
    cell.innerHTML = innerHtml;
    cell.addEventListener('click', () => {
      document.querySelectorAll('.cal-day-cell.selected').forEach(el => el.classList.remove('selected'));
      cell.classList.add('selected');
      showCalendarDayDetail(dStr, dayCheckins);
    });
    grid.appendChild(cell);
  }

  // Next month leading days
  const filled = firstDayIdx + totalDays;
  const remaining = (7 - (filled % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell other-month';
    cell.innerHTML = `<span class="day-number">${i}</span>`;
    grid.appendChild(cell);
  }
}

function showCalendarDayDetail(dateStr, checkinList) {
  const detailEl = $('calendarDayDetail');
  if (!detailEl) return;
  detailEl.style.display = 'block';

  if ($('dayDetailTitle')) {
    $('dayDetailTitle').textContent = `📅 ${dateStr} 练琴明细 (${checkinList ? checkinList.length : 0}次)`;
  }

  const contentEl = $('dayDetailContent');
  if (!contentEl) return;

  if (!checkinList || !checkinList.length) {
    contentEl.innerHTML = `<div style="padding:12px;text-align:center;color:var(--txt3);font-size:12.5px">该日暂无打卡记录</div>`;
    return;
  }

  let html = '<div class="day-detail-items">';
  checkinList.forEach(c => {
    html += `
      <div class="day-detail-row" style="background:var(--bg-glass);border:1px solid var(--border-subtle);border-radius:8px;padding:8px 12px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;font-size:13px;color:var(--txt1)">🎼 ${esc(c.scoreTitle || '自选练琴')}</span>
          <span style="font-size:12px;color:var(--primary);font-weight:600">⏱️ ${c.duration} 分钟</span>
        </div>
        <div style="display:flex;gap:8px;font-size:11.5px;color:var(--txt2);align-items:center;flex-wrap:wrap">
          <span>${esc(c.mood || '😊 渐入佳境')}</span>
          ${c.notes ? `<span style="color:var(--txt3)">· ${esc(c.notes)}</span>` : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';
  contentEl.innerHTML = html;
}

function renderPracticeHistory() {
  const listEl = $('practiceHistoryList');
  if (!listEl) return;
  if (!S.checkins || !S.checkins.length) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding:40px 16px;text-align:center">
        <div style="font-size:40px;margin-bottom:8px">📜</div>
        <p style="color:var(--txt2);font-size:13.5px">暂无打卡记录</p>
        <span style="color:var(--txt3);font-size:12px">完成每日练琴后打卡，所有轨迹都将记录在这里</span>
      </div>
    `;
    return;
  }

  const sorted = [...S.checkins].sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
  let html = '';
  sorted.forEach(item => {
    const timeStr = item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    html += `
      <div class="practice-history-card" data-id="${item.id}">
        <div class="history-card-header">
          <div class="history-date-box">
            <span class="history-date-main">${item.date}</span>
            ${timeStr ? `<span class="history-date-time">${timeStr}</span>` : ''}
          </div>
          <div class="history-header-actions">
            <span class="history-dur-badge">⏱️ ${item.duration}分钟</span>
            <button class="icon-btn sm delete-history-btn" data-id="${item.id}" title="删除此打卡记录">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        <div class="history-card-body">
          <div class="history-score-title">🎼 ${esc(item.scoreTitle || '练琴曲目')}</div>
          <div class="history-mood-tag">${esc(item.mood || '😊 渐入佳境')}</div>
          ${item.notes ? `<div class="history-notes-box">💭 ${esc(item.notes)}</div>` : ''}
        </div>
      </div>
    `;
  });
  listEl.innerHTML = html;

  listEl.querySelectorAll('.delete-history-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (confirm('确定删除该条练琴打卡记录？')) {
        await deleteCheckin(id);
      }
    });
  });
}

async function deleteCheckin(id) {
  await dbDel('checkins', id);
  S.checkins = S.checkins.filter(c => c.id !== id);
  updatePracticeBadges();
  renderPracticeCalendar();
  renderPracticeHistory();
  toast('已删除打卡记录');
}

async function submitPracticeCheckin() {
  let dur = S.selectedDuration;
  if ($('customDurationWrap') && $('customDurationWrap').style.display !== 'none') {
    const val = parseInt($('customDurationInput').value, 10);
    if (!val || val <= 0 || val > 600) {
      toast('请输入有效的练琴时长（1~600分钟）', 'error');
      return;
    }
    dur = val;
  }

  const scoreSel = $('practiceScoreSelect');
  let scoreId = '';
  let scoreTitle = '日常练琴 / 基础音阶';

  if (scoreSel && scoreSel.value === '__custom__') {
    scoreTitle = $('practiceCustomScore')?.value.trim() || '自选练习曲目';
  } else if (scoreSel && scoreSel.value) {
    scoreId = scoreSel.value;
    const matched = S.scores.find(s => s.id === scoreId);
    scoreTitle = matched ? matched.title : '选定曲目';
  }

  const notes = $('practiceNotes')?.value.trim() || '';
  const todayStr = getLocalDateStr();

  const item = {
    id: uid(),
    date: todayStr,
    duration: dur,
    scoreId: scoreId,
    scoreTitle: scoreTitle,
    mood: S.selectedMood || '😊 渐入佳境',
    notes: notes,
    createdAt: Date.now()
  };

  await dbPut('checkins', item);
  S.checkins.push(item);

  playReminderChime();
  const { streak } = calculatePracticeStats();
  toast(`🎉 练琴打卡成功！已连续打卡 ${streak} 天`, 'success');

  if ($('practiceNotes')) $('practiceNotes').value = '';

  const todayCheckins = S.checkins.filter(c => c.date === todayStr);
  const banner = $('practiceTodayBanner');
  if (banner) {
    banner.classList.add('is-done');
    const totalDur = todayCheckins.reduce((s, c) => s + (Number(c.duration) || 0), 0);
    const titles = todayCheckins.map(c => c.scoreTitle).filter(Boolean).join('、');
    if ($('todayBannerTitle')) $('todayBannerTitle').textContent = `🎉 今日已打卡 (${totalDur}分钟)`;
    if ($('todayBannerDesc')) $('todayBannerDesc').textContent = titles ? `已练习：${titles}。继续保持绝佳状态！` : '今日已完成练琴任务，手感渐入佳境！';
    if ($('practiceSubmitBtn')) $('practiceSubmitBtn').innerHTML = '<span>➕ 追加今日练习记录</span>';
  }

  updatePracticeBadges();
}

// ─────────────────────────────────────────
// Practice Reminder System
// ─────────────────────────────────────────

function updateReminderUIStatus() {
  if ($('settingReminderToggle')) $('settingReminderToggle').checked = S.reminderEnabled;
  if ($('settingReminderTime')) $('settingReminderTime').value = S.reminderTime || '20:00';
  if ($('settingReminderText')) $('settingReminderText').value = S.reminderText || '🎹 该练琴啦！保持指尖记忆，今天也要坚持弹奏哦～';
  if ($('reminderConfigFields')) $('reminderConfigFields').style.display = S.reminderEnabled ? 'block' : 'none';

  if ($('modalReminderStateText')) {
    $('modalReminderStateText').textContent = S.reminderEnabled ? `每日 ${S.reminderTime}` : '未开启';
  }

  if ($('notifyPermHint')) {
    if (!('Notification' in window)) {
      $('notifyPermHint').textContent = 'ℹ️ 当前浏览器环境仅支持应用内提醒与琴声';
    } else if (Notification.permission === 'granted') {
      $('notifyPermHint').textContent = '✅ 系统通知权限已开启';
    } else if (Notification.permission === 'denied') {
      $('notifyPermHint').textContent = '⚠️ 系统通知已被禁止，仍可通过应用内和弦弹窗提醒';
    } else {
      $('notifyPermHint').textContent = 'ℹ️ 点击按钮授权系统通知，防漏打卡';
    }
  }
}

async function requestNotificationPermission(showFeedback = true) {
  if (!('Notification' in window)) {
    if (showFeedback) toast('当前环境不支持 Web Notification，将使用应用内弹窗与琴声', 'info');
    updateReminderUIStatus();
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      if (showFeedback) toast('系统通知权限已开启！', 'success');
    } else if (perm === 'denied') {
      if (showFeedback) toast('系统通知被拒绝，仍可通过应用内提醒接收通知', 'info');
    }
  } catch(e) {
    console.warn(e);
  }
  updateReminderUIStatus();
}

function playReminderChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const notes = [523.25, 659.25, 783.99, 1046.50];
    const now = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.001, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.25, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 1.3);
    });
  } catch(e) {
    console.warn('Audio chime failed:', e);
  }
}

function checkPracticeReminder() {
  if (!S.reminderEnabled) return;
  if (S.snoozeUntil && Date.now() < S.snoozeUntil) return;

  const now = new Date();
  const todayStr = getLocalDateStr(now);
  if (S.lastRemindedDate === todayStr) return;

  const curTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (curTimeStr >= (S.reminderTime || '20:00')) {
    triggerPracticeReminder(false);
  }
}

function triggerPracticeReminder(isTest = false) {
  if (!isTest) {
    S.lastRemindedDate = getLocalDateStr();
    saveSetting('lastRemindedDate', S.lastRemindedDate);
  }

  playReminderChime();

  const msg = S.reminderText || '🎹 该练琴啦！保持指尖记忆，今天也要坚持弹奏哦～';

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('🎹 练琴提醒', {
        body: msg,
        icon: 'icons/icon-192.png'
      });
    } catch(e) {}
  }

  if ($('reminderNoticeMsg')) $('reminderNoticeMsg').textContent = msg;
  if ($('reminderNoticeBackdrop')) $('reminderNoticeBackdrop').classList.add('open');
}

function closeReminderNotice() {
  if ($('reminderNoticeBackdrop')) $('reminderNoticeBackdrop').classList.remove('open');
}

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
    for(const k of S.checkins) await dbDel('checkins',k.id);
    S.scores=[]; S.categories=[]; S.checkins=[];
    await removeBgImage();
    closeSettings(); renderAll();
    toast('已清空所有数据');
  });

  // Folder Modal & Appending
  $('folderModalClose')?.addEventListener('click', closeFolderModal);
  $('folderCloseBtn')?.addEventListener('click', closeFolderModal);
  $('folderModalBackdrop')?.addEventListener('click', e => {
    if(e.target === $('folderModalBackdrop')) closeFolderModal();
  });
  $('folderAppendBtn')?.addEventListener('click', () => {
    S.pendingAppendScoreId = S.folderModalScoreId;
    const inp = $('folderAppendInput');
    if(inp){
      inp.value = '';
      inp.click();
    }
  });
  $('folderAppendInput')?.addEventListener('change', async e => {
    const targetId = S.folderModalScoreId || S.pendingAppendScoreId;
    if(e.target.files && e.target.files.length && targetId){
      await appendPagesToScore(targetId, e.target.files);
    }
    S.pendingAppendScoreId = null;
    e.target.value = '';
  });
  $('folderPlayBtn')?.addEventListener('click', () => {
    if(S.folderModalScoreId){
      const scoreId = S.folderModalScoreId;
      closeFolderModal();
      const scoreIdx = S.scores.findIndex(x => x.id === scoreId);
      if(scoreIdx !== -1) openViewer(scoreIdx, S.scores, 0);
    }
  });

  // Viewer Thumbs Drawer
  $('viewerThumbsBtn')?.addEventListener('click', toggleViewerThumbsDrawer);
  $('closeThumbsDrawerBtn')?.addEventListener('click', () => {
    const drawer = $('viewerThumbsDrawer');
    if(drawer) drawer.style.display = 'none';
  });
  $('pagePillText')?.addEventListener('click', toggleViewerThumbsDrawer);

  // Upload Mode Switcher
  $('uploadModeNew')?.addEventListener('click', () => setUploadMode('new'));
  $('uploadModeAppend')?.addEventListener('click', () => setUploadMode('append'));

  // Backdrop clicks
  $('uploadModalBackdrop').addEventListener('click',e=>{ if(e.target===$('uploadModalBackdrop')) closeUploadModal(); });
  $('categoryModalBackdrop').addEventListener('click',e=>{ if(e.target===$('categoryModalBackdrop')) closeCatModal(); });
  $('editModalBackdrop').addEventListener('click',e=>{ if(e.target===$('editModalBackdrop')) closeEditModal(); });
  $('viewerBackdrop').addEventListener('click',e=>{
    if(e.target===$('viewerBackdrop')) closeViewer();
  });

  // Practice Check-in & Daily Reminder
  $('navPractice')?.addEventListener('click', () => openPracticeModal());
  $('topbarPracticeBtn')?.addEventListener('click', () => openPracticeModal());
  $('practiceModalClose')?.addEventListener('click', closePracticeModal);
  $('practiceCloseBtn')?.addEventListener('click', closePracticeModal);
  $('practiceModalBackdrop')?.addEventListener('click', e => {
    if (e.target === $('practiceModalBackdrop')) closePracticeModal();
  });

  // Practice Tabs
  $('practiceTabCheckin')?.addEventListener('click', () => setPracticeTab('checkin'));
  $('practiceTabCalendar')?.addEventListener('click', () => setPracticeTab('calendar'));
  $('practiceTabHistory')?.addEventListener('click', () => setPracticeTab('history'));

  // Duration Pills
  $('durationPillGroup')?.addEventListener('click', e => {
    const btn = e.target.closest('.duration-pill-btn');
    if (!btn) return;
    document.querySelectorAll('.duration-pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const minVal = btn.dataset.min;
    if (minVal === 'custom') {
      if ($('customDurationWrap')) $('customDurationWrap').style.display = 'block';
      $('customDurationInput')?.focus();
    } else {
      if ($('customDurationWrap')) $('customDurationWrap').style.display = 'none';
      S.selectedDuration = parseInt(minVal, 10);
    }
  });

  // Mood Pills
  $('moodPillGroup')?.addEventListener('click', e => {
    const btn = e.target.closest('.mood-pill-btn');
    if (!btn) return;
    document.querySelectorAll('.mood-pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.selectedMood = btn.dataset.mood;
  });

  // Score select change
  $('practiceScoreSelect')?.addEventListener('change', e => {
    const isCustom = e.target.value === '__custom__';
    if ($('practiceCustomScore')) {
      $('practiceCustomScore').style.display = isCustom ? 'block' : 'none';
      if (isCustom) $('practiceCustomScore').focus();
    }
  });

  // Submit check-in
  $('practiceSubmitBtn')?.addEventListener('click', submitPracticeCheckin);

  // Calendar Controls
  $('calPrevMonthBtn')?.addEventListener('click', () => {
    S.calMonth--;
    if (S.calMonth < 0) {
      S.calMonth = 11;
      S.calYear--;
    }
    renderPracticeCalendar();
  });
  $('calNextMonthBtn')?.addEventListener('click', () => {
    S.calMonth++;
    if (S.calMonth > 11) {
      S.calMonth = 0;
      S.calYear++;
    }
    renderPracticeCalendar();
  });
  $('closeDayDetailBtn')?.addEventListener('click', () => {
    if ($('calendarDayDetail')) $('calendarDayDetail').style.display = 'none';
  });

  // Settings reminder link in practice modal
  $('modalOpenReminderBtn')?.addEventListener('click', () => {
    closePracticeModal();
    openSettings();
    $('settingReminderToggle')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Reminder Notice Popup Buttons
  $('reminderGoPracticeBtn')?.addEventListener('click', () => {
    closeReminderNotice();
    if (S.scores.length > 0) openViewer(0, S.scores, 0);
  });
  $('reminderCheckinNowBtn')?.addEventListener('click', () => {
    closeReminderNotice();
    openPracticeModal();
  });
  $('reminderDismissBtn')?.addEventListener('click', () => {
    closeReminderNotice();
    S.snoozeUntil = Date.now() + 15 * 60 * 1000;
    toast('已延后 15 分钟提醒');
  });
  $('reminderNoticeBackdrop')?.addEventListener('click', e => {
    if (e.target === $('reminderNoticeBackdrop')) closeReminderNotice();
  });

  // Reminder Settings Panel Controls
  $('settingReminderToggle')?.addEventListener('change', async e => {
    S.reminderEnabled = e.target.checked;
    await saveSetting('reminderEnabled', S.reminderEnabled);
    if ($('reminderConfigFields')) $('reminderConfigFields').style.display = S.reminderEnabled ? 'block' : 'none';
    updateReminderUIStatus();
    if (S.reminderEnabled) {
      toast('已开启每日练琴提醒 (' + S.reminderTime + ')', 'success');
      requestNotificationPermission(false);
    } else {
      toast('已关闭练琴提醒');
    }
  });
  $('settingReminderTime')?.addEventListener('change', async e => {
    S.reminderTime = e.target.value || '20:00';
    await saveSetting('reminderTime', S.reminderTime);
    updateReminderUIStatus();
    toast('提醒时间已更新为 ' + S.reminderTime);
  });
  $('settingReminderText')?.addEventListener('input', async e => {
    S.reminderText = e.target.value.trim() || '🎹 该练琴啦！保持指尖记忆，今天也要坚持弹奏哦～';
    await saveSetting('reminderText', S.reminderText);
  });
  $('settingTestReminderBtn')?.addEventListener('click', () => {
    triggerPracticeReminder(true);
  });
  $('settingNotifyPermBtn')?.addEventListener('click', () => {
    requestNotificationPermission(true);
  });

  // Viewer checkin button
  $('viewerCheckinBtn')?.addEventListener('click', () => {
    const curScore = S.viewerList[S.viewerIdx];
    openPracticeModal(curScore ? curScore.id : null);
  });

}

// ─────────────────────────────────────────
// Boot
// ─────────────────────────────────────────

function makeScoreSvg(title, composer, pageNum, totalPages){
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1100" width="800" height="1100">
    <rect width="800" height="1100" fill="#fdfcf7"/>
    <text x="400" y="72" font-family="'Noto Serif SC', serif, Georgia" font-size="28" font-weight="bold" text-anchor="middle" fill="#1e293b">${esc(title)}</text>
    <text x="720" y="105" font-family="sans-serif" font-size="14" text-anchor="end" fill="#64748b">${esc(composer)}</text>
    <text x="400" y="1050" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#94a3b8">- ${pageNum} / ${totalPages} -</text>
    <g stroke="#334155" stroke-width="1.2">
      ${[160, 330, 500, 670, 840].map(y => `
        <line x1="60" y1="${y}" x2="740" y2="${y}"/>
        <line x1="60" y1="${y+12}" x2="740" y2="${y+12}"/>
        <line x1="60" y1="${y+24}" x2="740" y2="${y+24}"/>
        <line x1="60" y1="${y+36}" x2="740" y2="${y+36}"/>
        <line x1="60" y1="${y+48}" x2="740" y2="${y+48}"/>
        <line x1="60" y1="${y}" x2="60" y2="${y+48}" stroke-width="2.5"/>
        <line x1="740" y1="${y}" x2="740" y2="${y+48}" stroke-width="2.5"/>
      `).join('')}
    </g>
    <g fill="#1e293b">
      ${[160, 330, 500, 670, 840].map(y => `
        <text x="75" y="${y+40}" font-family="serif" font-size="44">𝄞</text>
        <circle cx="160" cy="${y+24}" r="5.5"/><line x1="165" y1="${y+24}" x2="165" y2="${y-6}" stroke="#1e293b" stroke-width="2"/>
        <circle cx="250" cy="${y+30}" r="5.5"/><line x1="255" y1="${y+30}" x2="255" y2="${y}" stroke="#1e293b" stroke-width="2"/>
        <circle cx="340" cy="${y+18}" r="5.5"/><line x1="345" y1="${y+18}" x2="345" y2="${y-12}" stroke="#1e293b" stroke-width="2"/>
        <circle cx="430" cy="${y+36}" r="5.5"/><line x1="435" y1="${y+36}" x2="435" y2="${y+6}" stroke="#1e293b" stroke-width="2"/>
        <circle cx="520" cy="${y+24}" r="5.5"/><line x1="525" y1="${y+24}" x2="525" y2="${y-6}" stroke="#1e293b" stroke-width="2"/>
        <circle cx="610" cy="${y+12}" r="5.5"/><line x1="615" y1="${y+12}" x2="615" y2="${y-18}" stroke="#1e293b" stroke-width="2"/>
        <circle cx="690" cy="${y+24}" r="5.5"/><line x1="695" y1="${y+24}" x2="695" y2="${y-6}" stroke="#1e293b" stroke-width="2"/>
      `).join('')}
    </g>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

async function seedInitialDemoData(){
  const catId = uid();
  const demoCat = { id: catId, name: '古典钢琴', color: '#a78bfa', emoji: '🎹', createdAt: Date.now() };
  await dbPut('categories', demoCat);
  S.categories.push(demoCat);

  const p1 = makeScoreSvg('月光奏鸣曲 第三乐章', '贝多芬 (L. v. Beethoven)', 1, 3);
  const p2 = makeScoreSvg('月光奏鸣曲 第三乐章 (发展部)', '贝多芬 (L. v. Beethoven)', 2, 3);
  const p3 = makeScoreSvg('月光奏鸣曲 第三乐章 (尾声)', '贝多芬 (L. v. Beethoven)', 3, 3);

  const folderScore = {
    id: uid(),
    title: '月光奏鸣曲 第三乐章',
    categoryId: catId,
    composer: '贝多芬',
    tags: ['钢琴', '古典', '奏鸣曲'],
    notes: 'Presto agitato 激动的急板，经典多页折叠乐谱夹',
    difficulty: 4,
    dataURL: p1,
    pages: [p1, p2, p3],
    annotations: {},
    filterMode: 'normal',
    fileSize: 45000,
    fileType: 'image/svg+xml',
    favorite: true,
    createdAt: Date.now() - 3600000
  };
  await dbPut('scores', folderScore);
  S.scores.push(folderScore);

  const singlePage = makeScoreSvg('降E大调夜曲 Op.9 No.2', '肖邦 (F. Chopin)', 1, 1);
  const singleScore = {
    id: uid(),
    title: '降E大调夜曲 Op.9 No.2',
    categoryId: catId,
    composer: '肖邦',
    tags: ['钢琴', '夜曲', '浪漫'],
    notes: 'Andante 行板，单页乐谱示例',
    difficulty: 3,
    dataURL: singlePage,
    pages: [singlePage],
    annotations: {},
    filterMode: 'normal',
    fileSize: 18000,
    fileType: 'image/svg+xml',
    favorite: false,
    createdAt: Date.now() - 7200000
  };
  await dbPut('scores', singleScore);
  S.scores.push(singleScore);
}

async function boot(){
  try{
    await initDB();
    await loadSettings();
    const [scores,cats,checkins]=await Promise.all([
      dbAll('scores'),
      dbAll('categories'),
      dbAll('checkins').catch(()=>[])
    ]);
    S.scores=scores; S.categories=cats; S.checkins=checkins || [];
    if(!scores.length && !cats.length){
      await seedInitialDemoData();
    }
    applyTheme(S.theme);
    applyBackground();
    bindEvents();
    updateReminderUIStatus();
    renderAll();
    // Daily reminder periodic checker
    setInterval(checkPracticeReminder, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkPracticeReminder();
    });
    setTimeout(checkPracticeReminder, 2000);
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  } catch(err){ console.error(err); toast('初始化失败，请刷新重试','error'); }
}

document.addEventListener('DOMContentLoaded', boot);
