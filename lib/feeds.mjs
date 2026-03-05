const FEED_FETCH_TIMEOUT_MS = 15_000;
const FEED_CONCURRENCY = 10;

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .trim();
}

function extractCDATA(text) {
  const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : text;
}

function getTagContent(xml, tagName) {
  const patterns = [
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'),
    new RegExp(`<${tagName}[^>]*/>`, 'i'),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m?.[1]) return extractCDATA(m[1]).trim();
  }
  return '';
}

function getAttrValue(xml, tagName, attrName) {
  const p = new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']*)["'][^>]*/?>`, 'i');
  const m = xml.match(p);
  return m?.[1] || '';
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function parseRSSItems(xml) {
  const items = [];
  const isAtom = xml.includes('<feed') && (xml.includes('xmlns="http://www.w3.org/2005/Atom"') || xml.includes('<feed '));

  if (isAtom) {
    const re = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const e = m[1];
      const title = stripHtml(getTagContent(e, 'title'));
      let link = getAttrValue(e, 'link[^>]*rel="alternate"', 'href');
      if (!link) link = getAttrValue(e, 'link', 'href');
      const pubDate = getTagContent(e, 'published') || getTagContent(e, 'updated');
      const description = stripHtml(getTagContent(e, 'summary') || getTagContent(e, 'content'));
      if (title || link) items.push({ title, link, pubDate, description: description.slice(0, 500) });
    }
  } else {
    const re = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const e = m[1];
      const title = stripHtml(getTagContent(e, 'title'));
      const link = getTagContent(e, 'link') || getTagContent(e, 'guid');
      const pubDate = getTagContent(e, 'pubDate') || getTagContent(e, 'dc:date') || getTagContent(e, 'date');
      const description = stripHtml(getTagContent(e, 'description') || getTagContent(e, 'content:encoded'));
      if (title || link) items.push({ title, link, pubDate, description: description.slice(0, 500) });
    }
  }
  return items;
}

async function fetchFeedOnce(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feed.xmlUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AI-Daily-Digest/1.0', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseRSSItems(xml).map(item => ({
      title: item.title, link: item.link,
      pubDate: parseDate(item.pubDate) || new Date(0),
      description: item.description,
      sourceName: feed.name, sourceUrl: feed.htmlUrl,
      sourceDomain: feed.domain || 'ai',
    }));
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const FEED_MAX_RETRIES = 1;

async function fetchFeed(feed) {
  for (let attempt = 0; attempt <= FEED_MAX_RETRIES; attempt++) {
    try {
      return await fetchFeedOnce(feed);
    } catch (err) {
      if (attempt < FEED_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      console.warn(`[feeds] ${feed.name} failed after ${attempt + 1} attempts: ${err.message}`);
      return [];
    }
  }
  return [];
}

export async function fetchAllFeeds(feeds, onProgress) {
  const all = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < feeds.length; i += FEED_CONCURRENCY) {
    const batch = feeds.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchFeed));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.length > 0) { all.push(...r.value); ok++; } else { fail++; }
    }
    if (onProgress) onProgress(Math.min(i + FEED_CONCURRENCY, feeds.length), feeds.length, ok, fail);
  }
  return { articles: all, successCount: ok, failCount: fail };
}
