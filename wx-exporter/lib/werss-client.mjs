/**
 * we-mp-rss HTTP 客户端（精简版，仅本工具用到的能力）
 * 主项目 lib/werss-client.mjs 的简化移植：登录拿 token、列出已订阅公众号。
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export class WeRSSClient {
  constructor(baseUrl) {
    this.baseUrl = (baseUrl || 'http://localhost:8002').replace(/\/$/, '');
    this.apiBase = `${this.baseUrl}/api/v1/wx`;
  }

  async _request(method, path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
        },
        body: options.body,
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(res.ok ? 'Invalid JSON response' : `HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        const msg = data?.message || data?.detail?.message || data?.detail || `HTTP ${res.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`请求超时: ${path}`);
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** OAuth2 表单登录，返回 access_token */
  async login(username, password) {
    const form = new URLSearchParams();
    form.set('username', username);
    form.set('password', password);
    const data = await this._request('POST', '/auth/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const token = data?.data?.access_token ?? data?.access_token;
    if (!token) throw new Error('登录响应中无 access_token');
    return {
      accessToken: token,
      expiresIn: data?.data?.expires_in ?? data?.expires_in ?? 3600,
    };
  }

  _authHeaders(token) {
    return { Authorization: `Bearer ${token}` };
  }

  /** 当前微信扫码登录态 */
  async getQrStatus(token) {
    const data = await this._request('GET', '/auth/qr/status', {
      headers: this._authHeaders(token),
    });
    const payload = data?.data ?? data;
    return { login_status: payload?.login_status === true };
  }

  /** 已订阅公众号列表（分页） */
  async getMpList(token, limit = 100, offset = 0, kw = '') {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (kw) q.set('kw', kw);
    const data = await this._request('GET', `/mps?${q.toString()}`, {
      headers: this._authHeaders(token),
    });
    return data?.data ?? data;
  }

  /** 一次性把所有已订阅公众号都拉回来 */
  async getAllMps(token) {
    const all = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const result = await this.getMpList(token, limit, offset);
      const list = result?.list || result || [];
      if (!Array.isArray(list) || list.length === 0) break;
      all.push(...list);
      if (list.length < limit) break;
      offset += limit;
    }
    return all;
  }
}

/**
 * 创建一个带 token 自动缓存 + 401 自动重登的客户端封装。
 */
export function createWeRSSSession({ baseUrl, username, password }) {
  const client = new WeRSSClient(baseUrl);
  let cache = { token: null, expiresAt: 0 };

  async function getToken() {
    const now = Date.now();
    if (cache.token && now < cache.expiresAt - 60_000) return cache.token;
    const { accessToken, expiresIn } = await client.login(username, password);
    cache = {
      token: accessToken,
      expiresAt: now + (Number(expiresIn) || 3600) * 1000,
    };
    return accessToken;
  }

  function isAuthError(e) {
    const msg = (e?.message || '').toLowerCase();
    return (
      msg.includes('401') ||
      msg.includes('unauthorized') ||
      msg.includes('credential') ||
      msg.includes('token') ||
      msg.includes('登录')
    );
  }

  async function withAuth(run) {
    try {
      const token = await getToken();
      return await run(client, token);
    } catch (e) {
      if (!isAuthError(e)) throw e;
      cache = { token: null, expiresAt: 0 };
      const token = await getToken();
      return await run(client, token);
    }
  }

  return { client, getToken, withAuth };
}
