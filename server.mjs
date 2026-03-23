import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { getDefaultFeeds } from './lib/rss-list.mjs';
import { fetchAllFeeds } from './lib/feeds.mjs';
import { scoreArticles } from './lib/scoring.mjs';
import { summarizeArticles } from './lib/summarize.mjs';
import { generateHighlights, generateReportTitle } from './lib/highlights.mjs';
import { saveDigest, saveArticles, getDigest, getDigestList, setDigestStatus, setDigestHighlights, getStats, createShareToken, getDigestByShareToken, saveRssSources, getRssSources, saveTranslation, getTranslation, getTranslationMap, deleteTranslation, pruneTranslations, pruneOldDigests } from './lib/db.mjs';
import { authMiddleware, initDefaultAdmin, verifyUser, verifySession, getSessionUser, changePassword, getClientIp, isLocked, getRemainingLockTime } from './lib/auth.mjs';
import { saveApiConfig, loadApiConfig, loadApiConfigOrInit, API_PRESETS } from './lib/config.mjs';
import { translateArticle, translateArticleStream, batchTranslateArticles } from './lib/translate.mjs';
import { WeRSSClient } from './lib/werss-client.mjs';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;
// PDF 中文字体路径（需手动放置字体文件，见说明）
const PDF_FONT_PATH = process.env.PDF_FONT_PATH || join(__dirname, 'public', 'fonts', 'NotoSansSC-Regular.otf');
// 全局开关：是否启用文章翻译相关能力（后台预翻译 + 翻译接口）
const ENABLE_TRANSLATION = process.env.ENABLE_TRANSLATION === 'true';

app.use(express.json());

// Lightweight in-memory rate limiter
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60_000; // 1 min window
const RATE_MAX_REQUESTS = 120; // max requests per window

function rateLimit(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let record = rateLimitMap.get(ip);
  if (!record || now - record.windowStart > RATE_WINDOW_MS) {
    record = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, record);
  }
  record.count++;
  if (record.count > RATE_MAX_REQUESTS) {
    return res.status(429).json({ ok: false, error: 'rate_limited', message: '请求过于频繁，请稍后再试' });
  }
  next();
}
app.use(rateLimit);

// Cleanup stale rate limit entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of rateLimitMap) {
    if (now - r.windowStart > RATE_WINDOW_MS * 2) rateLimitMap.delete(ip);
  }
}, 300_000);

initDefaultAdmin();

// Async route wrapper
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Health check (no auth)
app.get('/health', (req, res) => res.send('ok'));

// --- Public share routes (NO auth) ---
// Serve share page HTML
app.get('/share/:token', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'share.html'));
});

app.get('/api/share/:token', (req, res) => {
  const digest = getDigestByShareToken(req.params.token);
  if (!digest || !digest.articles) return res.status(404).json({ ok: false, error: 'not_found' });
  // Strip internal fields, return public data
  const { shareToken, ...publicData } = digest;
  res.json({ ok: true, data: publicData });
});

// 前端「打开公众号管理后台」用：we-mp-rss 仅 HTTP。主站若开 HSTS，浏览器会把「直接打开的」http://同域名:8001 升级为 https。
// 因此按钮改为打开本接口（HTTPS 同域），由服务端 302 到 WERSS_UI_URL（务必为 http://公网IP:8001）；HSTS 不作用于 IP，重定向后可正常访问。
app.get('/api/site-meta', (req, res) => {
  const werssUiUrl = (process.env.WERSS_UI_URL || '').trim() || null;
  res.json({ ok: true, data: { werssUiUrl } });
});

// Auth middleware (after public routes)
app.use(authMiddleware);

// 必须在 authMiddleware 之后注册：该路径在 lib/auth.mjs 中已列入白名单（否则会因 /api/werss/ 前缀被误判为需登录）
app.get('/api/werss/open-ui', (req, res) => {
  const custom = (process.env.WERSS_UI_URL || '').trim();
  if (custom) {
    try {
      const u = new URL(custom);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return res.status(400).type('text/plain').send('WERSS_UI_URL must be http(s) URL');
      }
    } catch {
      return res.status(500).type('text/plain').send('Invalid WERSS_UI_URL');
    }
    return res.redirect(302, custom);
  }
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  const hostname = (host.split(':')[0] || req.hostname || 'localhost').trim() || 'localhost';
  res.redirect(302, `http://${hostname}:8001`);
});

// --- Auth routes ---
app.get('/api/auth/status', (req, res) => {
  const token = req.headers['x-auth-token'];
  const authenticated = token ? verifySession(token) : false;
  const username = authenticated ? getSessionUser(token) : null;
  res.json({ ok: true, needsAuth: true, authenticated, username });
});

app.post('/api/auth/login', (req, res) => {
  const ip = getClientIp(req);
  if (isLocked(ip)) return res.status(429).json({ ok: false, error: 'locked', message: `尝试次数过多，请 ${getRemainingLockTime(ip)} 秒后重试` });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_credentials', message: '请输入用户名和密码' });
  const result = verifyUser(username, password, ip);
  if (result.ok) return res.json({ ok: true, token: result.token, username: result.username });
  if (result.locked) return res.status(429).json({ ok: false, error: 'locked', message: `尝试次数过多，请 ${result.remaining} 秒后重试` });
  res.status(401).json({ ok: false, error: 'wrong_credentials', message: `用户名或密码错误，还剩 ${result.attemptsLeft} 次尝试` });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (!token || !verifySession(token)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const username = getSessionUser(token);
  res.json({ ok: true, username });
});

app.post('/api/auth/change-password', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (!token || !verifySession(token)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const currentUser = getSessionUser(token);
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ ok: false, error: 'missing_fields', message: '请输入旧密码和新密码' });
  if (newPassword.length < 6) return res.status(400).json({ ok: false, error: 'password_too_short', message: '新密码至少 6 个字符' });
  const result = changePassword(currentUser, oldPassword, newPassword);
  if (result.ok) return res.json({ ok: true, message: '密码修改成功' });
  if (result.error === 'wrong_password') return res.status(401).json({ ok: false, error: 'wrong_password', message: '旧密码错误' });
  res.status(400).json({ ok: false, error: result.error, message: '密码修改失败' });
});

