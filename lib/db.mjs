import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'digests.json');

mkdirSync(DATA_DIR, { recursive: true });

// In-memory cache with dirty flag
let dbCache = null;
let isDirty = false;

function load() {
  if (dbCache) return dbCache;
  if (!existsSync(DB_FILE)) {
    dbCache = { digests: {} };
    return dbCache;
  }
  try {
    dbCache = JSON.parse(readFileSync(DB_FILE, 'utf-8'));
    return dbCache;
  } catch {
    dbCache = { digests: {} };
    return dbCache;
  }
}

function save(data) {
  dbCache = data;
  isDirty = true;
}

function flush() {
  if (!isDirty || !dbCache) return;
  try {
    writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2));
    isDirty = false;
  } catch (err) {
    console.error('[db] Flush failed:', err.message);
  }
}

// Flush dirty writes every 5 seconds
setInterval(flush, 5000);

// ── 定期清理旧数据，防止内存无限增长 ────────────────────────────
const DIGEST_KEEP_DAYS = 30;

/** 清理超过 keepDays 天的日报文章数据（保留摘要元信息，移除大体积的 articles 数组） */
export function pruneOldDigests(keepDays = DIGEST_KEEP_DAYS) {
  const db = load();
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
  let pruned = 0;
  for (const [date, digest] of Object.entries(db.digests)) {
    if (date < cutoff && digest.articles) {
      delete digest.articles; // 释放大体积文章数据
      pruned++;
    }
  }
  if (pruned > 0) {
    save(db);
    console.log(`[db] Pruned articles from ${pruned} old digests (older than ${keepDays} days)`);
  }
  return pruned;
}

// 每 6 小时自动清理旧日报 + 翻译缓存
setInterval(() => {
  pruneOldDigests(DIGEST_KEEP_DAYS);
  const prunedTrans = pruneTranslations(DIGEST_KEEP_DAYS);
  if (prunedTrans > 0) console.log(`[db] Periodic prune: ${prunedTrans} expired translations removed`);
}, 6 * 3600_000);

// Flush on process exit
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

export function saveDigest(date, data) {
  const db = load();
  const existing = db.digests[date] || {};
  db.digests[date] = { ...existing, ...data, date, updatedAt: new Date().toISOString() };
  if (!db.digests[date].createdAt) db.digests[date].createdAt = new Date().toISOString();
  save(db);
  return date;
}

export function saveArticles(digestDate, articles) {
  const db = load();
  if (!db.digests[digestDate]) db.digests[digestDate] = { date: digestDate };
  db.digests[digestDate].articles = articles;
  save(db);
}

export function getDigest(date) {
  const db = load();
  if (date) return db.digests[date] || null;
  const dates = Object.keys(db.digests).sort().reverse();
  return dates.length ? db.digests[dates[0]] : null;
}

export function createShareToken(date) {
  const db = load();
  const digest = db.digests[date];
  if (!digest) return null;
  if (digest.shareToken) return digest.shareToken;
  const token = randomBytes(16).toString('hex');
  digest.shareToken = token;
  if (!db.shareIndex) db.shareIndex = {};
  db.shareIndex[token] = date;
  save(db);
  return token;
}

export function getDigestByShareToken(token) {
  const db = load();
  if (!db.shareIndex) return null;
  const date = db.shareIndex[token];
  if (!date) return null;
  return db.digests[date] || null;
}

export function getDigestList(limit = 30) {
  const db = load();
  return Object.values(db.digests)
    .map(d => {
      const reportTitle = d.reportTitle || (d.highlights ? d.highlights.slice(0, 25) : '') || d.date;
      return {
        date: d.date,
        report_title: reportTitle,
        status: d.status,
        total_articles: d.totalArticles,
        filtered_articles: d.filteredArticles,
        created_at: d.createdAt,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export function setDigestStatus(date, status) {
  const db = load();
  if (db.digests[date]) { db.digests[date].status = status; save(db); }
}

export function setDigestHighlights(date, highlights) {
  const db = load();
  if (db.digests[date]) { db.digests[date].highlights = highlights; save(db); }
}

export function getStats() {
  const db = load();
  const all = Object.values(db.digests);
  const done = all.filter(d => d.status === 'done');
  const totalArticles = done.reduce((sum, d) => sum + (d.articles?.length || 0), 0);
  const latest = all.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return { totalDigests: done.length, totalArticles, latestDate: latest?.date || null, latestStatus: latest?.status || null };
}

// ── Translation cache ─────────────────────────────────────────────
export function saveTranslation(url, data) {
  const db = load();
  if (!db.translations) db.translations = {};
  db.translations[url] = { ...data, cachedAt: new Date().toISOString() };
  save(db);
}

export function getTranslation(url) {
  const db = load();
  return db.translations?.[url] || null;
}

export function getTranslationMap(urls) {
  const db = load();
  const map = {};
  for (const url of urls) {
    if (db.translations?.[url]) map[url] = db.translations[url];
  }
  return map;
}

export function deleteTranslation(url) {
  const db = load();
  if (db.translations?.[url]) {
    delete db.translations[url];
    save(db);
    return true;
  }
  return false;
}

export function pruneTranslations(keepDays = 30) {
  const db = load();
  if (!db.translations) return 0;
  const cutoff = Date.now() - keepDays * 86400000;
  let pruned = 0;
  for (const [url, t] of Object.entries(db.translations)) {
    if (t.cachedAt && new Date(t.cachedAt).getTime() < cutoff) {
      delete db.translations[url];
      pruned++;
    }
  }
  if (pruned > 0) save(db);
  return pruned;
}

// RSS source management
export function saveRssSources(sources) {
  const db = load();
  db.rssSources = sources;
  save(db);
}

export function getRssSources() {
  const db = load();
  return db.rssSources || null;
}
