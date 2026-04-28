/**
 * 直接读取 we-mp-rss 的本地 SQLite（db.db），按公众号 + 时间范围过滤文章。
 *
 * we-mp-rss 的 articles 表常见字段（不同版本略有差异）：
 *   id, mp_id, title, pic_url, url, description, publish_time(Unix 秒),
 *   status, created_at, updated_at, updated_at_millis, is_export, is_read
 *
 * 由于 sql.js 在 Node 环境下需要把 wasm 文件路径告诉它，这里用 createRequire
 * 拿到 sql.js 的 dist 目录后再传 locateFile。
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

let _SQL = null;
async function getSqlJs() {
  if (_SQL) return _SQL;
  const initSqlJs = (await import('sql.js')).default;
  // sql.js 的 main 字段指向 ./dist/sql-wasm.js，require.resolve('sql.js') 拿到的就是入口 js，
  // 它所在目录即 dist 目录，里面有 sql-wasm.wasm。
  // 注意：不能用 require.resolve('sql.js/package.json')，因为 sql.js 的 exports 字段不暴露 ./package.json。
  const entry = require.resolve('sql.js');
  const distDir = path.dirname(entry);
  _SQL = await initSqlJs({
    locateFile: (file) => path.join(distDir, file),
  });
  return _SQL;
}

/**
 * 打开 SQLite 数据库（每次按需读最新文件 → 拿到最新数据）。
 * 注意：we-mp-rss 写入是异步的，刚刚刷新的文章可能 1~2 秒后才能查到。
 */
async function openDb(dbPath) {
  if (!existsSync(dbPath)) {
    throw new Error(`未找到 we-mp-rss 数据库文件: ${dbPath}（确认 docker compose up -d 后已成功扫码登录并订阅过公众号）`);
  }
  const SQL = await getSqlJs();
  const buf = readFileSync(dbPath);
  return new SQL.Database(buf);
}

/**
 * 列出 we-mp-rss 已订阅的公众号（如果不想走 HTTP，可以直接读库；目前主要走 HTTP）
 */
export async function listMpsFromDb(dbPath) {
  const db = await openDb(dbPath);
  try {
    const rows = db.exec(`
      SELECT id, mp_name, mp_cover, mp_intro, status
      FROM feeds
      WHERE status = 1
      ORDER BY created_at
    `);
    if (!rows.length || !rows[0].values.length) return [];
    return rows[0].values.map(([id, name, cover, intro, status]) => ({
      id,
      mp_name: name || id,
      mp_cover: cover || '',
      mp_intro: intro || '',
      status,
    }));
  } finally {
    db.close();
  }
}

/**
 * 查询指定公众号 + 时间范围内的文章。
 * @param {string} dbPath  SQLite 文件路径
 * @param {object} opts
 * @param {string[]} opts.mpIds 公众号 id 列表
 * @param {Date|number} opts.start 起始时间（含），Date 或 ms 时间戳
 * @param {Date|number} opts.end   结束时间（含），Date 或 ms 时间戳
 * @returns {Promise<Array<{id, mp_id, mp_name, title, url, pic_url, description, publishedAt: Date}>>}
 */
export async function queryArticles(dbPath, { mpIds, start, end }) {
  if (!Array.isArray(mpIds) || mpIds.length === 0) return [];

  const startSec = Math.floor(toMs(start) / 1000);
  const endSec = Math.floor(toMs(end) / 1000);

  const db = await openDb(dbPath);
  try {
    const placeholders = mpIds.map(() => '?').join(',');
    // 用 LEFT JOIN 把公众号名带出来
    const sql = `
      SELECT a.id, a.mp_id, f.mp_name, a.title, a.url, a.pic_url, a.description, a.publish_time
      FROM articles a
      LEFT JOIN feeds f ON f.id = a.mp_id
      WHERE a.mp_id IN (${placeholders})
        AND a.publish_time BETWEEN ? AND ?
        AND (a.status IS NULL OR a.status = 1)
      ORDER BY a.mp_id, a.publish_time DESC
    `;
    const stmt = db.prepare(sql);
    stmt.bind([...mpIds, startSec, endSec]);
    const out = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push({
        id: row.id,
        mp_id: row.mp_id,
        mp_name: row.mp_name || row.mp_id,
        title: row.title || '(无标题)',
        url: row.url || '',
        pic_url: row.pic_url || '',
        description: row.description || '',
        publishedAt: new Date(Number(row.publish_time) * 1000),
      });
    }
    stmt.free();
    return out;
  } finally {
    db.close();
  }
}

/**
 * 给定 mpIds + 时间范围，按公众号分组返回文章数量与标题列表（用于"预览"）
 */
export async function previewArticles(dbPath, { mpIds, start, end }) {
  const articles = await queryArticles(dbPath, { mpIds, start, end });
  const groups = new Map();
  for (const a of articles) {
    if (!groups.has(a.mp_id)) {
      groups.set(a.mp_id, { mpId: a.mp_id, mpName: a.mp_name, articles: [] });
    }
    groups.get(a.mp_id).articles.push({
      id: a.id,
      title: a.title,
      url: a.url,
      publishedAt: a.publishedAt.toISOString(),
    });
  }
  // 保持 mpIds 入参顺序
  return mpIds.map(
    (id) => groups.get(id) || { mpId: id, mpName: id, articles: [] }
  );
}

function toMs(t) {
  if (t instanceof Date) return t.getTime();
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error('Invalid time: ' + t);
  // 如果传进来是秒级（小于 1e12），自动 ×1000
  return n < 1e12 ? n * 1000 : n;
}

/**
 * 简单探测库文件可读性 / 大小（启动时 sanity check 用）
 */
export function describeDbFile(dbPath) {
  if (!existsSync(dbPath)) {
    return { exists: false, path: dbPath };
  }
  const s = statSync(dbPath);
  return { exists: true, path: dbPath, size: s.size, mtime: s.mtime };
}
