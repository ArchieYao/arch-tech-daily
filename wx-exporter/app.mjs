/**
 * wx-exporter 本地 Web 服务入口。
 *
 * 绑定地址由环境变量 BIND_HOST 控制：
 *   - 默认 127.0.0.1（仅本机）
 *   - 0.0.0.0 或 ::   → 允许局域网内其他设备访问
 *   - 不建议直接暴露到公网（微信风控 + 无鉴权）
 *
 *   端口：PORT（默认 3789）
 *   前端：public/index.html
 *   API：
 *     GET  /api/health            自检（we-mp-rss 可达 / 登录态 / db.db 存在）
 *     GET  /api/mps               列出本地 we-mp-rss 已订阅公众号
 *     POST /api/preview           {mpIds, start, end} → 预览每个公众号命中的文章
 *     POST /api/preview-urls      {urls, existing?} → 校验/去重一批文章链接
 *     POST /api/start             两种载荷：
 *                                   {mode:'by_range', mpIds, start, end}
 *                                   {mode:'by_urls',  urls, batchName}
 *     GET  /api/jobs              所有任务列表
 *     GET  /api/jobs/:id          单个任务详情（含日志、产物）
 *     POST /api/jobs/:id/abort    取消任务
 *     GET  /api/jobs/:id/download[?file=xxx] 下载产物（缺省下首个：单 docx 或 zip）
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import { createWeRSSSession } from './lib/werss-client.mjs';
import {
  queryArticles,
  previewArticles,
  describeDbFile,
} from './lib/articles-query.mjs';
import { scrapeArticlesSequential } from './lib/article-scraper.mjs';
import { buildDocxForMp } from './lib/docx-builder.mjs';
import { parseArticleUrlBatch } from './lib/url-parser.mjs';
import {
  createJob,
  getJob,
  updateJob,
  appendLog,
  abortJob,
  listJobs,
  serializeJob,
} from './lib/export-jobs.mjs';

// 手动加载 .env（不强依赖 dotenv 包）
loadDotEnvManually();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  PORT: Number(process.env.PORT || 3789),
  BIND_HOST: process.env.BIND_HOST || '127.0.0.1',
  WERSS_BASE_URL: process.env.WERSS_BASE_URL || 'http://localhost:8002',
  WERSS_USERNAME: process.env.WERSS_USERNAME || 'admin',
  WERSS_PASSWORD: process.env.WERSS_PASSWORD || 'admin@123',
  WERSS_DB_PATH: path.resolve(
    __dirname,
    process.env.WERSS_DB_PATH || './data/werss/db.db',
  ),
  OUTPUT_DIR: path.resolve(
    __dirname,
    process.env.OUTPUT_DIR || './data/exports',
  ),
};

fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });

const session = createWeRSSSession({
  baseUrl: CONFIG.WERSS_BASE_URL,
  username: CONFIG.WERSS_USERNAME,
  password: CONFIG.WERSS_PASSWORD,
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API ──────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  const out = {
    werssBaseUrl: CONFIG.WERSS_BASE_URL,
    werssReachable: false,
    werssLoggedIn: false,
    wxLoggedIn: false,
    db: describeDbFile(CONFIG.WERSS_DB_PATH),
    outputDir: CONFIG.OUTPUT_DIR,
  };
  try {
    await session.withAuth(async (client, token) => {
      out.werssReachable = true;
      out.werssLoggedIn = true;
      const qr = await client.getQrStatus(token).catch(() => ({ login_status: false }));
      out.wxLoggedIn = !!qr.login_status;
    });
  } catch (e) {
    out.error = e.message;
  }
  res.json(out);
});

app.get('/api/mps', async (_req, res) => {
  try {
    const list = await session.withAuth((client, token) => client.getAllMps(token));
    const mapped = list.map((m) => ({
      id: m.id,
      mp_name: m.mp_name || m.id,
      mp_intro: m.mp_intro || '',
      mp_cover: m.mp_cover || '',
      sync_time: m.sync_time || m.update_time || null,
    }));
    res.json({ ok: true, total: mapped.length, mps: mapped });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/preview', async (req, res) => {
  try {
    const { mpIds, start, end } = parseRangeBody(req.body);
    const groups = await previewArticles(CONFIG.WERSS_DB_PATH, { mpIds, start, end });
    const total = groups.reduce((s, g) => s + g.articles.length, 0);
    res.json({ ok: true, total, groups });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/preview-urls', (req, res) => {
  try {
    const { urls, existing } = req.body || {};
    if (urls === undefined || urls === null) {
      throw new Error('urls 不能为空');
    }
    const existingSet = new Set(Array.isArray(existing) ? existing : []);
    const result = parseArticleUrlBatch(urls, { existing: existingSet });
    res.json({
      ok: true,
      ...result,
      stats: {
        validCount: result.valid.length,
        invalidCount: result.invalid.length,
        duplicateCount: result.duplicates.length,
      },
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/start', async (req, res) => {
  try {
    const mode = (req.body && req.body.mode) || 'by_range';

    if (mode === 'by_urls') {
      const { urls, batchName } = parseUrlsBody(req.body);
      const jobId = createJob({
        mode: 'by_urls',
        urls,
        batchName,
      });
      appendLog(jobId, `[start] Mode B · 批次 "${batchName}" · ${urls.length} 篇文章`);
      runByUrls(jobId, { urls, batchName }).catch((e) => {
        appendLog(jobId, `[fatal] ${e.message}`);
        updateJob(jobId, { status: 'failed', error: e.message });
      });
      return res.json({ ok: true, jobId });
    }

    // mode === 'by_range'
    const { mpIds, start, end } = parseRangeBody(req.body);
    const allMps = await session.withAuth((client, token) => client.getAllMps(token));
    const mpById = new Map(allMps.map((m) => [m.id, m.mp_name || m.id]));
    const mpNames = mpIds.map((id) => mpById.get(id) || id);

    const jobId = createJob({
      mode: 'by_range',
      mpIds, mpNames,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    appendLog(jobId, `[start] Mode A · ${mpIds.length} 个公众号 / ${formatDate(start)} ~ ${formatDate(end)}`);

    runByRange(jobId, { mpIds, mpNames, start, end }).catch((e) => {
      appendLog(jobId, `[fatal] ${e.message}`);
      updateJob(jobId, { status: 'failed', error: e.message });
    });

    res.json({ ok: true, jobId });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/jobs', (_req, res) => {
  res.json({ ok: true, jobs: listJobs() });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'job_not_found' });
  res.json({ ok: true, job: serializeJob(job) });
});

app.post('/api/jobs/:id/abort', (req, res) => {
  const ok = abortJob(req.params.id);
  res.json({ ok });
});

app.get('/api/jobs/:id/download', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).send('job_not_found');
  if (!job.artifacts?.length) return res.status(409).send('no_artifact');

  let artifact = job.artifacts[0];
  if (req.query.file) {
    const want = String(req.query.file);
    artifact = job.artifacts.find((a) => a.filename === want) || null;
  }
  if (!artifact) return res.status(404).send('file_not_found');

  res.download(artifact.path, artifact.filename);
});

app.listen(CONFIG.PORT, CONFIG.BIND_HOST, () => {
  const isLocal = CONFIG.BIND_HOST === '127.0.0.1' || CONFIG.BIND_HOST === '::1';
  console.log('=================================================');
  console.log(' wx-exporter (本地公众号 → Word 导出工具)');
  console.log(`  绑定地址:      ${CONFIG.BIND_HOST}:${CONFIG.PORT}${isLocal ? '  （仅本机可访问）' : '  （局域网可访问）'}`);
  console.log(`  本机访问:      http://127.0.0.1:${CONFIG.PORT}`);
  if (!isLocal) {
    const lanIps = getLanIPv4s();
    if (lanIps.length) {
      for (const ip of lanIps) {
        console.log(`  局域网访问:    http://${ip}:${CONFIG.PORT}`);
      }
    }
  }
  console.log(`  WERSS 后端:    ${CONFIG.WERSS_BASE_URL}`);
  console.log(`  SQLite 路径:   ${CONFIG.WERSS_DB_PATH}`);
  console.log(`  导出目录:      ${CONFIG.OUTPUT_DIR}`);
  console.log('=================================================');
});

// ── Worker ───────────────────────────────────────────────────────────

async function runByRange(jobId, { mpIds, mpNames, start, end }) {
  updateJob(jobId, { status: 'running' });

  const job = getJob(jobId);
  const signal = job.abortController.signal;

  const articles = await queryArticles(CONFIG.WERSS_DB_PATH, { mpIds, start, end });
  appendLog(jobId, `[query] 命中 ${articles.length} 篇文章`);

  // 按 mpId 分组（保持入参顺序）
  const buckets = new Map(mpIds.map((id, idx) => [id, { id, name: mpNames[idx], articles: [] }]));
  for (const a of articles) {
    const b = buckets.get(a.mp_id);
    if (b) b.articles.push(a);
  }

  // 计算总进度（按文章数量）
  const totalArticles = articles.length;
  let doneArticles = 0;
  updateJob(jobId, { progress: { done: 0, total: totalArticles, currentMp: '', currentArticle: '' } });

  const jobDir = path.join(CONFIG.OUTPUT_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const docxFiles = [];

  for (const mpId of mpIds) {
    if (signal.aborted) {
      appendLog(jobId, '[abort] 中断当前任务');
      return;
    }
    const bucket = buckets.get(mpId);
    if (!bucket || bucket.articles.length === 0) {
      appendLog(jobId, `[skip] ${bucket?.name || mpId} 时间范围内无文章`);
      continue;
    }

    appendLog(jobId, `[mp] ${bucket.name}（${bucket.articles.length} 篇）开始抓取`);
    updateJob(jobId, { progress: { currentMp: bucket.name } });

    const scraped = await scrapeArticlesSequential(
      bucket.articles.map((a) => ({
        id: a.id,
        title: a.title,
        url: a.url,
        publishedAt: a.publishedAt,
        author: '',
      })),
      {
        signal,
        onItem: (i, total, item, result) => {
          doneArticles += 1;
          const tag = result.ok ? 'ok' : (result.deleted ? 'deleted' : 'fail');
          appendLog(jobId, `  [${i}/${total}] ${tag} - ${item.title}`);
          updateJob(jobId, {
            progress: {
              done: doneArticles,
              total: totalArticles,
              currentMp: bucket.name,
              currentArticle: item.title,
            },
          });
        },
      },
    );

    if (signal.aborted) return;

    const articleData = scraped.map((s) => {
      const r = s.result || {};
      return {
        title: s.title,
        url: s.url,
        publishedAt: s.publishedAt,
        author: r.author || '',
        account: r.account || bucket.name,
        blocks: r.ok ? r.blocks : [],
        error: r.ok ? null : r.error || 'unknown',
      };
    });

    appendLog(jobId, `[docx] 开始生成 ${bucket.name}.docx`);
    const buf = await buildDocxForMp({
      mpName: bucket.name,
      mpId,
      rangeStart: start,
      rangeEnd: end,
      articles: articleData,
      log: (m) => appendLog(jobId, m),
    });

    const filename = `${sanitizeFilename(bucket.name)}__${formatDate(start)}_${formatDate(end)}.docx`;
    const filePath = path.join(jobDir, filename);
    fs.writeFileSync(filePath, buf);
    docxFiles.push({ filename, path: filePath, sizeBytes: buf.length });
    appendLog(jobId, `[docx] 已保存 ${filename}（${(buf.length / 1024).toFixed(1)} KB）`);
  }

  if (docxFiles.length === 0) {
    appendLog(jobId, '[done] 没有可导出的文章');
    updateJob(jobId, { status: 'failed', error: '所选时间范围内没有任何文章' });
    return;
  }

  // 多个公众号 → 额外打 zip 方便一次下载
  if (docxFiles.length > 1) {
    const zipName = `wx-export_${formatDate(start)}_${formatDate(end)}_${docxFiles.length}MP.zip`;
    const zipPath = path.join(jobDir, zipName);
    await zipFiles(zipPath, docxFiles);
    const stat = fs.statSync(zipPath);
    appendLog(jobId, `[zip] 已打包 ${zipName}（${(stat.size / 1024).toFixed(1)} KB）`);
    updateJob(jobId, {
      status: 'succeeded',
      artifacts: [
        { filename: zipName, path: zipPath, sizeBytes: stat.size, kind: 'zip' },
        ...docxFiles.map((f) => ({ ...f, kind: 'docx' })),
      ],
    });
  } else {
    updateJob(jobId, {
      status: 'succeeded',
      artifacts: docxFiles.map((f) => ({ ...f, kind: 'docx' })),
    });
  }

  appendLog(jobId, '[done] 全部完成');
}

async function runByUrls(jobId, { urls, batchName }) {
  updateJob(jobId, { status: 'running' });

  const job = getJob(jobId);
  const signal = job.abortController.signal;

  const total = urls.length;
  updateJob(jobId, {
    progress: { done: 0, total, currentMp: batchName, currentArticle: '' },
  });

  const jobDir = path.join(CONFIG.OUTPUT_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  appendLog(jobId, `[batch] ${batchName}（${total} 篇）开始抓取`);

  let doneCount = 0;
  const scraped = await scrapeArticlesSequential(
    urls.map((url, idx) => ({
      id: `url_${idx}`,
      title: '',                // 抓取成功后用爬回来的标题
      url,
      publishedAt: null,
      author: '',
    })),
    {
      signal,
      onItem: (i, n, item, result) => {
        doneCount += 1;
        const displayTitle = result.ok ? result.title : item.url;
        const tag = result.ok ? 'ok' : (result.deleted ? 'deleted' : 'fail');
        appendLog(jobId, `  [${i}/${n}] ${tag} - ${displayTitle}`);
        updateJob(jobId, {
          progress: {
            done: doneCount,
            total,
            currentMp: batchName,
            currentArticle: displayTitle,
          },
        });
      },
    },
  );

  if (signal.aborted) {
    appendLog(jobId, '[abort] 中断当前任务');
    return;
  }

  const articleData = scraped.map((s) => {
    const r = s.result || {};
    let publishedAt = null;
    if (r.publishTime) {
      const d = new Date(r.publishTime);
      if (!isNaN(d)) publishedAt = d;
    }
    return {
      title: r.ok ? (r.title || '(无标题)') : (s.title || s.url),
      url: s.url,
      publishedAt,
      author: r.author || '',
      account: r.account || '',
      blocks: r.ok ? r.blocks : [],
      error: r.ok ? null : (r.error || 'unknown'),
    };
  });

  appendLog(jobId, `[docx] 开始生成 ${batchName}.docx`);
  const now = new Date();
  const buf = await buildDocxForMp({
    mpName: batchName,
    mpId: 'batch',
    rangeStart: now,
    rangeEnd: now,
    articles: articleData,
    log: (m) => appendLog(jobId, m),
  });

  const filename = `${sanitizeFilename(batchName)}__${formatDate(now)}.docx`;
  const filePath = path.join(jobDir, filename);
  fs.writeFileSync(filePath, buf);
  appendLog(jobId, `[docx] 已保存 ${filename}（${(buf.length / 1024).toFixed(1)} KB）`);

  updateJob(jobId, {
    status: 'succeeded',
    artifacts: [{ filename, path: filePath, sizeBytes: buf.length, kind: 'docx' }],
  });
  appendLog(jobId, '[done] 全部完成');
}

function zipFiles(zipPath, files) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(out);
    for (const f of files) archive.file(f.path, { name: f.filename });
    archive.finalize();
  });
}

// ── helpers ──────────────────────────────────────────────────────────

function parseRangeBody(body = {}) {
  const mpIds = Array.isArray(body.mpIds) ? body.mpIds.filter(Boolean) : [];
  if (mpIds.length === 0) throw new Error('mpIds 不能为空');
  if (mpIds.length > 50) throw new Error('一次最多 50 个公众号');

  const start = body.start ? new Date(body.start) : null;
  const end = body.end ? new Date(body.end) : null;
  if (!start || isNaN(start)) throw new Error('start 时间格式不正确');
  if (!end || isNaN(end)) throw new Error('end 时间格式不正确');
  if (end <= start) throw new Error('end 必须晚于 start');
  if (end - start > 366 * 24 * 3600 * 1000) throw new Error('时间范围不能超过 1 年');

  return { mpIds, start, end };
}

function parseUrlsBody(body = {}) {
  const rawUrls = Array.isArray(body.urls)
    ? body.urls.filter((u) => typeof u === 'string' && u.trim())
    : [];
  if (rawUrls.length === 0) throw new Error('urls 不能为空');
  if (rawUrls.length > 200) throw new Error('一次最多 200 篇文章');

  // 再规范化一次，避免前端直接把非法 URL 塞进来
  const { valid, invalid } = parseArticleUrlBatch(rawUrls);
  if (valid.length === 0) {
    throw new Error('所有链接都无法识别为合法的微信公众号文章');
  }
  if (invalid.length > 0) {
    throw new Error(`存在 ${invalid.length} 条非法链接，请先在前端清理后再试`);
  }
  const urls = valid.map((v) => v.normalized);

  const batchName =
    (typeof body.batchName === 'string' && body.batchName.trim())
      ? body.batchName.trim()
      : `文章合集_${formatDate(new Date())}`;
  if (batchName.length > 60) throw new Error('批次名称太长（最多 60 字）');

  return { urls, batchName };
}

function sanitizeFilename(s) {
  return String(s || 'untitled')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getLanIPv4s() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const it of ifaces[name] || []) {
      if (it.family === 'IPv4' && !it.internal) ips.push(it.address);
    }
  }
  return ips;
}

function loadDotEnvManually() {
  const envPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '.env',
  );
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
