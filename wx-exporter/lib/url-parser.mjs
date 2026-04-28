/**
 * 微信文章 URL 解析 / 规范化工具。
 *
 * 两种合法形态：
 *   1. 短链：  https://mp.weixin.qq.com/s/<token>          (token 由字母数字和 -_ 组成)
 *   2. 长链：  https://mp.weixin.qq.com/s?__biz=...&mid=...&idx=...&sn=...[&chksm=...]
 *
 * 规范化规则（用于前后端统一去重）：
 *   - 强制 https
 *   - host 固定 mp.weixin.qq.com
 *   - 丢掉 fragment 和所有非核心 query
 *   - 长链仅保留 __biz / mid / idx / sn / chksm 五个参数，且按字母序排序
 *   - 短链丢弃所有 query
 */

const HOST = 'mp.weixin.qq.com';
const CORE_QUERY_KEYS = ['__biz', 'mid', 'idx', 'sn', 'chksm'];

/**
 * 规范化一条 URL；不合法则返回 null。
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeArticleUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^[<(\[]+|[>)\].,;]+$/g, '');
  if (!trimmed) return null;

  // 补全协议
  const withProto = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^mp\.weixin\.qq\.com/i.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (!withProto) return null;

  let u;
  try { u = new URL(withProto); } catch { return null; }

  if (u.hostname.toLowerCase() !== HOST) return null;

  const path = u.pathname;
  // 短链 /s/<token>
  const shortMatch = path.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
  if (shortMatch) {
    return `https://${HOST}/s/${shortMatch[1]}`;
  }

  // 长链 /s
  if (path === '/s' || path === '/s/') {
    const params = u.searchParams;
    const biz = params.get('__biz');
    const mid = params.get('mid');
    const idx = params.get('idx');
    const sn = params.get('sn');
    if (!biz || !mid || !idx || !sn) return null;
    const kept = new URLSearchParams();
    for (const key of CORE_QUERY_KEYS) {
      const v = params.get(key);
      if (v) kept.set(key, v);
    }
    return `https://${HOST}/s?${kept.toString()}`;
  }

  return null;
}

/**
 * 批量解析一段文本（或字符串数组）。
 * 拆分规则：按换行 / 逗号 / 空白分隔。
 *
 * @param {string|string[]} input
 * @param {object} [opts]
 * @param {Set<string>} [opts.existing]  已有的规范化 URL 集合，用于跨批次去重
 * @returns {{
 *   valid: Array<{raw: string, normalized: string}>,
 *   invalid: Array<{raw: string, reason: string}>,
 *   duplicates: Array<{raw: string, normalized: string}>
 * }}
 */
export function parseArticleUrlBatch(input, opts = {}) {
  const existing = opts.existing instanceof Set ? opts.existing : new Set();
  const text = Array.isArray(input) ? input.join('\n') : String(input || '');

  const pieces = text
    .split(/[\s,，、；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set(existing);
  const valid = [];
  const invalid = [];
  const duplicates = [];

  for (const piece of pieces) {
    const normalized = normalizeArticleUrl(piece);
    if (!normalized) {
      invalid.push({ raw: piece, reason: '不是合法的微信公众号文章链接' });
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.push({ raw: piece, normalized });
      continue;
    }
    seen.add(normalized);
    valid.push({ raw: piece, normalized });
  }

  return { valid, invalid, duplicates };
}
