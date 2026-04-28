/**
 * 把"一个公众号 + N 篇文章（含正文块、图片）"渲染成 .docx 文件 Buffer。
 *
 * 文档结构：
 *   - 封面：公众号名 / 时间范围 / 文章数 / 生成时间
 *   - 每篇文章：分页 + 标题(Heading 1) + 元信息 + 正文段落 + 内嵌图片
 *
 * 依赖 docx ^9：ImageRun 需要 { data, transformation:{width,height}, type }，
 * type 仅支持 jpg/png/gif/bmp/svg；webp 等会被跳过并写一行占位文字。
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
} from 'docx';
import { fetchImage } from './image-fetcher.mjs';

const MAX_IMG_WIDTH_PX = 500;

/**
 * @param {object} input
 * @param {string} input.mpName        公众号名称
 * @param {string} input.mpId          公众号 ID
 * @param {Date} input.rangeStart      时间范围起
 * @param {Date} input.rangeEnd        时间范围止
 * @param {Array<{
 *   title: string, url: string, publishedAt: Date,
 *   author?: string, account?: string,
 *   blocks?: Array<{type:'paragraph'|'image'|'heading', text?:string, url?:string, level?:number}>,
 *   error?: string
 * }>} input.articles
 * @param {(msg: string) => void} [input.log]
 * @returns {Promise<Buffer>}
 */
export async function buildDocxForMp(input) {
  const { mpName, mpId, rangeStart, rangeEnd, articles, log = () => {} } = input;
  const total = articles.length;
  const successCount = articles.filter((a) => !a.error && Array.isArray(a.blocks) && a.blocks.length).length;

  const children = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: mpName || mpId, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `公众号 ID：${mpId}`, color: '888888', size: 20 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `时间范围：${formatDate(rangeStart)} ~ ${formatDate(rangeEnd)}`,
          size: 20,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `文章总数：${total}（成功 ${successCount}）`, size: 20 }),
        new TextRun({
          text: `   生成时间：${formatDateTime(new Date())}`,
          size: 20,
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    log(`[docx] 渲染第 ${i + 1}/${total} 篇：${a.title || '(无标题)'}`);

    if (i > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: a.title || '(无标题)', bold: true })],
      }),
    );

    const metaParts = [];
    if (a.publishedAt) metaParts.push(`发布时间：${formatDateTime(a.publishedAt)}`);
    if (a.author) metaParts.push(`作者：${a.author}`);
    if (a.url) metaParts.push(`原文：${a.url}`);
    if (metaParts.length) {
      children.push(
        new Paragraph({
          children: metaParts.map(
            (t, idx) =>
              new TextRun({
                text: idx === 0 ? t : `   ${t}`,
                color: '888888',
                size: 18,
              }),
          ),
        }),
      );
    }

    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));

    if (a.error) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[抓取失败：${a.error}] 可点击上方原文链接手动查看`,
              color: 'b00020',
            }),
          ],
        }),
      );
      continue;
    }

    if (!Array.isArray(a.blocks) || a.blocks.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '[无正文内容]', color: 'b00020' })],
        }),
      );
      continue;
    }

    for (const block of a.blocks) {
      if (block.type === 'paragraph') {
        if (block.text) {
          children.push(
            new Paragraph({ children: [new TextRun({ text: block.text })] }),
          );
        }
      } else if (block.type === 'heading') {
        const level = clampHeading(block.level);
        children.push(
          new Paragraph({
            heading: level,
            children: [new TextRun({ text: block.text || '', bold: true })],
          }),
        );
      } else if (block.type === 'image') {
        const imgPara = await renderImage(block.url, log);
        if (imgPara) children.push(imgPara);
      }
    }
  }

  const doc = new Document({
    creator: 'wx-exporter',
    title: `${mpName || mpId} 文章合集`,
    description: `时间范围 ${formatDate(rangeStart)} ~ ${formatDate(rangeEnd)}`,
    sections: [{ properties: {}, children }],
  });

  return await Packer.toBuffer(doc);
}

async function renderImage(url, log) {
  const res = await fetchImage(url);
  if (!res.ok) {
    log(`[docx] 图片下载失败: ${url} → ${res.error}`);
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `[图片加载失败：${res.error}] ${url}`,
          color: 'b00020',
          size: 16,
        }),
      ],
    });
  }

  // docx 9.x ImageRun 不支持 webp / svg-as-image；对不支持的格式给文字占位
  const supportedExt = mapDocxImageType(res.ext, res.mime);
  if (!supportedExt) {
    log(`[docx] 不支持的图片格式 ${res.mime}，跳过：${url}`);
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `[图片格式 ${res.mime || res.ext || 'unknown'} 不被 Word 支持]`,
          color: '888888',
          size: 16,
        }),
      ],
    });
  }

  const dim = sniffImageSize(res.buffer, supportedExt) || { width: 600, height: 450 };
  const { width, height } = scaleToMaxWidth(dim.width, dim.height, MAX_IMG_WIDTH_PX);

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        data: res.buffer,
        transformation: { width, height },
        type: supportedExt,
      }),
    ],
  });
}

function mapDocxImageType(ext, mime) {
  const t = (ext || '').toLowerCase();
  if (t === 'jpg' || t === 'jpeg') return 'jpg';
  if (t === 'png') return 'png';
  if (t === 'gif') return 'gif';
  if (t === 'bmp') return 'bmp';
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('bmp')) return 'bmp';
  return null;
}

function clampHeading(level) {
  const lvl = Math.max(2, Math.min(5, Number(level) || 2));
  return [
    null,
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
  ][lvl];
}

function scaleToMaxWidth(w, h, maxW) {
  if (!w || !h) return { width: maxW, height: Math.round(maxW * 0.75) };
  if (w <= maxW) return { width: w, height: h };
  const ratio = maxW / w;
  return { width: maxW, height: Math.round(h * ratio) };
}

/** 用 magic bytes 直接读 png/jpeg/gif/bmp 的尺寸，避免引入额外依赖 */
function sniffImageSize(buf, ext) {
  try {
    if (ext === 'png') {
      // 8 字节签名 + IHDR(长度 4 + "IHDR" 4 + width 4 + height 4)
      if (buf.length < 24) return null;
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      };
    }
    if (ext === 'gif') {
      if (buf.length < 10) return null;
      return {
        width: buf.readUInt16LE(6),
        height: buf.readUInt16LE(8),
      };
    }
    if (ext === 'bmp') {
      if (buf.length < 26) return null;
      return {
        width: buf.readInt32LE(18),
        height: Math.abs(buf.readInt32LE(22)),
      };
    }
    if (ext === 'jpg') {
      // 扫描 segments 找 SOF0/2/3
      let i = 2;
      while (i + 4 < buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        // SOF markers (excluding 0xC4 DHT, 0xC8 reserved, 0xCC DAC)
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          if (i + 9 >= buf.length) return null;
          return {
            height: buf.readUInt16BE(i + 5),
            width: buf.readUInt16BE(i + 7),
          };
        }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function formatDateTime(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
