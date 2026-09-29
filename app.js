/* =============================================
   乐谱库 App - MusicScore PWA
   IndexedDB 存储 + 分类管理 + 图片查看
   ============================================= */

'use strict';

// ───────────────────────────────────────────
// 1. IndexedDB 封装
// ───────────────────────────────────────────
const DB_NAME = 'MusicScoreDB';
const DB_VERSION = 1;
let db = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('scores')) {
        const store = d.createObjectStore('scores', { keyPath: 'id' });
        store.createIndex('categoryId', 'categoryId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!d.objectStoreNames.contains('categories')) {
        d.createObjectStore('categories', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(storeName, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ───────────────────────────────────────────
// 2. 应用状态
// ───────────────────────────────────────────
const state = {
  scores: [],       // All score objects
  categories: [],   // All category objects
  filter: 'all',    // 'all' | 'favorites' | category id
  search: '',
  sort: 'date-desc',
  viewMode: 'grid', // 'grid' | 'list'
  viewerIndex: -1,  // current index in filtered list
  selectedColor: '#a78bfa',
  editingCategoryId: null,
  editingScoreId: null,
  pendingFiles: [],  // files staged for upload
};

// ───────────────────────────────────────────
// 3. DOM refs
// ───────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const DOM = {
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebarToggle'),
  mobileMenuBtn: $('mobileMenuBtn'),
  globalSearch: $('globalSearch'),
  navAll: $('navAll'),
  navFavorites: $('navFavorites'),
  badgeAll: $('badgeAll'),
  badgeFav: $('badgeFav'),
  categoryList: $('categoryList'),
  addCategoryBtn: $('addCategoryBtn'),
  storageSize: $('storageSize'),
  storageFill: $('storageFill'),
  pageTitle: $('pageTitle'),
  pageSubtitle: $('pageSubtitle'),
  viewGrid: $('viewGrid'),
  viewList: $('viewList'),
  sortSelect: $('sortSelect'),
  uploadBtn: $('uploadBtn'),
  scoreGrid: $('scoreGrid'),
  emptyState: $('emptyState'),
  emptyTitle: $('emptyTitle'),
  emptyDesc: $('emptyDesc'),
  emptyUploadBtn: $('emptyUploadBtn'),
  dropOverlay: $('dropOverlay'),

  // Upload modal
  uploadModalBackdrop: $('uploadModalBackdrop'),
  uploadModalClose: $('uploadModalClose'),
  uploadZone: $('uploadZone'),
  fileInput: $('fileInput'),
  browseBtn: $('browseBtn'),
  uploadPreviewList: $('uploadPreviewList'),
  uploadForm: $('uploadForm'),
  uploadTitle: $('uploadTitle'),
  uploadCategory: $('uploadCategory'),
  uploadTags: $('uploadTags'),
  uploadNotes: $('uploadNotes'),
  uploadModalFooter: $('uploadModalFooter'),
  uploadCancel: $('uploadCancel'),
  uploadConfirm: $('uploadConfirm'),

  // Category modal
  categoryModalBackdrop: $('categoryModalBackdrop'),
  categoryModalTitle: $('categoryModalTitle'),
  categoryModalClose: $('categoryModalClose'),
  categoryName: $('categoryName'),
  colorPicker: $('colorPicker'),
  categoryCancel: $('categoryCancel'),
  categoryConfirm: $('categoryConfirm'),

  // Viewer
  viewerBackdrop: $('viewerBackdrop'),
  viewerTitle: $('viewerTitle'),
  viewerCategory: $('viewerCategory'),
  viewerFav: $('viewerFav'),
  viewerEdit: $('viewerEdit'),
  viewerDownload: $('viewerDownload'),
  viewerDelete: $('viewerDelete'),
  viewerClose: $('viewerClose'),
  viewerPrev: $('viewerPrev'),
  viewerNext: $('viewerNext'),
  viewerImg: $('viewerImg'),
  viewerTags: $('viewerTags'),
  viewerDate: $('viewerDate'),

  // Edit modal
  editModalBackdrop: $('editModalBackdrop'),
  editModalClose: $('editModalClose'),
  editTitle: $('editTitle'),
  editCategory: $('editCategory'),
  editTags: $('editTags'),
  editNotes: $('editNotes'),
  editCancel: $('editCancel'),
  editConfirm: $('editConfirm'),

  toastContainer: $('toastContainer'),
};

// ───────────────────────────────────────────
// 4. Helpers
// ───────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  DOM.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

function fileToDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

// ───────────────────────────────────────────
// 5. Sidebar
// ───────────────────────────────────────────
function toggleSidebar() {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    DOM.sidebar.classList.toggle('mobile-open');
    getOrCreateOverlay().classList.toggle('active', DOM.sidebar.classList.contains('mobile-open'));
  } else {
    DOM.sidebar.classList.toggle('collapsed');
    document.querySelector('.main').classList.toggle('sidebar-collapsed', DOM.sidebar.classList.contains('collapsed'));
  }
}

function getOrCreateOverlay() {
  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', closeMobileSidebar);
    document.body.appendChild(overlay);
  }
  return overlay;
}

function closeMobileSidebar() {
  DOM.sidebar.classList.remove('mobile-open');
  const overlay = document.querySelector('.sidebar-overlay');
  if (overlay) overlay.classList.remove('active');
}

// ───────────────────────────────────────────
// 6. Categories
// ───────────────────────────────────────────
function renderCategories() {
  DOM.categoryList.innerHTML = '';
  state.categories.forEach((cat) => {
    const count = state.scores.filter(s => s.categoryId === cat.id).length;
    const div = document.createElement('div');
    div.className = 'category-item';

    const btn = document.createElement('button');
    btn.className = 'nav-item' + (state.filter === cat.id ? ' active' : '');
    btn.dataset.filter = cat.id;
    btn.innerHTML = `
      <span class="category-dot" style="background:${cat.color}"></span>
      <span>${escapeHtml(cat.name)}</span>
      <span class="badge">${count}</span>
    `;
    btn.addEventListener('click', () => setFilter(cat.id));

    const actions = document.createElement('div');
    actions.className = 'category-item-actions';
    actions.innerHTML = `
      <button class="category-action-btn" title="重命名" data-id="${cat.id}" data-action="rename">✏️</button>
      <button class="category-action-btn del" title="删除" data-id="${cat.id}" data-action="delete">🗑</button>
    `;
    actions.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.dataset.action === 'rename') openCategoryModal(cat.id);
        else deleteCategory(cat.id);
      });
    });

    div.appendChild(btn);
    div.appendChild(actions);
    DOM.categoryList.appendChild(div);
  });
}

