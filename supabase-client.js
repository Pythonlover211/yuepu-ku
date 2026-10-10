/**
 * 🎵 乐谱库 (Music Score App) - Supabase 极简原生云同步客户端
 * 采用原生 Fetch API 封装，0 额外三方库依赖，体积仅 ~5KB，离线安全无报错
 */

(function (window) {
  'use strict';

  const STORAGE_KEY_CONFIG = 'musicscore_supabase_config';
  const STORAGE_KEY_SESSION = 'musicscore_supabase_session';
  const STORAGE_KEY_SYNC_META = 'musicscore_sync_meta';

  const DEFAULT_SUPABASE_URL = 'https://ixtnsmnwwpymqixgzjkq.supabase.co';
  const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4dG5zbW53d3B5bXFpeGd6amtxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2Mzk5NTYsImV4cCI6MjEwNzIxNTk1Nn0.ZoT2IcercSQb1aN9HyW3vMt5bLxJvfbG093jDT2wp_I';

  class SupabaseSyncService {
    constructor() {
      this.config = this.loadConfig();
      this.session = this.loadSession();
      this.isSyncing = false;
      this.syncListeners = new Set();
    }

    loadConfig() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            url: parsed.url || DEFAULT_SUPABASE_URL,
            anonKey: parsed.anonKey || DEFAULT_SUPABASE_ANON_KEY
          };
        }
      } catch (e) {
        console.warn('Failed to parse Supabase config', e);
      }
      return {
        url: DEFAULT_SUPABASE_URL,
        anonKey: DEFAULT_SUPABASE_ANON_KEY
      };
    }

    saveConfig(url, anonKey) {
      this.config = {
        url: (url || '').trim().replace(/\/+$/, ''),
        anonKey: (anonKey || '').trim()
      };
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
    }

    isConfigured() {
      return Boolean(this.config.url && this.config.anonKey);
    }

    loadSession() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_SESSION);
        if (raw) return JSON.parse(raw);
      } catch (e) {
        console.warn('Failed to parse session', e);
      }
      return null;
    }

    saveSession(session) {
      this.session = session;
      if (session) {
        localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
      } else {
        localStorage.removeItem(STORAGE_KEY_SESSION);
      }
      this.notifyStateChange();
    }

    isLoggedIn() {
      return Boolean(this.session && this.session.access_token && this.session.user);
    }

    getUser() {
      return this.session ? this.session.user : null;
    }

    getAccessToken() {
      return this.session ? this.session.access_token : null;
    }

    onStateChange(fn) {
      this.syncListeners.add(fn);
      return () => this.syncListeners.delete(fn);
    }

    notifyStateChange(meta = {}) {
      const state = {
        isConfigured: this.isConfigured(),
        isLoggedIn: this.isLoggedIn(),
        user: this.getUser(),
        isSyncing: this.isSyncing,
        lastSyncTime: this.getLastSyncTime(),
        ...meta
      };
      this.syncListeners.forEach(fn => {
        try { fn(state); } catch (err) { console.error(err); }
      });
    }

    getLastSyncTime() {
      try {
        return localStorage.getItem(STORAGE_KEY_SYNC_META) || null;
      } catch (e) {
        return null;
      }
    }

    setLastSyncTime(isoStr) {
      localStorage.setItem(STORAGE_KEY_SYNC_META, isoStr || new Date().toISOString());
    }

    // ==========================================
    // 🔐 身份认证 API (Auth API)
    // ==========================================

    async signUp(email, password, nickname) {
      if (!this.isConfigured()) throw new Error('请先配置 Supabase Project URL 与 anon key');

      const url = `${this.config.url}/auth/v1/signup`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': this.config.anonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
          data: {
            nickname: (nickname || '').trim() || email.split('@')[0]
          }
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.msg || data.message || data.error_description || '注册失败，请检查邮箱格式或密码');
      }

      // 如果开启了免邮箱验证，直接自动登录
      if (data.access_token) {
        this.saveSession(data);
        return { user: data.user, autoLoggedIn: true };
      }

      return { user: data.user || data, autoLoggedIn: false };
    }

    async signIn(email, password) {
      if (!this.isConfigured()) throw new Error('请先配置 Supabase Project URL 与 anon key');

      const url = `${this.config.url}/auth/v1/token?grant_type=password`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': this.config.anonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error_description || data.msg || data.message || '账号或密码错误');
      }

      this.saveSession(data);
      return data;
    }

    async signOut() {
      if (this.session && this.session.access_token && this.isConfigured()) {
        try {
          await fetch(`${this.config.url}/auth/v1/logout`, {
            method: 'POST',
            headers: {
              'apikey': this.config.anonKey,
              'Authorization': `Bearer ${this.session.access_token}`
            }
          });
        } catch (e) {
          console.warn('Logout network notice ignored', e);
        }
      }
      this.saveSession(null);
    }

    async refreshSessionIfNeeded() {
      if (!this.session || !this.session.refresh_token || !this.isConfigured()) return false;

      // 检查 token 是否过期（默认提前 5 分钟刷新）
      const expiresAt = this.session.expires_at;
      const nowSec = Math.floor(Date.now() / 1000);
      if (expiresAt && (expiresAt - nowSec > 300)) {
        return true; // 依然有效
      }

      try {
        const url = `${this.config.url}/auth/v1/token?grant_type=refresh_token`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'apikey': this.config.anonKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ refresh_token: this.session.refresh_token })
        });
        if (res.ok) {
          const freshData = await res.json();
          this.saveSession(freshData);
          return true;
        }
      } catch (e) {
        console.warn('Token refresh failed', e);
      }
      return false;
    }

    // ==========================================
    // ☁️ 云存储 API (Storage: score-images)
    // ==========================================

    async uploadImage(blobOrDataUrl, remotePath) {
      await this.refreshSessionIfNeeded();
      const token = this.getAccessToken();
      if (!token) throw new Error('未登录');

      let blob = blobOrDataUrl;
      let contentType = 'image/jpeg';

      if (typeof blobOrDataUrl === 'string' && blobOrDataUrl.startsWith('data:')) {
        const matches = blobOrDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          contentType = matches[1];
          const byteChars = atob(matches[2]);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          blob = new Blob([byteArray], { type: contentType });
        }
      }

      const uploadUrl = `${this.config.url}/storage/v1/object/score-images/${encodeURIComponent(remotePath)}`;
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'apikey': this.config.anonKey,
          'Authorization': `Bearer ${token}`,
          'Content-Type': contentType,
          'x-upsert': 'true'
        },
        body: blob
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `上传乐谱图片失败: ${res.statusText}`);
      }

      // 获取公开访问链接
      return `${this.config.url}/storage/v1/object/public/score-images/${remotePath}`;
    }

    // ==========================================
    // 🗄️ 数据库 PostgREST 封装
    // ==========================================

    async restRequest(endpoint, options = {}) {
      await this.refreshSessionIfNeeded();
      const token = this.getAccessToken();
      if (!token) throw new Error('用户未登录，无法访问云端数据');

      const url = `${this.config.url}/rest/v1/${endpoint}`;
      const headers = {
        'apikey': this.config.anonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };

      const res = await fetch(url, {
        ...options,
        headers
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.hint || `云端请求错误 (${res.status}): ${res.statusText}`);
      }

      if (res.status === 204) return null;
      return await res.json();
    }

    // ==========================================
    // 🔄 业务双向同步引擎 (Sync Engine)
    // ==========================================

    /**
     * 将单首乐谱上报并同步到云端
     */
    async uploadSingleScoreToCloud(score) {
      const user = this.getUser();
      if (!user) throw new Error('未登录');

      const scoreId = String(score.id);

      // 1. 同步主表记录
      const scorePayload = {
        id: scoreId,
        user_id: user.id,
        title: score.title || '未命名乐谱',
        composer: score.composer || '',
        category: score.category || 'classical',
        difficulty: Number(score.difficulty) || 1,
        tags: Array.isArray(score.tags) ? score.tags : [],
        is_favorite: Boolean(score.isFavorite),
        is_folder: Boolean(score.isFolder),
        folder_name: score.folderName || '',
        updated_at: score.updatedAt ? new Date(score.updatedAt).toISOString() : new Date().toISOString()
      };

      await this.restRequest('scores', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(scorePayload)
      });

      // 2. 同步页面与图片
      const pages = Array.isArray(score.pages) && score.pages.length > 0
        ? score.pages
        : [{ pageOrder: 0, image: score.image, annotations: score.annotations || [] }];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        let remoteImageUrl = page.image;

        // 如果图片是本地 base64 数据，上传到 Storage
        if (typeof remoteImageUrl === 'string' && remoteImageUrl.startsWith('data:')) {
          const ext = remoteImageUrl.includes('png') ? 'png' : 'jpg';
          const remotePath = `${user.id}/${scoreId}_page_${i}_${Date.now()}.${ext}`;
          try {
            remoteImageUrl = await this.uploadImage(page.image, remotePath);
          } catch (uploadErr) {
            console.warn(`Upload image page ${i} error`, uploadErr);
          }
        }

        const pageId = `page_${scoreId}_${i}`;
        const pagePayload = {
          id: pageId,
          score_id: scoreId,
          user_id: user.id,
          page_order: i,
          image_url: remoteImageUrl || '',
          annotations: page.annotations || [],
          updated_at: new Date().toISOString()
        };

        await this.restRequest('score_pages', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(pagePayload)
        });
      }
    }

    /**
     * 将单条打卡记录上报到云端
     */
    async uploadSingleCheckinToCloud(checkin) {
      const user = this.getUser();
      if (!user) throw new Error('未登录');

      const checkinPayload = {
        id: String(checkin.id),
        user_id: user.id,
        date: checkin.date,
        score_title: checkin.scoreTitle || '',
        duration: Number(checkin.duration) || 30,
        notes: checkin.notes || '',
        mood: checkin.mood || '充实',
        created_at: checkin.createdAt ? new Date(checkin.createdAt).toISOString() : new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await this.restRequest('checkins', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(checkinPayload)
      });
    }

    /**
     * 从云端拉取所有乐谱及页面
     */
    async fetchCloudScores() {
      const cloudScores = await this.restRequest('scores?select=*&order=created_at.desc');
      if (!Array.isArray(cloudScores) || cloudScores.length === 0) return [];

      const scoreIds = cloudScores.map(s => s.id);
      // 获取对应的页面
      const pages = await this.restRequest(`score_pages?score_id=in.(${scoreIds.join(',')})&order=page_order.asc`);
      const pageMap = {};
      (pages || []).forEach(p => {
        if (!pageMap[p.score_id]) pageMap[p.score_id] = [];
        pageMap[p.score_id].push({
          pageOrder: p.page_order,
          image: p.image_url,
          annotations: p.annotations || []
        });
      });

      return cloudScores.map(cs => {
        const scorePages = pageMap[cs.id] || [];
        return {
          id: cs.id,
          title: cs.title,
          composer: cs.composer || '',
          category: cs.category || 'classical',
          difficulty: cs.difficulty || 1,
          tags: cs.tags || [],
          isFavorite: Boolean(cs.is_favorite),
          isFolder: Boolean(cs.is_folder),
          folderName: cs.folder_name || '',
          pages: scorePages,
          image: scorePages[0] ? scorePages[0].image : '',
          annotations: scorePages[0] ? scorePages[0].annotations : [],
          createdAt: new Date(cs.created_at).getTime(),
          updatedAt: new Date(cs.updated_at).getTime()
        };
      });
    }

    /**
     * 从云端拉取所有打卡记录
     */
    async fetchCloudCheckins() {
      const cloudCheckins = await this.restRequest('checkins?select=*&order=created_at.desc');
      if (!Array.isArray(cloudCheckins)) return [];

      return cloudCheckins.map(chk => ({
        id: chk.id,
        date: chk.date,
        scoreTitle: chk.score_title || '',
        duration: chk.duration || 30,
        notes: chk.notes || '',
        mood: chk.mood || '充实',
        createdAt: new Date(chk.created_at).getTime()
      }));
    }
  }

  // 挂载到全局
  window.SupabaseSyncService = new SupabaseSyncService();
})(window);
