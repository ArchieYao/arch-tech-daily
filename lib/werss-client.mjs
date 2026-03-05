/**
 * we-mp-rss HTTP 客户端：登录、二维码、搜索公众号、获取公众号列表、RSS URL 拼接。
 * 所有请求使用 application/json 或 form，响应格式为 { code: 0, message, data }。
 */

const DEFAULT_TIMEOUT_MS = 15000;

export class WeRSSClient {
  constructor(baseUrl = 'http://localhost:8001') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiBase = `${this.baseUrl}/api/v1`;
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
          'Accept': 'application/json',
          ...(options.headers || {}),
        },
        ...options,
      });
      clearTimeout(timeout);
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(res.ok ? 'Invalid JSON' : `HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        const msg = data?.message || data?.detail?.message || data?.detail || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error('请求超时');
      throw e;
    }
  }

  /**
   * 登录 we-mp-rss，获取 JWT。
   * 使用 form body: username, password (OAuth2PasswordRequestForm)
   */
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
    return { accessToken: token, expiresIn: data?.data?.expires_in ?? data?.expires_in };
  }

  _authHeaders(accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  /** 获取微信登录二维码（返回 data 中的 code URL 或对象） */
  async getQrCode(accessToken) {
    const data = await this._request('GET', '/auth/qr/code', {
      headers: this._authHeaders(accessToken),
    });
    return data?.data ?? data;
  }

  /** 获取二维码图片 URL 或 base64（用于前端展示） */
  async getQrImage(accessToken) {
    const data = await this._request('GET', '/auth/qr/image', {
      headers: this._authHeaders(accessToken),
    });
    return data?.data ?? data;
  }

  /** 查询微信扫码状态 */
  async getQrStatus(accessToken) {
    const data = await this._request('GET', '/auth/qr/status', {
      headers: this._authHeaders(accessToken),
    });
    const payload = data?.data ?? data;
    return { login_status: payload?.login_status === true };
  }

  /** 扫码完成后关闭（可选） */
  async getQrOver(accessToken) {
    const data = await this._request('GET', '/auth/qr/over', {
      headers: this._authHeaders(accessToken),
    });
    return data?.data ?? data;
  }

  /**
   * 搜索微信公众号
   * @returns { list: Array<{ fakeid, nickname, ... }>, page: {}, total: number }
   */
  async searchMp(accessToken, keyword, limit = 10, offset = 0) {
    const kw = encodeURIComponent(keyword);
    const data = await this._request('GET', `/mps/search/${kw}?limit=${limit}&offset=${offset}`, {
      headers: this._authHeaders(accessToken),
    });
    return data?.data ?? data;
  }

  /**
   * 获取已订阅公众号列表
   * @returns { list: Array<{ id, mp_name, mp_cover, mp_intro, status, created_at }>, page, total }
   */
  async getMpList(accessToken, limit = 50, offset = 0, kw = '') {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (kw) q.set('kw', kw);
    const data = await this._request('GET', `/mps?${q.toString()}`, {
      headers: this._authHeaders(accessToken),
    });
    return data?.data ?? data;
  }

  /**
   * 订阅公众号（添加 Feed）。
   * we-mp-rss 若未提供 POST /mps 则通过“更新”触发首次拉取；部分版本可能有 POST 添加接口。
   * 尝试 POST /api/v1/mps，body: { fakeid, nickname, mp_cover?, mp_intro? }
   */
  async subscribeMp(accessToken, { fakeid, nickname, mp_cover, mp_intro }) {
    const body = { fakeid, nickname };
    if (mp_cover != null) body.mp_cover = mp_cover;
    if (mp_intro != null) body.mp_intro = mp_intro;
    try {
      const data = await this._request('POST', '/mps', {
        headers: { ...this._authHeaders(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const id = data?.data?.id ?? data?.id ?? fakeid;
      return { id, ...(data?.data || data || {}) };
    } catch (e) {
      if (e.message && (e.message.includes('404') || e.message.includes('Not Found') || e.message.includes('405'))) {
        return { id: fakeid, _noAddApi: true };
      }
      throw e;
    }
  }

  /**
   * 触发公众号文章更新（用于新订阅后首次拉取）
   */
  async updateMp(accessToken, mpId, startPage = 0, endPage = 1) {
    const data = await this._request('GET', `/mps/update/${encodeURIComponent(mpId)}?start_page=${startPage}&end_page=${endPage}`, {
      headers: this._authHeaders(accessToken),
    });
    return data?.data ?? data;
  }

  /** 根据 feed_id 拼接 RSS URL */
  getRssUrl(feedId) {
    return `${this.baseUrl}/feed/${encodeURIComponent(String(feedId))}.rss`;
  }
}
