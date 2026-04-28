/**
 * 抓取并解析微信公众号文章页（mp.weixin.qq.com/s/...）。
 * 返回结构化"块"列表，供 docx-builder 顺序渲染。
 *
 * 反风控策略（小工具规模够用）：
 *   - 顺序串行（concurrency = 1）
 *   - 每篇之间随机 1500-3000ms 延时
 *   - 失败重试 1 次
 */

import { parse as parseHtml } from 'node-html-parser';

const FETCH_TIMEOUT_MS = 20_000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 抓取并解析单篇文章
 * @param {string} url 微信文章 URL
 * @returns {Promise<{ok:true, title, author, account, publishTime, blocks}|{ok:false, error, deleted?:boolean}>}
 */
export async function scrapeArticle(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'invalid_url' };
  }

  let html;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    return { ok: false, error: `fetch_failed: ${e.message}` };
  }

  // 文章被删除/违规：页面会有特定文案
  const deletedHint = detectDeleted(html);
  if (deletedHint) {
    return { ok: false, error: deletedHint, deleted: true };
  }

  return parseArticleHtml(html);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://mp.weixin.qq.com/',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function detectDeleted(html) {
  if (!html) return null;
  if (html.includes('该内容已被发布者删除')) return '文章已被作者删除';
  if (html.includes('此内容因违规无法查看') || html.includes('内容因违规')) return '文章因违规已被屏蔽';
  if (html.includes('环境异常') && html.includes('完成验证')) return '触发风控，需稍后重试';
  return null;
}

/**
 * 给定 HTML 字符串，解析出结构化文章。
 * 单独导出方便测试。
 */
export function parseArticleHtml(html) {
  let root;
  try {
    root = parseHtml(html, {
      lowerCaseTagName: false,
      blockTextElements: { script: true, noscript: true, style: true, pre: true },
    });
  } catch (e) {
    return { ok: false, error: `parse_failed: ${e.message}` };
  }

  const title = pickTitle(root);
  const author = pickAuthor(root);
  const account = pickAccount(root);
  const publishTime = pickPublishTime(root);

  const contentEl =
    root.querySelector('#js_content') ||
    root.querySelector('.rich_media_content') ||
    root.querySelector('#page-content');

  if (!contentEl) {
    return { ok: false, error: 'content_not_found' };
  }

  const blocks = extractBlocks(contentEl);
  if (blocks.length === 0) {
    return { ok: false, error: 'empty_content' };
  }

  return {
    ok: true,
    title: title || '(无标题)',
    author: author || '',
    account: account || '',
    publishTime: publishTime || '',
    blocks,
  };
}

function pickTitle(root) {
  const h1 = root.querySelector('#activity-name') || root.querySelector('h1.rich_media_title');
  if (h1) return cleanText(h1.text);
  const og = root.querySelector('meta[property="og:title"]');
  if (og) return (og.getAttribute('content') || '').trim();
  const t = root.querySelector('title');
  return t ? cleanText(t.text) : '';
}

function pickAuthor(root) {
  const byMeta = root.querySelector('meta[name="author"]');
  if (byMeta) return (byMeta.getAttribute('content') || '').trim();
  const byEl = root.querySelector('#js_author_name') || root.querySelector('.rich_media_meta_text');
  return byEl ? cleanText(byEl.text) : '';
}

function pickAccount(root) {
  const byMeta = root.querySelector('meta[property="og:article:author"]');
  if (byMeta) return (byMeta.getAttribute('content') || '').trim();
  const byEl = root.querySelector('#js_name') || root.querySelector('.profile_nickname');
  return byEl ? cleanText(byEl.text) : '';
}

function pickPublishTime(root) {
  const el = root.querySelector('#publish_time') || root.querySelector('em.rich_media_meta_text');
  if (el) {
    const t = cleanText(el.text);
    if (t) return t;
  }
  // 微信现在很多发布时间在 JS 里（`var publish_time = "2026-04-10"`）；尝试从 script 里抠出来
  const scripts = root.querySelectorAll('script');
  for (const s of scripts) {
    const m = s.text.match(/var\s+publish_time\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
    const m2 = s.text.match(/createTime\s*=\s*["']?(\d{4}-\d{2}-\d{2}[^"']*)/);
    if (m2) return m2[1];
  }
  return '';
}

/**
 * 把内容根节点拍平成 [{type: 'paragraph'|'image'|'heading', ...}]
 */
function extractBlocks(rootEl) {
  const blocks = [];
  let buffer = [];

  const flush = () => {
    const text = cleanText(buffer.join(''));
    if (text) blocks.push({ type: 'paragraph', text });
    buffer = [];
  };

  const BLOCK_TAGS = new Set([
    'p', 'div', 'section', 'blockquote', 'li', 'tr', 'td', 'th',
    'pre', 'figure', 'article', 'header', 'footer', 'aside', 'main',
  ]);

  function walk(node) {
    if (!node) return;

    // 文本节点：node-html-parser 用 nodeType 3 表示文本
    if (node.nodeType === 3) {
      const t = node.rawText || node.text || '';
      if (t) buffer.push(t);
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = String(node.tagName || '').toLowerCase();

    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;

    if (tag === 'img') {
      flush();
      const url =
        node.getAttribute('data-src') ||
        node.getAttribute('data-original') ||
        node.getAttribute('src') ||
        '';
      const alt = node.getAttribute('alt') || '';
      if (url) blocks.push({ type: 'image', url, alt });
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      flush();
      const text = cleanText(node.text || '');
      if (text) blocks.push({ type: 'heading', level: Number(tag[1]), text });
      return;
    }

    if (tag === 'br' || tag === 'hr') {
      flush();
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      flush();
      for (const child of node.childNodes) walk(child);
      flush();
      return;
    }

    // 行内元素：继续递归，文本累积到 buffer
    for (const child of node.childNodes) walk(child);
  }

  walk(rootEl);
  flush();
  return dedupAdjacent(blocks);
}

function dedupAdjacent(blocks) {
  const out = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (
      last &&
      b.type === 'paragraph' &&
      last.type === 'paragraph' &&
      last.text === b.text
    ) {
      continue;
    }
    if (
      last &&
      b.type === 'image' &&
      last.type === 'image' &&
      last.url === b.url
    ) {
      continue;
    }
    out.push(b);
  }
  return out;
}

function cleanText(s) {
  if (!s) return '';
  return decodeEntities(String(s))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => {
      try { return String.fromCharCode(parseInt(code, 10)); } catch { return ''; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      try { return String.fromCharCode(parseInt(code, 16)); } catch { return ''; }
    });
}

/** 给"批量"用：按顺序爬，每篇之间随机延时；失败重试 1 次 */
export async function scrapeArticlesSequential(items, { onItem, signal } = {}) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break;
    const item = items[i];
    let result = await scrapeArticle(item.url);
    if (!result.ok && !result.deleted) {
      // 重试一次
      await sleep(1500);
      result = await scrapeArticle(item.url);
    }
    results.push({ ...item, result });
    if (onItem) onItem(i + 1, items.length, item, result);
    if (i < items.length - 1) await sleep(randomBetween(1500, 3000));
  }
  return results;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
