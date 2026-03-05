// 默认 AI / 科技资讯源（已清空，由建筑科技公众号作为默认源）
export const RSS_FEEDS = [];

// 建筑科技板块默认 RSS 源（使用 we-mp-rss 生成的 9 个公众号 RSS）
export const RSS_FEEDS_BUILDING = [
  { name: "AI4ELAB", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3211834441.rss", htmlUrl: "", domain: "building" },
  { name: "广联达+", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3070281323.rss", htmlUrl: "", domain: "building" },
  { name: "广联达设计圈", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3083183900.rss", htmlUrl: "", domain: "building" },
  { name: "中望软件", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3017250229.rss", htmlUrl: "", domain: "building" },
  { name: "中望软件技术", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_2393400861.rss", htmlUrl: "", domain: "building" },
  { name: "酷家乐", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3093538884.rss", htmlUrl: "", domain: "building" },
  { name: "大乐装", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3883566687.rss", htmlUrl: "", domain: "building" },
  { name: "品览Pinlan", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3520915834.rss", htmlUrl: "", domain: "building" },
  { name: "小库科技XKool", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3224648383.rss", htmlUrl: "", domain: "building" },
];

// 合并为默认总源（目前只有建筑科技 9 个公众号）
const _AI_FEEDS = RSS_FEEDS;
export function getDefaultFeeds() {
  return [..._AI_FEEDS, ...RSS_FEEDS_BUILDING];
}
