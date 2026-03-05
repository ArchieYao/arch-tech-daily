import { createHash, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const AUTH_FILE = join(DATA_DIR, 'auth.json');

mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_USERNAME = process.env.ADMIN_USERNAME || 'archie';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const sessions = new Map();

function hashPassword(password, salt) {
  return createHash('sha256').update(salt + password).digest('hex');
}

function loadAuth() {
  if (!existsSync(AUTH_FILE)) return null;
  try { return JSON.parse(readFileSync(AUTH_FILE, 'utf-8')); } catch { return null; }
}

function saveAuth(data) {
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

function ensureUsersFormat(auth) {
  if (auth && Array.isArray(auth.users)) return auth;
  if (auth && auth.salt && auth.hash) {
    return { users: [{ username: 'admin', salt: auth.salt, hash: auth.hash }] };
  }
  return { users: [] };
}

function findUser(auth, username) {
  const data = ensureUsersFormat(auth);
  return data.users.find(u => u.username === username) || null;
}

export function initDefaultAdmin() {
  let auth = loadAuth();
  const data = ensureUsersFormat(auth);
  if (data.users.length === 0) {
    const salt = randomBytes(16).toString('hex');
    const hash = hashPassword(DEFAULT_PASSWORD, salt);
    data.users.push({ username: DEFAULT_USERNAME, salt, hash });
    saveAuth(data);
    console.log(`[auth] Default admin created: ${DEFAULT_USERNAME}`);
  } else if (auth && auth.salt && auth.hash && !Array.isArray(auth.users)) {
    saveAuth(data);
    console.log('[auth] Migrated legacy auth format to users array');
  }
}

export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

export function isLocked(ip) {
  const record = failedAttempts.get(ip);
  if (!record) return false;
  if (record.lockedUntil && Date.now() < record.lockedUntil) return true;
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    failedAttempts.delete(ip);
    return false;
  }
  return false;
}

export function getRemainingLockTime(ip) {
  const record = failedAttempts.get(ip);
  if (!record?.lockedUntil) return 0;
  return Math.max(0, Math.ceil((record.lockedUntil - Date.now()) / 1000));
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, lastAttempt: 0, lockedUntil: null };
  if (now - record.lastAttempt > ATTEMPT_WINDOW_MS) record.count = 0;
  record.count++;
  record.lastAttempt = now;
  if (record.count >= MAX_ATTEMPTS) record.lockedUntil = now + LOCK_DURATION_MS;
  failedAttempts.set(ip, record);
}

function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

export function verifyUser(username, password, ip) {
  if (isLocked(ip)) return { ok: false, locked: true, remaining: getRemainingLockTime(ip) };

  const auth = loadAuth();
  if (!auth) return { ok: false, error: 'no_users' };

  const user = findUser(auth, username);
  if (!user) {
    recordFailedAttempt(ip);
    const record = failedAttempts.get(ip);
    return { ok: false, attemptsLeft: Math.max(0, MAX_ATTEMPTS - (record?.count || 0)), locked: isLocked(ip), remaining: getRemainingLockTime(ip) };
  }

  const hash = hashPassword(password, user.salt);
  if (hash === user.hash) {
    clearFailedAttempts(ip);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { ip, username: user.username, createdAt: Date.now() });
    return { ok: true, token, username: user.username };
  }

  recordFailedAttempt(ip);
  const record = failedAttempts.get(ip);
  return { ok: false, attemptsLeft: Math.max(0, MAX_ATTEMPTS - (record?.count || 0)), locked: isLocked(ip), remaining: getRemainingLockTime(ip) };
}

export function changePassword(username, oldPassword, newPassword) {
  const auth = loadAuth();
  if (!auth) return { ok: false, error: 'no_users' };

  const data = ensureUsersFormat(auth);
  const user = data.users.find(u => u.username === username);
  if (!user) return { ok: false, error: 'user_not_found' };

  const oldHash = hashPassword(oldPassword, user.salt);
  if (oldHash !== user.hash) return { ok: false, error: 'wrong_password' };

  if (!newPassword || newPassword.length < 6) return { ok: false, error: 'password_too_short' };

  const salt = randomBytes(16).toString('hex');
  user.salt = salt;
  user.hash = hashPassword(newPassword, salt);
  saveAuth(data);
  return { ok: true };
}

export function verifySession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function getSessionUser(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session.username || null;
}

const ADMIN_API_PREFIXES = [
  '/api/config', '/api/rss-sources', '/api/digest/generate', '/api/digest/share',
  '/api/werss/', '/api/test-connection', '/api/presets',
  '/api/article/translate', '/api/article/retranslate', '/api/article/translations',
  '/api/translate/', '/api/auth/change-password', '/api/auth/me',
];

function isAdminApi(path) {
  for (const prefix of ADMIN_API_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  if (path === '/api/rss-sources') return true;
  return false;
}

export function authMiddleware(req, res, next) {
  if (req.path === '/api/auth/login' || req.path === '/api/auth/status') return next();

  if (!req.path.startsWith('/api/')) return next();

  if (!isAdminApi(req.path)) return next();

  const token = req.headers['x-auth-token'] || req.query?.token;
  if (verifySession(token)) return next();

  return res.status(401).json({ ok: false, error: 'unauthorized', message: '请先登录管理后台' });
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
  for (const [ip, record] of failedAttempts) {
    if (record.lockedUntil && now > record.lockedUntil + ATTEMPT_WINDOW_MS) failedAttempts.delete(ip);
  }
}, 60000);
