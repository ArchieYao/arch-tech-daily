const FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL || '';
const DEBOUNCE_MS = 60 * 60 * 1000; // 同类告警 1 小时内不重复发送
const lastSentMap = new Map();

/**
 * 向飞书自定义机器人发送告警通知（富文本格式）。
 * FEISHU_WEBHOOK_URL 未配置时静默跳过；发送失败仅打日志，不抛异常。
 */
export async function sendFeishuAlert(title, content) {
  if (!FEISHU_WEBHOOK_URL) return;

  const now = Date.now();
  const lastSent = lastSentMap.get(title) || 0;
  if (now - lastSent < DEBOUNCE_MS) return;
  lastSentMap.set(title, now);

  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: process.env.TZ || 'Asia/Shanghai' });

  const body = {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: {
          title: `[告警] ${title}`,
          content: [
            [{ tag: 'text', text: content }],
            [{ tag: 'text', text: timeStr }],
          ],
        },
      },
    },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(FEISHU_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[notify] 飞书通知发送失败: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[notify] 飞书通知发送异常: ${e.message}`);
  }
}