// --- Config routes ---
app.get('/api/config', (req, res) => {
  const config = loadApiConfig();
  if (!config) return res.json({ ok: true, data: null });
  const masked = { ...config };
  if (masked.apiKey) masked.apiKeyMasked = masked.apiKey.slice(0, 6) + '***' + masked.apiKey.slice(-4);
  delete masked.apiKey;
  res.json({ ok: true, data: masked });
});

app.post('/api/config', (req, res) => {
  const { preset, apiKey, baseURL, model, schedules } = req.body || {};
  if (!apiKey) return res.status(400).json({ ok: false, error: 'missing_api_key' });
  const config = { preset: preset || 'auto', apiKey, baseURL: baseURL || '', model: model || '', schedules: schedules || [] };
  saveApiConfig(config);
  setupSchedules(config);
  res.json({ ok: true, message: '配置已加密保存' });
});

app.get('/api/presets', (req, res) => res.json({ ok: true, data: API_PRESETS }));

// --- Test API connection ---
app.post('/api/test-connection', asyncHandler(async (req, res) => {
  const { preset, apiKey, baseURL, model } = req.body || {};
  if (!apiKey) return res.status(400).json({ ok: false, error: 'missing_api_key' });

  const apiOpts = {
    preset: preset === 'auto' ? undefined : preset,
    baseURL: baseURL || API_PRESETS[preset]?.baseURL || '',
    model: model || API_PRESETS[preset]?.defaultModel || '',
  };

  try {
    // Import callAI from ai-client
    const { callAI } = await import('./lib/ai-client.mjs');
    // Simple test prompt
    const result = await callAI('Hello, respond with "OK"', apiKey, apiOpts);
    if (result && result.length > 0) {
      res.json({ ok: true, message: 'Connection successful' });
    } else {
      res.json({ ok: false, error: 'Empty response from API' });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message || 'Connection failed' });
  }
}));

// --- Share ---
app.post('/api/digest/share', (req, res) => {
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ ok: false, error: 'missing_date' });
  const token = createShareToken(date);
  if (!token) return res.status(404).json({ ok: false, error: 'digest_not_found' });
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const shareURL = `${protocol}://${host}/share/${token}`;
  res.json({ ok: true, token, url: shareURL });
});

// --- RSS source management ---
app.get('/api/rss-sources', (req, res) => {
  const custom = getRssSources();
  res.json({ ok: true, data: { default: getDefaultFeeds(), custom: custom || [] } });
});

app.post('/api/rss-sources', (req, res) => {
  const { sources } = req.body || {};
  if (!Array.isArray(sources)) return res.status(400).json({ ok: false, error: 'invalid_sources' });
  // Validate sources
  for (const s of sources) {
    if (!s.name || !s.xmlUrl) return res.status(400).json({ ok: false, error: 'invalid_source_format' });
    if (!s.domain) s.domain = 'ai';
  }
  saveRssSources(sources);
  res.json({ ok: true, message: 'RSS 源已保存' });
});

app.post('/api/rss-sources/test', asyncHandler(async (req, res) => {
  const { xmlUrl } = req.body || {};
  if (!xmlUrl) return res.status(400).json({ ok: false, error: 'missing_url' });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(xmlUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AI-Daily-Digest/1.0', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    clearTimeout(timeout);
    if (!response.ok) return res.json({ ok: false, error: `HTTP ${response.status}` });
    const xml = await response.text();
    if (xml.length < 100) return res.json({ ok: false, error: 'Response too short' });
    res.json({ ok: true, message: 'RSS 源可访问' });
  } catch (err) {
    res.json({ ok: false, error: err.message || 'Connection failed' });
  }
}));

// --- we-mp-rss proxy (WeChat MP RSS) ---
const WERSS_BASE_URL = process.env.WERSS_BASE_URL || 'http://localhost:8001';
const WERSS_USERNAME = process.env.WERSS_USERNAME || 'admin';
// we-mp-rss 服务的默认密码（这是 we-mp-rss 项目自身的默认值，非个人密码）
const WERSS_PASSWORD = process.env.WERSS_PASSWORD || 'admin@123';
let werssJwtCache = { token: null, expiresAt: 0 };
const WERSS_JWT_BUFFER_MS = 60_000;

function getWeRSSClient() {
  return new WeRSSClient(WERSS_BASE_URL);
}

async function getWeRSSToken() {
  const now = Date.now();
  if (werssJwtCache.token && werssJwtCache.expiresAt > now + WERSS_JWT_BUFFER_MS) return werssJwtCache.token;
  const client = getWeRSSClient();
  const { accessToken, expiresIn } = await client.login(WERSS_USERNAME, WERSS_PASSWORD);
  werssJwtCache = { token: accessToken, expiresAt: now + (expiresIn || 3600) * 1000 };
  return accessToken;
}

