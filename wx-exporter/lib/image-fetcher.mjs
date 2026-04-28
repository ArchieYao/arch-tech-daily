/**
 * 下载微信文章正文里的图片（mmbiz.qpic.cn 等域名）。
 * 关键点：
 *   - 必须带 Referer: https://mp.weixin.qq.com/，否则 403
 *   - WeChat 的 .../0、.../wx_fmt=png 这种 URL 没有"扩展名"，需要靠 wx_fmt 参数或 Content-Type 推断
 *   - 控制最大尺寸，避免某些异常超大图把 docx 撑炸
 */

const FETCH_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB 上限
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 下载一张图片。
 * @returns {Promise<{ok:true, buffer:Buffer, mime:string, ext:string, width?:number, height?:number}|{ok:false, error:string}>}
 */
export async function fetchImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'invalid_url' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: 'https://mp.weixin.qq.com/',
      },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return { ok: false, error: 'empty_body' };
    if (buf.length > MAX_IMAGE_BYTES) {
      return { ok: false, error: `image_too_large(${buf.length}B)` };
    }

    const { mime, ext } = inferMime(buf, contentType, url);
    if (!mime) return { ok: false, error: `unknown_mime(${contentType})` };

    return { ok: true, buffer: buf, mime, ext };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 优先用 magic bytes 判定 mime，再退化到 Content-Type 与 URL 参数。
 * 仅识别 docx 内嵌图片支持的格式：jpeg / png / gif / bmp。webp 转 unknown 让上层跳过或单独处理。
 */
function inferMime(buf, contentType, url) {
  const head = buf.subarray(0, 12);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // GIF: 47 49 46 38
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  // BMP: 42 4D
  if (head[0] === 0x42 && head[1] === 0x4d) {
    return { mime: 'image/bmp', ext: 'bmp' };
  }
  // WEBP: RIFF....WEBP
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  // 退化：用响应头
  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (contentType.includes('png')) return { mime: 'image/png', ext: 'png' };
  if (contentType.includes('gif')) return { mime: 'image/gif', ext: 'gif' };
  if (contentType.includes('webp')) return { mime: 'image/webp', ext: 'webp' };

  // URL 参数 wx_fmt=png/jpeg/gif
  const m = url.match(/wx_fmt=([a-z]+)/i);
  if (m) {
    const fmt = m[1].toLowerCase();
    if (fmt === 'jpeg' || fmt === 'jpg') return { mime: 'image/jpeg', ext: 'jpg' };
    if (fmt === 'png') return { mime: 'image/png', ext: 'png' };
    if (fmt === 'gif') return { mime: 'image/gif', ext: 'gif' };
    if (fmt === 'webp') return { mime: 'image/webp', ext: 'webp' };
  }

  return { mime: '', ext: '' };
}