function openCategoryModal(editId = null) {
  state.editingCategoryId = editId;
  if (editId) {
    const cat = state.categories.find(c => c.id === editId);
    DOM.categoryModalTitle.textContent = '编辑分类';
    DOM.categoryName.value = cat.name;
    state.selectedColor = cat.color;
    DOM.categoryConfirm.textContent = '保存';
  } else {
    DOM.categoryModalTitle.textContent = '新建分类';
    DOM.categoryName.value = '';
    state.selectedColor = '#a78bfa';
    DOM.categoryConfirm.textContent = '创建';
  }
  // Update color picker active state
  DOM.colorPicker.querySelectorAll('.color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color === state.selectedColor);
  });
  DOM.categoryModalBackdrop.classList.add('open');
  setTimeout(() => DOM.categoryName.focus(), 100);
}

function closeCategoryModal() {
  DOM.categoryModalBackdrop.classList.remove('open');
}

async function saveCategory() {
  const name = DOM.categoryName.value.trim();
  if (!name) { toast('请输入分类名称', 'error'); return; }

  if (state.editingCategoryId) {
    const cat = state.categories.find(c => c.id === state.editingCategoryId);
    cat.name = name;
    cat.color = state.selectedColor;
    await dbPut('categories', cat);
    toast('分类已更新', 'success');
  } else {
    const cat = { id: uid(), name, color: state.selectedColor, createdAt: Date.now() };
    state.categories.push(cat);
    await dbPut('categories', cat);
    toast('分类已创建', 'success');
  }
  closeCategoryModal();
  renderAll();
}