app.get('/api/werss/status', asyncHandler(async (req, res) => {
  const client = getWeRSSClient();
  let connected = false;
  let wxLoggedIn = false;
  let error = null;
  try {
    const token = await getWeRSSToken();
    connected = true;
    try {
      const status = await client.getQrStatus(token);
      wxLoggedIn = status.login_status === true;
    } catch {}
  } catch (e) {
    error = e.message;
  }
  res.json({ ok: true, data: { connected, wxLoggedIn, error } });
}));

app.post('/api/werss/login', asyncHandler(async (req, res) => {
  try {
    await getWeRSSToken();
    res.json({ ok: true, message: '已登录 we-mp-rss' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}));

let werssLastQrPath = '';

app.get('/api/werss/qr/code', asyncHandler(async (req, res) => {
  try {
    const token = await getWeRSSToken();
    const client = getWeRSSClient();
    const data = await client.getQrCode(token);
    const codePath = (typeof data === 'string' ? data : data?.code || data?.url) || '';
    werssLastQrPath = codePath;
    res.json({ ok: true, data: { code: codePath } });
  } catch (e) {
    console.error('[werss] qr/code error:', e.message);
    res.json({ ok: false, error: e.message || '获取二维码失败' });
  }
}));

app.get('/api/werss/qr/image', asyncHandler(async (req, res) => {
  let token;
  try { token = await getWeRSSToken(); } catch (e) {
    return res.status(500).json({ ok: false, error: 'we-mp-rss 登录失败: ' + e.message });
  }
  const base = WERSS_BASE_URL.replace(/\/$/, '');

  async function proxyImage(imgPath) {
    if (!imgPath) return false;
    if (imgPath.startsWith('data:')) {
      const b64 = imgPath.replace(/^data:image\/\w+;base64,/, '');
      res.setHeader('Content-Type', 'image/png');
      res.send(Buffer.from(b64, 'base64'));
      return true;
    }
    const url = imgPath.startsWith('http') ? imgPath : `${base}${imgPath.startsWith('/') ? '' : '/'}${imgPath}`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return false;
      const ct = r.headers.get('Content-Type') || 'image/png';
      if (!ct.startsWith('image/')) return false;
      res.setHeader('Content-Type', ct);
      res.send(Buffer.from(await r.arrayBuffer()));
      return true;
    } catch { return false; }
  }

  if (werssLastQrPath && await proxyImage(werssLastQrPath)) return;

  const client = getWeRSSClient();
  const data = await client.getQrImage(token);
  const imgUrl = (typeof data === 'string' ? data : data?.code || data?.url || data?.is_exists) || '';
  if (typeof imgUrl === 'string' && imgUrl && await proxyImage(imgUrl)) return;

  const fallback = `${base}/static/wx_qrcode.png?t=${Date.now()}`;
  if (await proxyImage(fallback)) return;

  res.status(404).json({ ok: false, error: 'QR code image not available' });
}));

app.get('/api/werss/qr/status', asyncHandler(async (req, res) => {
  try {
    const token = await getWeRSSToken();
    const client = getWeRSSClient();
    const status = await client.getQrStatus(token);
    res.json({ ok: true, data: status });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}));

app.get('/api/werss/search', asyncHandler(async (req, res) => {
  try {
    const kw = req.query.kw || '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);
    const offset = parseInt(req.query.offset, 10) || 0;
    const token = await getWeRSSToken();
    const client = getWeRSSClient();
    const data = await client.searchMp(token, kw, limit, offset);
    res.json({ ok: true, data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}));

app.post('/api/werss/subscribe', asyncHandler(async (req, res) => {
  try {
    const { fakeid, nickname, mp_cover, mp_intro } = req.body || {};
    if (!fakeid) return res.status(400).json({ ok: false, error: 'missing_fakeid' });
    const token = await getWeRSSToken();
    const client = getWeRSSClient();
    const result = await client.subscribeMp(token, { fakeid, nickname, mp_cover, mp_intro });
    const feedId = result.id || fakeid;
    const rssUrl = client.getRssUrl(feedId);
    res.json({ ok: true, data: { feedId, rssUrl, name: nickname || feedId } });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}));

app.get('/api/werss/mps', asyncHandler(async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const kw = (req.query.kw || '').trim();
    const token = await getWeRSSToken();
    const client = getWeRSSClient();
    const data = await client.getMpList(token, limit, offset, kw);
    if (data && Array.isArray(data.list)) {
      data.list = data.list.map(mp => ({ ...mp, rssUrl: client.getRssUrl(mp.id) }));
    }
    res.json({ ok: true, data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}));

// --- WeRSS export: read SQLite DB directly ---
const WERSS_DB_PATH = process.env.WERSS_DB_PATH || join(__dirname, 'we-mp-rss', 'data', 'db.db');
let _sqlJsCache = null;
async function getSqlJs() {
  if (!_sqlJsCache) {
    const { default: initSqlJs } = await import('sql.js');
    _sqlJsCache = await initSqlJs();
  }
  return _sqlJsCache;
}

app.get('/api/werss/export', asyncHandler(async (req, res) => {
  try {
    console.log('[werss/export] DB path:', WERSS_DB_PATH, 'exists:', existsSync(WERSS_DB_PATH));
    if (!existsSync(WERSS_DB_PATH)) {
      return res.json({ ok: false, error: '未找到 we-mp-rss 数据库文件 (' + WERSS_DB_PATH + ')，请确认 we-mp-rss 已启动且数据目录已挂载' });
    }
    const SQL = await getSqlJs();
    const buf = readFileSync(WERSS_DB_PATH);
    const db = new SQL.Database(buf);
    const rows = db.exec("SELECT id, mp_name, mp_cover, mp_intro FROM feeds WHERE status = 1 ORDER BY created_at");
    db.close();

    if (!rows.length || !rows[0].values.length) {
      return res.json({ ok: true, data: { list: [], total: 0 } });
    }

    const base = (process.env.WERSS_RSS_BASE_URL || WERSS_BASE_URL).replace(/\/$/, '');
    const list = rows[0].values.map(([id, name, cover, intro]) => ({
      id, name: name || id, cover: cover || '', intro: intro || '',
      rssUrl: `${base}/feed/${encodeURIComponent(id)}.rss`,
    }));
    res.json({ ok: true, data: { list, total: list.length } });
  } catch (e) {
    console.error('[werss/export] error:', e);
    res.json({ ok: false, error: e.message || String(e) });
  }
}));

// 手动刷新所有公众号最新文章（通过 WeRSSClient 逐个触发更新）
async function handleWeRssRefresh(req, res) {
  try {
    const token = await getWeRSSToken();
    const client = getWeRSSClient();
    const result = await client.refreshAllMps(token);
    console.log(`[werss/refresh] 刷新完成: ${result.updated}/${result.total} 个公众号`);
    res.json({ ok: true, data: result });
  } catch (e) {
    console.error('[werss/refresh] error:', e);
    res.json({ ok: false, error: e.message || String(e) });
  }
}

app.post('/api/werss/refresh', asyncHandler(handleWeRssRefresh));
app.get('/api/werss/refresh', asyncHandler(handleWeRssRefresh));

// --- Per-channel scheduling ---
let scheduleTimers = [];

function setupSchedules(config) {
  // Clear all existing timers
  scheduleTimers.forEach(t => clearInterval(t));
  scheduleTimers = [];

  const schedules = config.schedules || [];
  if (!schedules.length) return;

  const activeSchedules = schedules.filter(s => s.enabled);
  if (!activeSchedules.length) return;

  console.log(`[schedule] Setting up ${activeSchedules.length} schedule(s)`);

  // Single timer checks all schedules every minute
  let lastTriggeredKey = '';
  const timer = setInterval(() => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const triggerKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}_${h * 60 + m}`;

    // Prevent duplicate triggers within the same minute (includes date to allow next-day runs)
    if (triggerKey === lastTriggeredKey) return;

    for (const sched of activeSchedules) {
      if (h === (sched.hour ?? 8) && m === (sched.minute ?? 0)) {
        if (generationState.running) {
          console.log('[schedule] Skipped: generation already running');
          break;
        }
        lastTriggeredKey = triggerKey;
        const cfg = loadApiConfig();
        if (!cfg?.apiKey) continue;

        const preset = sched.preset || cfg.preset || 'auto';
        const apiOpts = {
          preset: preset === 'auto' ? undefined : preset,
          baseURL: sched.baseURL || cfg.baseURL || API_PRESETS[preset]?.baseURL || '',
          model: sched.model || cfg.model || API_PRESETS[preset]?.defaultModel || '',
        };

        console.log(`[schedule] Triggering ${sched.label || sched.preset || 'default'} at ${now.toISOString()}`);
        runDigestGeneration(cfg.apiKey, apiOpts, sched.hours || 48, sched.topN || 15).catch(err => {
          console.error(`[schedule] Failed: ${err.message}`);
        });
        break;
      }
    }
  }, 60000);

  scheduleTimers.push(timer);
  activeSchedules.forEach(s => {
    console.log(`[schedule] ${s.label || s.preset || 'default'}: ${String(s.hour ?? 8).padStart(2, '0')}:${String(s.minute ?? 0).padStart(2, '0')} daily (${s.hours || 48}h, top ${s.topN || 15})`);
  });
}

// Restore schedules on startup (首次启动时自动初始化默认配置)
const savedConfig = loadApiConfigOrInit();
if (savedConfig) setupSchedules(savedConfig);

// ── 每日凌晨 0:00 自动刷新所有公众号文章 ─────────────────────────
let lastMpsRefreshDate = '';
const mpsRefreshTimer = setInterval(async () => {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (h === 0 && m === 0 && lastMpsRefreshDate !== todayKey) {
    lastMpsRefreshDate = todayKey;
    console.log(`[mps-refresh] 开始每日凌晨自动刷新所有公众号 (${now.toISOString()})`);
    try {
      const token = await getWeRSSToken();
      const client = getWeRSSClient();
      const result = await client.refreshAllMps(token);
      console.log(`[mps-refresh] 刷新完成: ${result.updated}/${result.total} 个公众号`);
    } catch (e) {
      console.error(`[mps-refresh] 刷新失败: ${e.message}`);
    }
  }
}, 60000);
scheduleTimers.push(mpsRefreshTimer);
console.log('[mps-refresh] 已启用每日 00:00 自动刷新所有公众号');

// Prune old data on startup (keep 30 days)
setImmediate(() => {
  pruneOldDigests(30);
  const pruned = pruneTranslations(30);
  if (pruned > 0) console.log(`[translate] Pruned ${pruned} expired translations`);
});

// ── 内存监控：每 10 分钟打印内存使用情况 ──────────────────────────
setInterval(() => {
  const mem = process.memoryUsage();
  const rss = (mem.rss / 1024 / 1024).toFixed(1);
  const heap = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const heapTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);
  console.log(`[memory] RSS: ${rss}MB | Heap: ${heap}/${heapTotal}MB | SSE clients: ${sseClients.size} | Rate limit entries: ${rateLimitMap.size}`);
  // 当内存超过 1.2GB 时主动触发 GC（需配合 --expose-gc 启动参数）
  if (mem.rss > 1.2 * 1024 * 1024 * 1024 && typeof global.gc === 'function') {
    console.warn('[memory] RSS > 1.2GB, forcing garbage collection...');
    global.gc();
  }
}, 600_000);

// Static files with cache control
app.use(express.static(join(__dirname, 'public'), {
  maxAge: 0, // Disable caching in development
  etag: false,
  lastModified: false,
}));

// --- SSE for real-time progress ---
const sseClients = new Set();
const SSE_MAX_AGE_MS = 30 * 60 * 1000; // 30 分钟超时自动断开

function broadcastState(state) {
  const data = JSON.stringify(state);
  for (const client of sseClients) {
    try { client.res.write(`data: ${data}\n\n`); } catch { sseClients.delete(client); }
  }
}

function updateGenerationState(patch) {
  Object.assign(generationState, patch);
  broadcastState(generationState);
}

// 定期清理超时的 SSE 连接
setInterval(() => {
  const now = Date.now();
  for (const client of sseClients) {
    if (now - client.connectedAt > SSE_MAX_AGE_MS) {
      try { client.res.end(); } catch {}
      sseClients.delete(client);
    }
  }
}, 60_000);

app.get('/api/status/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify(generationState)}\n\n`);
  const client = { res, connectedAt: Date.now() };
  sseClients.add(client);
  req.on('close', () => sseClients.delete(client));
});

// --- Digest routes ---
let generationState = { running: false, step: '', progress: '', startedAt: null };
let translateState  = { running: false, total: 0, done: 0, current: '' };

app.get('/api/digest/latest', (req, res) => {
  const digest = getDigest(null);
  if (!digest || !digest.articles) return res.json({ ok: false, error: 'no_digest' });
  res.json({ ok: true, data: digest });
});
app.get('/api/digest/:date', (req, res) => {
  const digest = getDigest(req.params.date);
  if (!digest) return res.json({ ok: false, error: 'not_found' });
  res.json({ ok: true, data: digest });
});

// Print-friendly HTML for PDF (user can print to PDF from browser)
app.get('/api/digest/:date/print', (req, res) => {
  const digest = getDigest(req.params.date);
  if (!digest || !digest.articles) return res.status(404).send('Report not found');
  const title = digest.reportTitle || digest.highlights?.slice(0, 25) || digest.date;
  const dateLabel = digest.date ? `${digest.date.slice(0, 4)}年${digest.date.slice(5, 7)}月${digest.date.slice(8, 10)}日` : digest.date;
  const sources = [...new Set(digest.articles.map(a => a.source_name).filter(Boolean))].join('、');
  const printAi = digest.articles.filter(a => a.source_domain !== 'building');
  const printBuilding = digest.articles.filter(a => a.source_domain === 'building');
  let printIdx = 1;
  function renderPrintSection(arts) {
    return arts.map(a => {
      const html = `<div class="article" style="margin-bottom:1.2em;padding-bottom:1em;border-bottom:1px solid #eee;">
      <div style="font-size:0.75rem;color:#666;margin-bottom:0.3em;">${printIdx} · ${escapeHtml(a.source_name || '')}</div>
      <h3 style="font-size:1rem;margin:0 0 0.4em;"><a href="${escapeHtml(a.link)}" style="color:#1a1710;">${escapeHtml(a.title_zh || a.title || '')}</a></h3>
      <p style="font-size:0.85rem;color:#444;margin:0;line-height:1.5;">${escapeHtml((a.summary || '').slice(0, 400))}${(a.summary && a.summary.length > 400) ? '…' : ''}</p>
    </div>`;
      printIdx++;
      return html;
    }).join('');
  }
  let articlesHtml = '';
  if (printAi.length) articlesHtml += `<h3 style="font-size:1rem;margin:1em 0 0.6em;color:#555;">AI 资讯（${printAi.length} 条）</h3>` + renderPrintSection(printAi);
  if (printBuilding.length) articlesHtml += `<h3 style="font-size:1rem;margin:1em 0 0.6em;color:#555;">建筑科技资讯（${printBuilding.length} 条）</h3>` + renderPrintSection(printBuilding);
  if (!printAi.length && !printBuilding.length) articlesHtml = renderPrintSection(digest.articles);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>建筑科技日报 ${digest.date}</title>
<style>body{font-family:'Noto Sans SC',sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1710;line-height:1.6;}
h1{font-size:1.4rem;margin-bottom:0.3em;} .meta{font-size:0.85rem;color:#666;margin-bottom:1.5em;}
.highlights{background:#f5f0e4;padding:1em;border-radius:8px;margin-bottom:1.5em;font-size:0.95rem;}
.sources{font-size:0.8rem;color:#666;margin-top:1.5em;} @media print{body{padding:16px;} a{color:#1a1710;}}</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(dateLabel)}</p>
<div class="highlights"><strong>核心要点</strong><br>${escapeHtml(digest.highlights || '—').replace(/\n/g, '<br>')}</div>
<h2 style="font-size:1.1rem;margin-bottom:0.8em;">详细资讯</h2>
${articlesHtml}
<p class="sources"><strong>资讯来源：</strong>${escapeHtml(sources || '—')}</p>
<p style="margin-top:2em;font-size:0.75rem;color:#999;">建筑科技日报 · 前沿 AI 与建筑科技资讯</p>
</body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.get('/api/digest/:date/pdf', (req, res) => {
  const digest = getDigest(req.params.date);
  if (!digest || !digest.articles) return res.status(404).send('Report not found');

  const date = digest.date || req.params.date;
  const title = digest.reportTitle || digest.highlights?.slice(0, 25) || date;
  const dateLabel = date ? `${date.slice(0, 4)}年${date.slice(5, 7)}月${date.slice(8, 10)}日` : date;
  const safe = (s) => (s == null ? '' : String(s));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="building-tech-daily-${date}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  // 使用支持中文的字体（如 NotoSansSC-Regular.otf），否则中文会乱码
  if (existsSync(PDF_FONT_PATH)) {
    doc.font(PDF_FONT_PATH);
  }
  doc.pipe(res);

  // 标题
  doc.fontSize(20).text('建筑科技日报', { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(12).fillColor('#555555').text(dateLabel || '', { align: 'center' });
  doc.moveDown(1.2);

  // 核心要点
  doc.fillColor('#000000').fontSize(14).text('核心要点', { underline: true });
  doc.moveDown(0.6);
  const highlights = safe(digest.highlights || '暂无摘要');
  doc.fontSize(11).lineGap(4).text(highlights, { align: 'left' });
  doc.moveDown(1.0);

  const aiArticles = digest.articles.filter(a => a.source_domain !== 'building');
  const buildingArticles = digest.articles.filter(a => a.source_domain === 'building');
  let pdfIdx = 1;

  function renderPdfArticles(articles) {
    for (const a of articles) {
      const source = safe(a.source_name || '');
      const titleZh = safe(a.title_zh || a.title || '');
      const summary = safe(a.summary || '');
      const link = safe(a.link || '');

      doc.fontSize(12).fillColor('#000000').text(`${pdfIdx}. ${titleZh}`, { align: 'left' });
      if (source || link) {
        doc.moveDown(0.1);
        doc.fontSize(9).fillColor('#666666').text(
          [source && `来源：${source}`, link && `链接：${link}`].filter(Boolean).join('    '),
          { align: 'left' }
        );
      }
      if (summary) {
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor('#333333').text(summary, { align: 'left', lineGap: 3 });
      }
      doc.moveDown(0.8);
      pdfIdx++;
    }
  }

  if (aiArticles.length) {
    doc.fontSize(14).text(`AI 资讯（${aiArticles.length} 条）`, { underline: true });
    doc.moveDown(0.6);
    renderPdfArticles(aiArticles);
  }
  if (buildingArticles.length) {
    doc.fontSize(14).fillColor('#000000').text(`建筑科技资讯（${buildingArticles.length} 条）`, { underline: true });
    doc.moveDown(0.6);
    renderPdfArticles(buildingArticles);
  }
  if (!aiArticles.length && !buildingArticles.length) {
    doc.fontSize(14).text('详细资讯', { underline: true });
    doc.moveDown(0.6);
    renderPdfArticles(digest.articles);
  }

  doc.end();
});

app.get('/api/digests', (req, res) => res.json({ ok: true, data: getDigestList(30) }));
app.get('/api/stats', (req, res) => res.json({ ok: true, data: getStats() }));

// ── Article translation ───────────────────────────────────────────
function getApiOpts() {
  const config = loadApiConfig();
  const preset = config.preset === 'auto' ? undefined : config.preset;
  return {
    preset,
    apiKey:  config.apiKey  || '',
    baseURL: config.baseURL || '',
    model:   config.model   || API_PRESETS[preset]?.defaultModel || '',
  };
}

// ── Pre-translate all articles after digest generation ────────────
async function preTranslateArticles(articles, apiOpts) {
  const BATCH = 5;
  const toProcess = articles.filter(a => (a.link || a.url));
  console.log(`[translate] Pre-translating ${toProcess.length} articles in batches of ${BATCH}...`);
  translateState = { running: true, total: toProcess.length, done: 0, current: '' };

  for (let i = 0; i < toProcess.length; i += BATCH) {
    const batch = toProcess.slice(i, i + BATCH);
    const batchItems = batch.map(a => ({
      url:   a.link || a.url,
      title: a.title || '',
      desc:  a.description || a.summary || '',
    }));

    const batchLabel = `[${i+1}-${Math.min(i+BATCH, toProcess.length)}/${toProcess.length}]`;
    console.log(`[translate] Batch ${batchLabel}`);

    try {
      await batchTranslateArticles(batchItems, apiOpts);
    } catch (e) {
      console.warn(`[translate] Batch failed, retrying one-by-one: ${e.message}`);
      // Fallback: translate individually if batch fails
      for (const item of batchItems) {
        if (getTranslation(item.url)) continue;
        try {
          await translateArticle(item.url, item.title, item.desc, apiOpts);
        } catch (e2) {
          console.warn(`[translate] Single failed (${item.url.slice(0,50)}): ${e2.message}`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    translateState.done = Math.min(i + BATCH, toProcess.length);
    // 2s between batches
    if (i + BATCH < toProcess.length) await new Promise(r => setTimeout(r, 2000));
  }

  translateState = { running: false, total: toProcess.length, done: toProcess.length, current: '' };
  console.log(`[translate] Pre-translation complete`);
}

// Non-streaming fallback（兼容保留）
app.get('/api/article/translate', asyncHandler(async (req, res) => {
  if (!ENABLE_TRANSLATION) return res.json({ ok: false, error: 'translation_disabled', message: '翻译功能未启用' });
  const { url, title = '', desc = '' } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  const opts = getApiOpts();
  if (!opts.apiKey) return res.status(400).json({ ok: false, error: '请先在设置中配置 API Key' });
  const result = await translateArticle(url, title, desc, opts);
  res.json(result);
}));

// 返回缓存的翻译状态（供前端展示“已翻译”徽标）
app.post('/api/article/translations/status', (req, res) => {
  if (!ENABLE_TRANSLATION) return res.json({ ok: true, data: {} });
  const { urls = [] } = req.body || {};
  const map = getTranslationMap(urls);
  const status = {};
  for (const [url, t] of Object.entries(map)) {
    status[url] = { ok: true, ready: true, url, titleZh: t.titleZh, summary: t.summary, content: t.content || '' };
  }
  res.json({ ok: true, data: status });
});

// 翻译进度（后台预翻译状态）
app.get('/api/translate/progress', (req, res) => {
  if (!ENABLE_TRANSLATION) return res.json({ ok: true, data: { running: false, total: 0, done: 0, current: '' } });
  res.json({ ok: true, data: translateState });
});

// 强制重新翻译
app.post('/api/article/retranslate', asyncHandler(async (req, res) => {
  if (!ENABLE_TRANSLATION) return res.json({ ok: false, error: 'translation_disabled', message: '翻译功能未启用' });
  const { url, title = '', desc = '' } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  const opts = getApiOpts();
  if (!opts.apiKey) return res.status(400).json({ ok: false, error: '请先配置 API Key' });
  deleteTranslation(url);
  const result = await translateArticle(url, title, desc, opts);
  res.json(result);
}));

// SSE 流式翻译接口
app.get('/api/article/translate/stream', async (req, res) => {
  if (!ENABLE_TRANSLATION) {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(`event:error\ndata:${JSON.stringify({ error: '翻译功能未启用' })}\n\n`);
    res.end();
    return;
  }

  const { url, title = '', desc = '' } = req.query;
  if (!url) { res.status(400).end(); return; }
  const opts = getApiOpts();
  if (!opts.apiKey) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`event:error\ndata:${JSON.stringify({ error: '请先在设置中配置 API Key' })}\n\n`);
    res.end(); return;
  }

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });
  res.flushHeaders?.();

  // 心跳保活
  const hb = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => clearInterval(hb));

  try {
    for await (const event of translateArticleStream(
      decodeURIComponent(url), decodeURIComponent(title), decodeURIComponent(desc), opts
    )) {
      res.write(event);
    }
  } catch (e) {
    res.write(`event:error\ndata:${JSON.stringify({ error: e.message })}\n\n`);
  } finally {
    clearInterval(hb);
    res.end();
  }
});
app.get('/api/status', (req, res) => res.json({ ok: true, data: generationState }));

app.post('/api/digest/generate', asyncHandler(async (req, res) => {
  if (generationState.running) return res.json({ ok: false, error: 'already_running', message: '正在生成中' });
  const config = loadApiConfig();
  const apiKey = req.body?.apiKey || config?.apiKey || '';
  if (!apiKey) return res.json({ ok: false, error: 'no_api_key', message: '需要 API Key，请先在设置中配置' });
  const preset = req.body?.preset || config?.preset || 'auto';
  const baseURL = req.body?.baseURL || config?.baseURL || API_PRESETS[preset]?.baseURL || '';
  const model = req.body?.model || config?.model || API_PRESETS[preset]?.defaultModel || '';
  const hours = req.body?.hours || 48;
  const topN = req.body?.topN || 15;
  const apiOpts = { preset: preset === 'auto' ? undefined : preset, baseURL, model };
  res.json({ ok: true, message: '开始生成日报' });
  runDigestGeneration(apiKey, apiOpts, hours, topN).catch(err => {
    console.error('[digest] Generation failed:', err.message);
    updateGenerationState({ running: false, step: 'error', progress: err.message, startedAt: null });
  });
}));

async function runDigestGeneration(apiKey, apiOpts, hours, topN) {
  const dateStr = new Date().toISOString().slice(0, 10);
  updateGenerationState({ running: true, step: 'fetching', progress: '正在抓取 RSS 源...', startedAt: Date.now() });
  try {
    // Use custom RSS sources if available, otherwise use default (AI + 建筑科技)
    const customSources = getRssSources();
    const sources = customSources && customSources.length > 0 ? customSources : getDefaultFeeds();

    console.log(`[digest] 开始生成日报 (${sources.length} 源, ${hours}h, top${topN})`);
    saveDigest(dateStr, { hours, status: 'generating', totalFeeds: sources.length });
    const { articles: allArticles, successCount } = await fetchAllFeeds(sources, (done, total, ok, fail) => {
      updateGenerationState({ progress: `抓取进度: ${done}/${total} 源 (${ok} 成功, ${fail} 失败)` });
    });
    console.log(`[feeds] 共抓取 ${allArticles.length} 篇文章 (${successCount} 源成功)`);
    if (allArticles.length === 0) throw new Error('没有抓取到任何文章');

    // Deduplicate by link URL
    const seen = new Set();
    const dedupedArticles = allArticles.filter(a => {
      const key = a.link?.replace(/\/+$/, '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const dupCount = allArticles.length - dedupedArticles.length;
    if (dupCount > 0) console.log(`[digest] Deduped: ${allArticles.length} → ${dedupedArticles.length} (${dupCount} duplicates removed)`);

    updateGenerationState({ step: 'filtering', progress: '按时间过滤...' });
    const cutoff = new Date(Date.now() - hours * 3600000);
    const recent = dedupedArticles.filter(a => a.pubDate.getTime() > cutoff.getTime());
    if (recent.length === 0) throw new Error(`最近 ${hours} 小时内没有找到文章`);

    console.log(`[scoring] AI 评分中 (${recent.length} 篇)...`);
    updateGenerationState({ step: 'scoring', progress: `AI 评分中 (${recent.length} 篇)...` });
    const scores = await scoreArticles(recent, apiKey, apiOpts, (done, total) => {
      updateGenerationState({ progress: `AI 评分: ${done}/${total} 批次` });
    });

    const scored = recent.map((a, i) => {
      const s = scores.get(i) || { relevance: 5, quality: 5, timeliness: 5, category: 'other', keywords: [] };
      return {
        ...a,
        score: s.relevance + s.quality + s.timeliness,
        score_relevance: s.relevance,
        score_quality: s.quality,
        score_timeliness: s.timeliness,
        category: s.category,
        keywords: s.keywords,
      };
    });
    scored.sort((a, b) => b.score - a.score);

    // 按 RSS 源的 domain 标签分拆（而非 AI 分类），确保分类可控
    const aiCandidates = [];
    const buildingCandidates = [];
    for (const a of scored) {
      if (a.sourceDomain === 'building') buildingCandidates.push(a);
      else aiCandidates.push(a);
    }

    const AI_TOP_N = 10;
    const BUILDING_TOP_N = 5;
    const seenSources = new Set();

    function takePerSource(list, limit) {
      const picked = [];
      for (const a of list) {
        const keyRaw = a.sourceName || a.sourceUrl || a.link || '';
        const key = keyRaw.toLowerCase();
        if (!key || seenSources.has(key)) continue;
        seenSources.add(key);
        picked.push(a);
        if (picked.length >= limit) break;
      }
      return picked;
    }

    const aiTop = takePerSource(aiCandidates, AI_TOP_N);
    const buildingTop = takePerSource(buildingCandidates, BUILDING_TOP_N);
    const top = [...aiTop, ...buildingTop];

    console.log(`[digest] AI资讯: ${aiTop.length} 篇, 建筑科技: ${buildingTop.length} 篇`);
    console.log(`[summarize] 生成摘要 (${top.length} 篇)...`);
    updateGenerationState({ step: 'summarizing', progress: `生成摘要 (${top.length} 篇)...` });

    // 使用连续的 0-based 下标作为摘要索引，避免 AI 重编号导致错位
    const indexed = top.map((a, i) => ({ ...a, index: i }));
    const summaries = await summarizeArticles(indexed, apiKey, apiOpts, (done, total) => {
      updateGenerationState({ progress: `生成摘要: ${done}/${total} 批次` });
    });

    const final = top.map((a, i) => {
      const sm = summaries.get(i) || { titleZh: a.title, summary: a.description?.slice(0, 200) || '', reason: '' };
      return {
        title: a.title, title_zh: sm.titleZh, link: a.link, source_name: a.sourceName, source_url: a.sourceUrl,
        pub_date: a.pubDate?.toISOString?.() || '', description: a.description || '',
        summary: sm.summary, reason: sm.reason, category: a.category, keywords: a.keywords,
        source_domain: a.sourceDomain || 'ai',
        score: a.score, score_relevance: a.score_relevance, score_quality: a.score_quality, score_timeliness: a.score_timeliness,
      };
    });

    console.log('[highlights] 生成今日看点...');
    updateGenerationState({ step: 'highlights', progress: '生成今日看点...' });
    const highlights = await generateHighlights(final.map(a => ({ ...a, titleZh: a.title_zh })), apiKey, apiOpts);

    console.log('[highlights] 生成报告标题...');
    updateGenerationState({ step: 'reportTitle', progress: '生成报告标题...' });
    const reportTitle = await generateReportTitle(final, highlights, apiKey, apiOpts);

    const totalFeeds = sources.length;

    saveDigest(dateStr, {
      highlights, reportTitle, totalFeeds, successFeeds: successCount,
      totalArticles: allArticles.length, filteredArticles: recent.length, hours, status: 'done',
      total_feeds: totalFeeds, success_feeds: successCount,
      total_articles: allArticles.length, filtered_articles: recent.length,
    });
    saveArticles(dateStr, final);
    setDigestHighlights(dateStr, highlights);
    setDigestStatus(dateStr, 'done');
    updateGenerationState({ running: false, step: 'done', progress: `完成！精选 ${final.length} 篇`, startedAt: null });
    console.log(`[digest] Done: ${successCount} sources → ${allArticles.length} → ${recent.length} → ${final.length}`);

    // ── Background pre-translation (non-blocking) ─────────────────
    // 当前产品以中文源为主，默认关闭后台翻译以节省 API 调用
    if (ENABLE_TRANSLATION && apiKey) {
      const preTransOpts = { ...getApiOpts(), apiKey };
      setImmediate(() => preTranslateArticles(final, preTransOpts));
    }
  } catch (err) {
    updateGenerationState({ running: false, step: 'error', progress: err.message, startedAt: null });
    try { setDigestStatus(dateStr, 'error'); } catch (_) {}
    throw err;
  }
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.message, err.stack);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ ok: false, error: 'internal_error', message: err.message || '服务器内部错误' });
  } else {
    res.status(500).send('Internal Server Error');
  }
});

// API error handler — return JSON instead of HTML for /api/* routes
app.use('/api', (err, req, res, _next) => {
  console.error(`[api-error] ${req.method} ${req.originalUrl}:`, err.message || err);
  res.status(err.status || 500).json({ ok: false, error: err.message || 'Internal Server Error' });
});

// SPA fallback — also handle /share/:token on frontend
app.get('*', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`[ai-daily-web] 🚀 http://localhost:${PORT}`);
});
