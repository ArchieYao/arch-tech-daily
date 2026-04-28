/**
 * 内存中的导出任务管理器：
 *   - createJob(payload)        新建任务，返回 jobId
 *   - getJob(jobId)             读任务（含状态/进度/日志/产物）
 *   - updateJob(jobId, patch)   合并字段
 *   - appendLog(jobId, line)    追加一行日志
 *   - listJobs()                列表（按 createdAt 倒序）
 *   - 1 小时无活动 / 已完成 1 小时 → 自动清理
 *
 * 任务状态：
 *   pending → running → succeeded | failed | aborted
 */

import crypto from 'node:crypto';

const JOBS = new Map();
const TTL_MS = 60 * 60 * 1000;
const MAX_LOG_LINES = 500;

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of JOBS) {
    const finished = ['succeeded', 'failed', 'aborted'].includes(job.status);
    const ageSinceUpdate = now - (job.updatedAt || job.createdAt);
    if (finished && ageSinceUpdate > TTL_MS) JOBS.delete(id);
  }
}, 5 * 60 * 1000).unref?.();

export function createJob(payload = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  const job = {
    id,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    progress: { done: 0, total: 0, currentMp: '', currentArticle: '' },
    payload,
    logs: [],
    artifacts: [],
    error: null,
    abortController: new AbortController(),
  };
  JOBS.set(id, job);
  return id;
}

export function getJob(id) {
  return JOBS.get(id) || null;
}

export function updateJob(id, patch) {
  const job = JOBS.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  if (patch?.progress) {
    job.progress = { ...job.progress, ...patch.progress };
  }
  return job;
}

export function appendLog(id, line) {
  const job = JOBS.get(id);
  if (!job) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  job.logs.push(`[${ts}] ${line}`);
  if (job.logs.length > MAX_LOG_LINES) {
    job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  }
  job.updatedAt = Date.now();
}

export function abortJob(id) {
  const job = JOBS.get(id);
  if (!job) return false;
  if (['succeeded', 'failed', 'aborted'].includes(job.status)) return false;
  job.abortController.abort();
  job.status = 'aborted';
  job.updatedAt = Date.now();
  appendLog(id, '[abort] 已请求取消');
  return true;
}

export function listJobs() {
  return [...JOBS.values()]
    .map(serializeJob)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function serializeJob(job) {
  if (!job) return null;
  const p = job.payload || {};
  const urls = Array.isArray(p.urls) ? p.urls : [];
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    payload: {
      mode: p.mode || 'by_range',
      mpIds: p.mpIds || [],
      mpNames: p.mpNames || [],
      start: p.start,
      end: p.end,
      batchName: p.batchName || '',
      urlCount: urls.length,
      urls: urls.slice(0, 10), // 只露前 10 条给前端预览用
    },
    logs: job.logs.slice(),
    artifacts: job.artifacts.map((a) => ({
      filename: a.filename,
      sizeBytes: a.sizeBytes,
      kind: a.kind,
    })),
    error: job.error,
  };
}