async function deleteCategory(id) {
  if (!confirm('删除此分类？分类内的乐谱将变为"未分类"。')) return;
  // Remove category from scores
  const affected = state.scores.filter(s => s.categoryId === id);
  for (const s of affected) {
    s.categoryId = '';
    await dbPut('scores', s);
  }
  await dbDelete('categories', id);
  state.categories = state.categories.filter(c => c.id !== id);
  if (state.filter === id) setFilter('all');
  else renderAll();
  toast('分类已删除');
}

// ───────────────────────────────────────────
// 7. Filter & Sort
// ───────────────────────────────────────────
function setFilter(filter) {
  state.filter = filter;
  DOM.navAll.classList.toggle('active', filter === 'all');
  DOM.navFavorites.classList.toggle('active', filter === 'favorites');
  renderAll();
  if (window.innerWidth <= 768) closeMobileSidebar();
}

function getFilteredScores() {
  let list = [...state.scores];

  // Filter
  if (state.filter === 'favorites') {
    list = list.filter(s => s.favorite);
  } else if (state.filter !== 'all') {
    list = list.filter(s => s.categoryId === state.filter);
  }

  // Search
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (s.notes || '').toLowerCase().includes(q)
    );
  }

  // Sort
  list.sort((a, b) => {
    switch (state.sort) {
      case 'date-desc': return b.createdAt - a.createdAt;
      case 'date-asc':  return a.createdAt - b.createdAt;
      case 'name-asc':  return a.title.localeCompare(b.title, 'zh');
      case 'name-desc': return b.title.localeCompare(a.title, 'zh');
      default: return 0;
    }
  });

  return list;
}

// ───────────────────────────────────────────
// 8. Render
// ───────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderAll() {
  updateBadges();
  renderCategories();
  updateCategorySelects();
  renderPageTitle();
  renderScores();
  updateStorageInfo();
}

function updateBadges() {
  DOM.badgeAll.textContent = state.scores.length;
  DOM.badgeFav.textContent = state.scores.filter(s => s.favorite).length;
}

function renderPageTitle() {
  if (state.filter === 'all') {
    DOM.pageTitle.textContent = '全部乐谱';
    DOM.pageSubtitle.textContent = '管理您的所有乐谱与图片';
  } else if (state.filter === 'favorites') {
    DOM.pageTitle.textContent = '收藏';
    DOM.pageSubtitle.textContent = '您收藏的乐谱';
  } else {
    const cat = state.categories.find(c => c.id === state.filter);
    DOM.pageTitle.textContent = cat ? cat.name : '分类';
    DOM.pageSubtitle.textContent = `该分类下的乐谱`;
  }
}

function updateCategorySelects() {
  const opts = `<option value="">— 不分类 —</option>` +
    state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  DOM.uploadCategory.innerHTML = opts;
  DOM.editCategory.innerHTML = opts;
}

