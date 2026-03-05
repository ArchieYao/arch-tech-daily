import { callAI, parseJson } from './ai-client.mjs';

const BATCH_SIZE = 5;
const MAX_CONCURRENT = 2;

function buildSummaryPrompt(articles) {
  const list = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\nURL: ${a.link}\n${(a.description || '').replace(/<[^>]*>/g, '').slice(0, 600)}`
  ).join('\n\n---\n\n');

  return `你是「建筑科技日报」的摘要专家，面向建筑行业与前沿 AI 受众。请为以下文章完成三件事：
1. **中文标题** (titleZh): 将标题翻译或整理成自然流畅的中文（若已是中文则略作润色）。
2. **摘要** (summary): 用中文写 4-6 句话的结构化摘要，直接说重点。
3. **推荐理由** (reason): 用中文写 1 句话说明对建筑/科技从业者「为什么值得读」。

重要：所有输出必须是中文。

## 待摘要文章
${list}

请严格按 JSON 格式返回：
{"results":[{"index":0,"titleZh":"中文标题","summary":"中文摘要...","reason":"中文推荐理由..."}]}`;
}

function buildSinglePrompt(article) {
  const desc = (article.description || '').replace(/<[^>]*>/g, '').slice(0, 600);
  return `请为以下文章完成翻译和摘要（建筑科技日报），所有输出必须是中文：

标题: ${article.title}
来源: ${article.sourceName}
内容: ${desc}

请返回 JSON：
{"titleZh":"中文标题翻译","summary":"4-6句中文摘要","reason":"1句中文推荐理由"}`;
}

function isChinese(text) {
  if (!text) return false;
  return /[\u4e00-\u9fff]/.test(text);
}

export async function summarizeArticles(articles, apiKey, apiOpts, onProgress) {
  const summaries = new Map();
  const batches = [];
  for (let i = 0; i < articles.length; i += BATCH_SIZE) batches.push(articles.slice(i, i + BATCH_SIZE));

  // Phase 1: batch summarization
  // Each batch re-indexes to 0-based so the AI always returns 0..N-1,
  // then we map back to the original global index via position in the batch.
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const group = batches.slice(i, i + MAX_CONCURRENT);
    await Promise.all(group.map(async batch => {
      const localBatch = batch.map((a, j) => ({ ...a, index: j }));
      try {
        const text = await callAI(buildSummaryPrompt(localBatch), apiKey, apiOpts);
        const parsed = parseJson(text);
        if (parsed.results) {
          for (const r of parsed.results) {
            const localIdx = r.index;
            if (localIdx >= 0 && localIdx < batch.length) {
              summaries.set(batch[localIdx].index, { titleZh: r.titleZh || '', summary: r.summary || '', reason: r.reason || '' });
            }
          }
        }
      } catch (e) {
        console.warn(`[summarize] batch failed: ${e.message}`);
      }
    }));
    if (onProgress) onProgress(Math.min(i + MAX_CONCURRENT, batches.length), batches.length);
  }

  // Phase 2: retry failed/untranslated articles one by one
  const failed = articles.filter(a => {
    const s = summaries.get(a.index);
    return !s || !isChinese(s.titleZh) || !isChinese(s.summary);
  });

  if (failed.length > 0) {
    console.log(`[summarize] Retrying ${failed.length} untranslated articles individually...`);
    for (const article of failed) {
      try {
        const text = await callAI(buildSinglePrompt(article), apiKey, apiOpts);
        const parsed = parseJson(text);
        if (parsed.titleZh && isChinese(parsed.titleZh)) {
          summaries.set(article.index, { titleZh: parsed.titleZh, summary: parsed.summary || '', reason: parsed.reason || '' });
        }
      } catch (e) {
        console.warn(`[summarize] retry failed for "${article.title.slice(0, 40)}": ${e.message}`);
      }
    }
  }

  // Phase 3: fill remaining gaps with fallback
  for (const a of articles) {
    if (!summaries.has(a.index)) {
      summaries.set(a.index, { titleZh: a.title, summary: (a.description || '').replace(/<[^>]*>/g, '').slice(0, 200), reason: '' });
    }
  }

  return summaries;
}
