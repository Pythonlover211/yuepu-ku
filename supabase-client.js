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

    cleanUrl(url) {
      if (!url) return '';
      let u = String(url).trim();
      u = u.replace(/\/+$/, '');
      u = u.replace(/\/rest\/v1\/?$/i, '');
      u = u.replace(/\/auth\/v1\/?$/i, '');
      u = u.replace(/\/storage\/v1\/?$/i, '');
      u = u.replace(/\/+$/, '');
      if (u && !/^https?:\/\//i.test(u)) {
        u = 'https://' + u;
      }
      return u;
    }

    loadConfig() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            url: this.cleanUrl(parsed.url) || DEFAULT_SUPABASE_URL,
            anonKey: (parsed.anonKey || DEFAULT_SUPABASE_ANON_KEY).trim()
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
      const cleanedUrl = this.cleanUrl(url) || DEFAULT_SUPABASE_URL;
      const cleanedKey = (anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();
      this.config = {
        url: cleanedUrl,
        anonKey: cleanedKey
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
    // 🔍 云端连通性快速诊断测试
    // ==========================================

    async testConnection(customUrl, customKey) {
      const targetUrl = this.cleanUrl(customUrl || this.config.url || DEFAULT_SUPABASE_URL);
      const targetKey = (customKey || this.config.anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();
      if (!targetUrl) throw new Error('请输入有效的 Supabase 项目 URL');

      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const res = await fetch(`${targetUrl}/auth/v1/health`, {
          method: 'GET',
          headers: { 'apikey': targetKey },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const latency = Date.now() - startTime;
        if (res.ok) {
          return { ok: true, latency, message: `✅ 云端网络通畅！往返延时: ${latency} ms` };
        }
        return { ok: false, latency, message: `⚠️ 云端返回状态码 HTTP ${res.status}，请核对 anon key` };
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('连接超时 (8秒未响应)。国内直连境外云服务较慢，请开启网络代理后重试');
        }
        const msg = err.message || '';
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
          throw new Error('网络无法触达 (Failed to fetch)。请检查设备网络或开启代理/梯子');
        }
        throw new Error(`连接失败: ${msg}`);
      }
    }

    // ==========================================
    // 🔐 身份认证 API (Auth API)
    // ==========================================

    async signUp(email, password, nickname) {
      if (!this.isConfigured()) throw new Error('请先配置 Supabase Project URL 与 anon key');

      const cleanBase = this.cleanUrl(this.config.url);
      const url = `${cleanBase}/auth/v1/signup`;
      let res;
      try {
        res = await fetch(url, {
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
      } catch (networkErr) {
        console.error('Sign up fetch failed', networkErr);
        throw new Error(
          '❌ 网络连接失败 (Failed to fetch)：无法连接到云端服务器。\n' +
          '• 若在手机端使用：国内直连境外 Supabase 易受阻，手机请开启网络加速/代理软件；\n' +
          '• 若自定义了 URL：请点击下方「自定义配置」，确保格式为 https://xxxx.supabase.co（不要带 /rest/v1）。'
        );
      }

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(`云端响应解析失败 (${res.status} ${res.statusText})`);
      }

      if (!res.ok) {
        const rawMsg = data.msg || data.message || data.error_description || '';
        const errorCode = data.error_code || '';
        if (rawMsg.includes('rate limit') || errorCode.includes('rate_limit')) {
          throw new Error(
            '⚠️ 邮件发送已达频率限制 (email rate limit exceeded)。\n' +
            '【彻底解决办法】：请在 Supabase 后台 Project Settings -> Authentication -> User Signups 中，将「Confirm email」彻底关闭（拨为灰色并点击 Save changes），即可免验证直接秒速注册！'
          );
        }
        if (rawMsg.includes('invalid') && rawMsg.includes('email')) {
          throw new Error('⚠️ 邮箱格式不正确，请使用常用真实邮箱（如 @qq.com 或 @163.com）。');
        }
        if (rawMsg.includes('already registered') || rawMsg.includes('already exists')) {
          throw new Error('⚠️ 该邮箱已被注册，请直接切换上方「账号登录」。');
        }
        throw new Error(rawMsg || '注册失败，请检查邮箱格式或密码');
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

      const cleanBase = this.cleanUrl(this.config.url);
      const url = `${cleanBase}/auth/v1/token?grant_type=password`;
      let res;
      try {
        res = await fetch(url, {
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
      } catch (networkErr) {
        console.error('Sign in fetch failed', networkErr);
        throw new Error(
          '❌ 网络连接失败 (Failed to fetch)：无法连接到云端服务器。\n' +
          '• 若在手机端使用：国内直连境外 Supabase 易受阻，手机请开启网络加速/代理软件；\n' +
          '• 若自定义了 URL：请点击下方「自定义配置」，确保格式为 https://xxxx.supabase.co（不要带 /rest/v1）。'
        );
      }

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(`云端响应解析失败 (${res.status} ${res.statusText})`);
      }

      if (!res.ok) {
        const rawMsg = data.error_description || data.msg || data.message || '';
        if (rawMsg.includes('Invalid login credentials')) {
          throw new Error('⚠️ 账号邮箱或密码错误，请核对后重试');
        }
        if (rawMsg.includes('Email not confirmed')) {
          throw new Error('⚠️ 该账号邮箱尚未验证。请前往邮箱查收邮件点击确认，或在 Supabase 控制台将 Confirm email 关闭。');
        }
        throw new Error(rawMsg || '登录失败');
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

      const cleanBase = this.cleanUrl(this.config.url);
      const uploadUrl = `${cleanBase}/storage/v1/object/score-images/${encodeURIComponent(remotePath)}`;
      let res;
      try {
        res = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'apikey': this.config.anonKey,
            'Authorization': `Bearer ${token}`,
            'Content-Type': contentType,
            'x-upsert': 'true'
          },
          body: blob
        });
      } catch (err) {
        throw new Error('网络连接中断 (Failed to fetch)：乐谱图片上传失败，请检查网络');
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `上传乐谱图片失败: ${res.statusText}`);
      }

      // 获取公开访问链接
      return `${cleanBase}/storage/v1/object/public/score-images/${remotePath}`;
    }

    // ==========================================
    // 🗄️ 数据库 PostgREST 封装
    // ==========================================

    async restRequest(endpoint, options = {}) {
      await this.refreshSessionIfNeeded();
      const token = this.getAccessToken();
      if (!token) throw new Error('用户未登录，无法访问云端数据');

      const cleanBase = this.cleanUrl(this.config.url);
      const url = `${cleanBase}/rest/v1/${endpoint}`;
      const headers = {
        'apikey': this.config.anonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };

      let res;
      try {
        res = await fetch(url, {
          ...options,
          headers
        });
      } catch (networkErr) {
        throw new Error('网络连接中断 (Failed to fetch)：无法访问云端数据库，请检查网络或代理');
      }

      if (!res.ok) {
        let errJson = {};
        try { errJson = await res.json(); } catch(e) {}
        throw new Error(errJson.message || errJson.hint || errJson.error_description || `云端请求错误 (${res.status}): ${res.statusText}`);
      }

      if (res.status === 204) return null;
      const text = await res.text();
      if (!text || !text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        return null;
      }
    }

    safeIsoDate(val) {
      if (!val) return new Date().toISOString();
      try {
        const d = new Date(val);
        return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      } catch (e) {
        return new Date().toISOString();
      }
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

      // 提取页面列表（兼容器件：支持 string 数组或 object 数组）
      const rawPages = (Array.isArray(score.pages) && score.pages.length > 0)
        ? score.pages
        : (score.dataURL ? [score.dataURL] : []);

      // 1. 同步主表记录
      const scorePayload = {
        id: scoreId,
        user_id: user.id,
        title: score.title || '未命名乐谱',
        composer: score.composer || '',
        category: score.categoryId || score.category || 'classical',
        difficulty: Number(score.difficulty) || 1,
        tags: Array.isArray(score.tags) ? score.tags : [],
        is_favorite: Boolean(score.favorite != null ? score.favorite : score.isFavorite),
        is_folder: Boolean(score.isFolder || rawPages.length > 1),
        folder_name: score.folderName || '',
        updated_at: this.safeIsoDate(score.updatedAt)
      };

      await this.restRequest('scores?on_conflict=id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(scorePayload)
      });

      // 2. 同步页面与图片数据
      const pagesToSync = rawPages.length > 0 ? rawPages : [score.dataURL || ''];

      for (let i = 0; i < pagesToSync.length; i++) {
        const pageItem = pagesToSync[i];
        let rawImageUrl = typeof pageItem === 'string'
          ? pageItem
          : (pageItem.image || pageItem.dataURL || score.dataURL || '');
        let annotations = (typeof pageItem === 'object' && pageItem.annotations)
          ? pageItem.annotations
          : (score.annotations || []);

        let finalImageUrl = rawImageUrl;

        // 若是 base64 数据，优先尝试上传到 Storage，如果 Storage 失败则保底存入 image_url 文本中，确保绝不丢图
        if (typeof rawImageUrl === 'string' && rawImageUrl.startsWith('data:')) {
          const ext = rawImageUrl.includes('svg') ? 'svg' : (rawImageUrl.includes('png') ? 'png' : 'jpg');
          const remotePath = `${user.id}/${scoreId}_p${i}_${Date.now()}.${ext}`;
          try {
            finalImageUrl = await this.uploadImage(rawImageUrl, remotePath);
          } catch (uploadErr) {
            console.warn(`Storage upload unavailable for page ${i}, fallback to direct data storage:`, uploadErr.message);
            finalImageUrl = rawImageUrl;
          }
        }

        const pageId = `page_${scoreId}_${i}`;
        const pagePayload = {
          id: pageId,
          score_id: scoreId,
          user_id: user.id,
          page_order: i,
          image_url: finalImageUrl || '',
          annotations: annotations || [],
          updated_at: new Date().toISOString()
        };

        await this.restRequest('score_pages?on_conflict=id', {
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
        created_at: this.safeIsoDate(checkin.createdAt),
        updated_at: new Date().toISOString()
      };

      await this.restRequest('checkins?on_conflict=id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(checkinPayload)
      });
    }

    /**
     * 同步用户个性化配置（背景壁纸、模糊度、遮罩透明度、主题及自定义分类）到云端
     */
    async syncUserSettings(settings = {}) {
      await this.refreshSessionIfNeeded();
      const token = this.getAccessToken();
      if (!token) throw new Error('用户未登录，无法同步配置');

      const cleanBase = this.cleanUrl(this.config.url);
      const url = `${cleanBase}/auth/v1/user`;

      const currentSettings = this.fetchUserSettings() || {};
      const mergedSettings = {
        ...currentSettings,
        ...settings,
        updatedAt: new Date().toISOString()
      };

      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            'apikey': this.config.anonKey,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            data: {
              app_settings: mergedSettings
            }
          })
        });

        if (res.ok) {
          const freshUser = await res.json();
          if (this.session) {
            this.session.user = freshUser;
            this.saveSession(this.session);
          }
          return mergedSettings;
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || errData.msg || `HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn('syncUserSettings failed:', err);
        throw err;
      }
    }

    /**
     * 从当前登录会话中获取云端保存的个性化配置
     */
    fetchUserSettings() {
      const user = this.getUser();
      if (!user || !user.user_metadata) return null;
      return user.user_metadata.app_settings || null;
    }

    /**
     * 主动从云端服务器拉取最新用户元数据（跨设备同步时避免读取本地旧缓存）
     */
    async fetchFreshUserSettings() {
      await this.refreshSessionIfNeeded();
      const token = this.getAccessToken();
      if (!token) return this.fetchUserSettings();

      const cleanBase = this.cleanUrl(this.config.url);
      const url = `${cleanBase}/auth/v1/user`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'apikey': this.config.anonKey,
            'Authorization': `Bearer ${token}`
          }
        });
        if (res.ok) {
          const freshUser = await res.json();
          if (this.session) {
            this.session.user = freshUser;
            this.saveSession(this.session);
          }
          return (freshUser.user_metadata && freshUser.user_metadata.app_settings) || null;
        }
      } catch (e) {
        console.warn('fetchFreshUserSettings error:', e);
      }
      return this.fetchUserSettings();
    }

    /**
     * 从云端拉取所有乐谱及页面，并精准对齐本地数据模型
     */
    async fetchCloudScores() {
      const cloudScores = await this.restRequest('scores?select=*&order=created_at.desc');
      if (!Array.isArray(cloudScores) || cloudScores.length === 0) return [];

      const scoreIds = cloudScores.map(s => s.id);
      // 获取对应的页面
      const quotedIds = scoreIds.map(id => `"${id}"`).join(',');
      const pages = await this.restRequest(`score_pages?score_id=in.(${quotedIds})&order=page_order.asc`);
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
        const pageUrls = scorePages.map(p => p.image).filter(Boolean);
        const primaryImage = pageUrls[0] || '';

        return {
          id: cs.id,
          title: cs.title,
          composer: cs.composer || '',
          categoryId: cs.category || 'classical',
          category: cs.category || 'classical',
          difficulty: cs.difficulty || 1,
          tags: Array.isArray(cs.tags) ? cs.tags : [],
          favorite: Boolean(cs.is_favorite),
          isFavorite: Boolean(cs.is_favorite),
          isFolder: Boolean(cs.is_folder || pageUrls.length > 1),
          folderName: cs.folder_name || '',
          // 确保 pages 数组是 string[] 形式，完全符合渲染器与乐谱夹逻辑
          pages: pageUrls.length > 0 ? pageUrls : (primaryImage ? [primaryImage] : []),
          dataURL: primaryImage,
          annotations: scorePages[0] ? scorePages[0].annotations : {},
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