function renderScores() {
  const list = getFilteredScores();
  DOM.scoreGrid.innerHTML = '';

  if (list.length === 0) {
    DOM.scoreGrid.style.display = 'none';
    DOM.emptyState.style.display = 'flex';
    if (state.search) {
      DOM.emptyTitle.textContent = '没有找到相关乐谱';
      DOM.emptyDesc.textContent = `没有与"${state.search}"匹配的结果，请尝试其他关键词。`;
      DOM.emptyUploadBtn.style.display = 'none';
    } else if (state.filter === 'favorites') {
      DOM.emptyTitle.textContent = '还没有收藏';
      DOM.emptyDesc.textContent = '浏览乐谱时点击爱心图标即可收藏。';
      DOM.emptyUploadBtn.style.display = 'none';
    } else {
      DOM.emptyTitle.textContent = '还没有乐谱';
      DOM.emptyDesc.textContent = '点击右上角「上传图片」按钮，开始添加您的第一张乐谱吧！';
      DOM.emptyUploadBtn.style.display = 'flex';
    }
    return;
  }

  DOM.scoreGrid.style.display = '';
  DOM.emptyState.style.display = 'none';
  DOM.scoreGrid.className = 'score-grid' + (state.viewMode === 'list' ? ' list-view' : '');

  list.forEach((score, idx) => {
    const cat = state.categories.find(c => c.id === score.categoryId);
    const card = document.createElement('div');
    card.className = 'score-card';
    card.dataset.id = score.id;

    const tagsHtml = (score.tags || []).slice(0, 3)
      .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

    const favSvgFill = score.favorite ? `fill="${'var(--gold)'}` : 'fill="none"';
    const favStroke = score.favorite ? 'var(--gold)' : 'currentColor';

    if (state.viewMode === 'grid') {
      card.innerHTML = `
        <div class="score-card-thumb">
          <img src="${score.dataURL}" alt="${escapeHtml(score.title)}" loading="lazy" />
          <div class="score-card-overlay">
            <button class="card-quick-btn fav-btn${score.favorite ? ' fav-active' : ''}" title="收藏" data-id="${score.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${score.favorite ? 'var(--gold)' : 'none'}">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="${favStroke}" stroke-width="2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="score-card-body">
          ${cat ? `<div class="score-card-category" style="color:${cat.color}">${escapeHtml(cat.name)}</div>` : ''}
          <div class="score-card-title">${escapeHtml(score.title)}</div>
          <div class="score-card-tags">${tagsHtml}</div>
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="score-card-thumb">
          <img src="${score.dataURL}" alt="${escapeHtml(score.title)}" loading="lazy" />
        </div>
        <div class="score-card-body">
          <div class="score-card-meta">
            ${cat ? `<div class="score-card-category" style="color:${cat.color}">${escapeHtml(cat.name)}</div>` : ''}
            <div class="score-card-title">${escapeHtml(score.title)}</div>
            <div class="score-card-tags">${tagsHtml}</div>
          </div>
          <span class="score-card-date">${formatDate(score.createdAt)}</span>
        </div>
      `;
    }

    // Fav button
    const favBtn = card.querySelector('.fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(score.id);
      });
    }

    // Open viewer
    card.addEventListener('click', () => openViewer(idx, list));

    DOM.scoreGrid.appendChild(card);
  });
}

// ───────────────────────────────────────────
// 9. Upload
// ───────────────────────────────────────────
function openUploadModal() {
  state.pendingFiles = [];
  DOM.uploadPreviewList.innerHTML = '';
  DOM.uploadForm.style.display = 'none';
  DOM.uploadModalFooter.style.display = 'none';
  DOM.uploadTitle.value = '';
  DOM.uploadTags.value = '';
  DOM.uploadNotes.value = '';
  DOM.uploadCategory.value = '';
  DOM.uploadModalBackdrop.classList.add('open');
}

function closeUploadModal() {
  DOM.uploadModalBackdrop.classList.remove('open');
  state.pendingFiles = [];
}

async function handleFiles(files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!imageFiles.length) { toast('请选择图片文件', 'error'); return; }

  for (const file of imageFiles) {
    if (state.pendingFiles.find(f => f.name === file.name && f.size === file.size)) continue;
    state.pendingFiles.push(file);
  }

  renderUploadPreviews();
  DOM.uploadForm.style.display = 'block';
  DOM.uploadModalFooter.style.display = 'flex';

  // Auto-fill title from first file name
  if (state.pendingFiles.length === 1) {
    const name = state.pendingFiles[0].name.replace(/\.[^.]+$/, '');
    DOM.uploadTitle.value = name;
  }
}

