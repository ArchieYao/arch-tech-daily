import { callAI } from './ai-client.mjs';

export async function generateHighlights(articles, apiKey, apiOpts) {
  const list = articles.slice(0, 10).map((a, i) =>
    `${i + 1}. [${a.category}] ${a.titleZh || a.title} — ${a.summary?.slice(0, 100) || ''}`
  ).join('\n');

  const prompt = `根据以下今日精选文章列表（前沿 AI 与建筑科技），写一段 3-5 句话的"今日看点"总结。
要求：提炼出今日前沿 AI 与建筑科技领域的 2-3 个主要趋势或话题，不要逐篇列举，要做宏观归纳，风格简洁有力，像新闻导语。用中文回答。

文章列表：
${list}

直接返回纯文本总结，不要 JSON，不要 markdown 格式。`;

  try {
    return (await callAI(prompt, apiKey, apiOpts)).trim();
  } catch (e) {
    console.warn(`[highlights] failed: ${e.message}`);
    return '';
  }
}

/** 生成报告标题，用于列表页展示，不超过 25 字 */
export async function generateReportTitle(articles, highlights, apiKey, apiOpts) {
  const list = articles.slice(0, 5).map((a, i) => `${i + 1}. ${a.titleZh || a.title}`).join('\n');
  const prompt = `你是「建筑科技日报」的编辑，请为本期日报生成一个总标题。

【标题生成规则（非常重要，请严格遵守）】
1. 优先识别本期中「最热点的单条资讯」：
   - 如果多篇入选文章围绕同一事件/同一公司/同一政策（例如多家媒体都在报道同一主题），
     标题就要以这一“公共热点事件”为核心，用专业、准确的方式概括。
2. 如果没有明显的重复热点：
   - 以「第 1 条入选文章」为核心主题，对它的标题做专业提炼和升级，生成一个能代表本期主线的标题。
3. 标题应偏“新闻导语式”而不是空泛口号，必须具体、专业、可落地，避免以下表达：
   - “前沿观察”“最新动态”“全面解读”“重磅来袭”等空话套话；
   - 不要罗列多个话题，只抓住**一个**最重要的主题或事件。
4. 字数要求：**严格不超过 25 个汉字（含标点）**。
5. 输出格式：只输出这一句中文标题，不要引号，不要前后空行，不要解释。

今日看点：
${highlights || '（无）'}

精选前几条：
${list}

现在请直接输出符合上述规则的一句标题：`;

  try {
    const title = (await callAI(prompt, apiKey, apiOpts)).trim();
    return title.length > 25 ? title.slice(0, 25) : title;
  } catch (e) {
    console.warn(`[highlights] reportTitle failed: ${e.message}`);
    return '';
  }
}
