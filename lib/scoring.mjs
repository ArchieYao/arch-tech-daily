import { callAI, parseJson } from './ai-client.mjs';

const BATCH_SIZE = 10;
const MAX_CONCURRENT = 2;

function buildScoringPrompt(articles) {
  const list = articles.map(a => `Index ${a.index}: [${a.sourceName}] ${a.title}\n${(a.description || '').slice(0, 300)}`).join('\n\n---\n\n');
  return `你是「建筑科技日报」的内容策展人，面向两类读者：
- 关注前沿 AI / 大模型动态的人
- 关注建筑科技、建筑数字化转型的人

请对以下文章进行三个维度的评分（1-10 整数，10 分最高），并为每篇文章分配一个分类标签和提取 2-4 个关键词。

## 评分维度
### 1. 相关性 (relevance)
- 如果是 **AI 相关文章**（如大模型、AI 应用、AI 产品、AI 投融资等），请按「对 AI / 大模型 / AI 应用领域的价值」来打分。
- 如果是 **建筑科技 / 建筑数字化相关文章**，请按「对建筑科技、建筑数字化转型、建筑 AI 应用的价值」来打分。
### 2. 质量 (quality) - 文章深度与写作质量
### 3. 时效性 (timeliness) - 当前是否值得阅读

## 分类标签（只能使用以下之一）
- ai-ml（AI/大模型/AI 应用技术）
- building-tech（建筑科技/建筑数字化/建筑 AI）
- policy（政策与行业规范）
- product（新产品/新公司/投融资）
- security / engineering / tools / opinion / other

## 关键词提取
提取 2-4 个最能代表文章主题的关键词（中文或英文均可）

## 待评分文章
${list}

请严格按 JSON 格式返回：
{"results":[{"index":0,"relevance":8,"quality":7,"timeliness":9,"category":"ai-ml","keywords":["大模型","应用"]}]}`;
}

const VALID_CATS = new Set(['ai-ml', 'building-tech', 'policy', 'product', 'security', 'engineering', 'tools', 'opinion', 'other']);

export async function scoreArticles(articles, apiKey, apiOpts, onProgress) {
  const scores = new Map();
  const indexed = articles.map((a, i) => ({ index: i, title: a.title, description: a.description, sourceName: a.sourceName }));
  const batches = [];
  for (let i = 0; i < indexed.length; i += BATCH_SIZE) batches.push(indexed.slice(i, i + BATCH_SIZE));

  // Each batch re-indexes to 0-based so the AI always returns 0..N-1,
  // then we map back to the original global index via position in the batch.
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const group = batches.slice(i, i + MAX_CONCURRENT);
    await Promise.all(group.map(async batch => {
      const localBatch = batch.map((a, j) => ({ ...a, index: j }));
      try {
        const text = await callAI(buildScoringPrompt(localBatch), apiKey, apiOpts);
        const parsed = parseJson(text);
        if (parsed.results) {
          for (const r of parsed.results) {
            const localIdx = r.index;
            if (localIdx >= 0 && localIdx < batch.length) {
              const clamp = v => Math.min(10, Math.max(1, Math.round(v)));
              scores.set(batch[localIdx].index, {
                relevance: clamp(r.relevance), quality: clamp(r.quality), timeliness: clamp(r.timeliness),
                category: VALID_CATS.has(r.category) ? r.category : 'other',
                keywords: Array.isArray(r.keywords) ? r.keywords.slice(0, 4) : [],
              });
            }
          }
        }
      } catch (e) {
        console.warn(`[scoring] batch failed: ${e.message}`);
        for (const item of batch) scores.set(item.index, { relevance: 5, quality: 5, timeliness: 5, category: 'other', keywords: [] });
      }
    }));
    if (onProgress) onProgress(Math.min(i + MAX_CONCURRENT, batches.length), batches.length);
  }
  return scores;
}