async function renderUploadPreviews() {
  DOM.uploadPreviewList.innerHTML = '';
  for (const file of state.pendingFiles) {
    const url = URL.createObjectURL(file);
    const item = document.createElement('div');
    item.className = 'upload-preview-item';
    item.innerHTML = `
      <div class="upload-preview-thumb"><img src="${url}" alt="" /></div>
      <span class="upload-preview-name">${escapeHtml(file.name)}</span>
      <span class="upload-preview-size" style="font-size:11px;color:var(--text-4);flex-shrink:0;">${formatSize(file.size)}</span>
      <button class="upload-preview-remove" title="移除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    item.querySelector('.upload-preview-remove').addEventListener('click', () => {
      state.pendingFiles = state.pendingFiles.filter(f => f !== file);
      renderUploadPreviews();
      if (!state.pendingFiles.length) {
        DOM.uploadForm.style.display = 'none';
        DOM.uploadModalFooter.style.display = 'none';
      }
    });
    DOM.uploadPreviewList.appendChild(item);
  }
}

async function confirmUpload() {
  if (!state.pendingFiles.length) { toast('请先选择图片', 'error'); return; }

  const title = DOM.uploadTitle.value.trim() || '未命名乐谱';
  const categoryId = DOM.uploadCategory.value;
  const tags = DOM.uploadTags.value.split(',').map(t => t.trim()).filter(Boolean);
  const notes = DOM.uploadNotes.value.trim();

  DOM.uploadConfirm.disabled = true;
  DOM.uploadConfirm.textContent = '保存中...';

  try {
    for (let i = 0; i < state.pendingFiles.length; i++) {
      const file = state.pendingFiles[i];
      const dataURL = await fileToDataURL(file);
      const score = {
        id: uid(),
        title: state.pendingFiles.length > 1 ? `${title} (${i + 1})` : title,
        categoryId,
        tags,
        notes,
        dataURL,
        fileSize: file.size,
        fileType: file.type,
        favorite: false,
        createdAt: Date.now(),
      };
      await dbPut('scores', score);
      state.scores.push(score);
    }
    closeUploadModal();
    renderAll();
    toast(`已添加 ${state.pendingFiles.length} 张乐谱`, 'success');
    state.pendingFiles = [];
  } catch (err) {
    console.error(err);
    toast('保存失败，请重试', 'error');
  } finally {
    DOM.uploadConfirm.disabled = false;
    DOM.uploadConfirm.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> 保存`;
  }
}

// ───────────────────────────────────────────
// 10. Image Viewer
// ───────────────────────────────────────────
function openViewer(idx, list) {
  state.viewerList = list;
  state.viewerIndex = idx;
  renderViewer();
  DOM.viewerBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  DOM.viewerBackdrop.classList.remove('open');
  document.body.style.overflow = '';
}

function renderViewer() {
  const score = state.viewerList[state.viewerIndex];
  if (!score) return;

  const cat = state.categories.find(c => c.id === score.categoryId);
  DOM.viewerImg.src = score.dataURL;
  DOM.viewerTitle.textContent = score.title;
  DOM.viewerCategory.textContent = cat ? cat.name : '未分类';
  DOM.viewerDate.textContent = formatDate(score.createdAt);

  // Tags
  DOM.viewerTags.innerHTML = (score.tags || [])
    .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

  // Fav button
  const favSvg = DOM.viewerFav.querySelector('svg path');
  if (score.favorite) {
    DOM.viewerFav.classList.add('fav-active');
    favSvg.setAttribute('fill', 'var(--gold)');
    favSvg.setAttribute('stroke', 'var(--gold)');
  } else {
    DOM.viewerFav.classList.remove('fav-active');
    favSvg.setAttribute('fill', 'none');
    favSvg.setAttribute('stroke', 'currentColor');
  }

  // Nav buttons
  DOM.viewerPrev.style.display = state.viewerIndex > 0 ? '' : 'none';
  DOM.viewerNext.style.display = state.viewerIndex < state.viewerList.length - 1 ? '' : 'none';
}

function viewerNavigate(dir) {
  const newIdx = state.viewerIndex + dir;
  if (newIdx < 0 || newIdx >= state.viewerList.length) return;
  state.viewerIndex = newIdx;
  DOM.viewerImg.style.opacity = '0';
  DOM.viewerImg.style.transform = `translateX(${dir > 0 ? '30px' : '-30px'})`;
  setTimeout(() => {
    renderViewer();
    DOM.viewerImg.style.transition = 'opacity 0.2s, transform 0.2s';
    DOM.viewerImg.style.opacity = '1';
    DOM.viewerImg.style.transform = 'translateX(0)';
    setTimeout(() => { DOM.viewerImg.style.transition = ''; }, 200);
  }, 80);
}

async function toggleFavorite(id) {
  const score = state.scores.find(s => s.id === id);
  if (!score) return;
  score.favorite = !score.favorite;
  await dbPut('scores', score);
  renderAll();
  if (DOM.viewerBackdrop.classList.contains('open')) renderViewer();
  toast(score.favorite ? '已添加到收藏 ❤️' : '已取消收藏');
}

async function deleteScore(id) {
  if (!confirm('确定要删除这张乐谱吗？此操作不可撤销。')) return;
  await dbDelete('scores', id);
  state.scores = state.scores.filter(s => s.id !== id);
  closeViewer();
  renderAll();
  toast('已删除');
}

function downloadScore(score) {
  const a = document.createElement('a');
  a.href = score.dataURL;
  a.download = score.title + '.' + (score.fileType || 'image/jpeg').split('/')[1];
  a.click();
}

// ───────────────────────────────────────────
// 11. Edit Modal
// ───────────────────────────────────────────
function openEditModal(scoreId) {
  const score = state.scores.find(s => s.id === scoreId);
  if (!score) return;
  state.editingScoreId = scoreId;
  DOM.editTitle.value = score.title;
  DOM.editCategory.value = score.categoryId || '';
  DOM.editTags.value = (score.tags || []).join(', ');
  DOM.editNotes.value = score.notes || '';
  DOM.editModalBackdrop.classList.add('open');
  setTimeout(() => DOM.editTitle.focus(), 100);
}

function closeEditModal() {
  DOM.editModalBackdrop.classList.remove('open');
}

async function saveEdit() {
  const score = state.scores.find(s => s.id === state.editingScoreId);
  if (!score) return;
  score.title = DOM.editTitle.value.trim() || score.title;
  score.categoryId = DOM.editCategory.value;
  score.tags = DOM.editTags.value.split(',').map(t => t.trim()).filter(Boolean);
  score.notes = DOM.editNotes.value.trim();
  await dbPut('scores', score);
  closeEditModal();
  renderAll();
  if (DOM.viewerBackdrop.classList.contains('open')) renderViewer();
  toast('已保存', 'success');
}

// ───────────────────────────────────────────
// 12. Storage Info
// ───────────────────────────────────────────
function updateStorageInfo() {
  const totalBytes = state.scores.reduce((acc, s) => acc + (s.fileSize || 0), 0);
  DOM.storageSize.textContent = formatSize(totalBytes);
  // Estimate 100MB max display
  const pct = Math.min((totalBytes / (100 * 1024 * 1024)) * 100, 100);
  DOM.storageFill.style.width = pct + '%';
}

// ───────────────────────────────────────────
// 13. Drag & Drop
// ───────────────────────────────────────────
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  DOM.dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; DOM.dropOverlay.classList.remove('active'); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  DOM.dropOverlay.classList.remove('active');
  const files = e.dataTransfer.files;
  if (files.length) { openUploadModal(); handleFiles(files); }
});

// Upload zone internal drag
DOM.uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault(); e.stopPropagation();
  DOM.uploadZone.classList.add('drag-over');
});
DOM.uploadZone.addEventListener('dragleave', () => DOM.uploadZone.classList.remove('drag-over'));
DOM.uploadZone.addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation();
  DOM.uploadZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

// ───────────────────────────────────────────
// 14. Keyboard shortcuts
// ───────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (DOM.viewerBackdrop.classList.contains('open')) {
    if (e.key === 'ArrowLeft')  viewerNavigate(-1);
    if (e.key === 'ArrowRight') viewerNavigate(1);
    if (e.key === 'Escape')     closeViewer();
  } else {
    if (e.key === 'Escape') {
      if (DOM.uploadModalBackdrop.classList.contains('open')) closeUploadModal();
      if (DOM.categoryModalBackdrop.classList.contains('open')) closeCategoryModal();
      if (DOM.editModalBackdrop.classList.contains('open')) closeEditModal();
    }
  }
});

// Touch swipe in viewer
let touchStartX = 0;
DOM.viewerBackdrop.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
DOM.viewerBackdrop.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 60) viewerNavigate(dx < 0 ? 1 : -1);
});

// ───────────────────────────────────────────
// 15. Event Listeners
// ───────────────────────────────────────────
function bindEvents() {
  // Sidebar toggle
  DOM.sidebarToggle.addEventListener('click', toggleSidebar);
  DOM.mobileMenuBtn.addEventListener('click', toggleSidebar);

  // Nav filters
  DOM.navAll.addEventListener('click', () => setFilter('all'));
  DOM.navFavorites.addEventListener('click', () => setFilter('favorites'));

  // Category
  DOM.addCategoryBtn.addEventListener('click', () => openCategoryModal());
  DOM.categoryModalClose.addEventListener('click', closeCategoryModal);
  DOM.categoryCancel.addEventListener('click', closeCategoryModal);
  DOM.categoryConfirm.addEventListener('click', saveCategory);
  DOM.categoryName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCategory(); });
  DOM.colorPicker.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      state.selectedColor = dot.dataset.color;
      DOM.colorPicker.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
    });
  });

  // Upload
  DOM.uploadBtn.addEventListener('click', openUploadModal);
  DOM.emptyUploadBtn.addEventListener('click', openUploadModal);
  DOM.uploadModalClose.addEventListener('click', closeUploadModal);
  DOM.uploadCancel.addEventListener('click', closeUploadModal);
  DOM.uploadConfirm.addEventListener('click', confirmUpload);
  DOM.browseBtn.addEventListener('click', () => DOM.fileInput.click());
  DOM.uploadZone.addEventListener('click', (e) => { if (e.target !== DOM.browseBtn) DOM.fileInput.click(); });
  DOM.fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

  // View toggle
  DOM.viewGrid.addEventListener('click', () => {
    state.viewMode = 'grid';
    DOM.viewGrid.classList.add('active');
    DOM.viewList.classList.remove('active');
    renderScores();
  });
  DOM.viewList.addEventListener('click', () => {
    state.viewMode = 'list';
    DOM.viewList.classList.add('active');
    DOM.viewGrid.classList.remove('active');
    renderScores();
  });

  // Sort
  DOM.sortSelect.addEventListener('change', () => {
    state.sort = DOM.sortSelect.value;
    renderScores();
  });

  // Search
  DOM.globalSearch.addEventListener('input', () => {
    state.search = DOM.globalSearch.value;
    renderScores();
  });

  // Viewer
  DOM.viewerClose.addEventListener('click', closeViewer);
  DOM.viewerPrev.addEventListener('click', () => viewerNavigate(-1));
  DOM.viewerNext.addEventListener('click', () => viewerNavigate(1));
  DOM.viewerFav.addEventListener('click', () => {
    const score = state.viewerList[state.viewerIndex];
    if (score) toggleFavorite(score.id);
  });
  DOM.viewerEdit.addEventListener('click', () => {
    const score = state.viewerList[state.viewerIndex];
    if (score) openEditModal(score.id);
  });
  DOM.viewerDownload.addEventListener('click', () => {
    const score = state.viewerList[state.viewerIndex];
    if (score) downloadScore(score);
  });
  DOM.viewerDelete.addEventListener('click', () => {
    const score = state.viewerList[state.viewerIndex];
    if (score) deleteScore(score.id);
  });

  // Edit modal
  DOM.editModalClose.addEventListener('click', closeEditModal);
  DOM.editCancel.addEventListener('click', closeEditModal);
  DOM.editConfirm.addEventListener('click', saveEdit);

  // Backdrop click to close
  DOM.uploadModalBackdrop.addEventListener('click', (e) => { if (e.target === DOM.uploadModalBackdrop) closeUploadModal(); });
  DOM.categoryModalBackdrop.addEventListener('click', (e) => { if (e.target === DOM.categoryModalBackdrop) closeCategoryModal(); });
  DOM.editModalBackdrop.addEventListener('click', (e) => { if (e.target === DOM.editModalBackdrop) closeEditModal(); });
  DOM.viewerBackdrop.addEventListener('click', (e) => { if (e.target === DOM.viewerBackdrop) closeViewer(); });
}

// ───────────────────────────────────────────
// 16. Boot
// ───────────────────────────────────────────
async function boot() {
  try {
    await initDB();
    const [scores, categories] = await Promise.all([
      dbGetAll('scores'),
      dbGetAll('categories'),
    ]);
    state.scores = scores;
    state.categories = categories;
    bindEvents();
    renderAll();

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  } catch (err) {
    console.error('Boot error:', err);
    toast('初始化失败，请刷新页面', 'error');
  }
}

document.addEventListener('DOMContentLoaded', boot);
