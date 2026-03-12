// AI 资讯板块默认 RSS 源（we-mp-rss 公众号）
export const RSS_FEEDS = [
  { name: "机器之心", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3073282833.rss", htmlUrl: "", domain: "ai" },
  { name: "APPSO", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_2392024520.rss", htmlUrl: "", domain: "ai" },
  { name: "腾讯科技", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_2756372660.rss", htmlUrl: "", domain: "ai" },
  { name: "腾讯研究院", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_2399148061.rss", htmlUrl: "", domain: "ai" },
  { name: "ThinkInAI社区", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3088844938.rss", htmlUrl: "", domain: "ai" },
  { name: "数字生命卡兹克", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3223096120.rss", htmlUrl: "", domain: "ai" },
  { name: "yablog", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3207593689.rss", htmlUrl: "", domain: "ai" },
  { name: "科技暴论", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3591063087.rss", htmlUrl: "", domain: "ai" },
  { name: "42章经", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3220199623.rss", htmlUrl: "", domain: "ai" },
  { name: "Z Finance", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3077513391.rss", htmlUrl: "", domain: "ai" },
  { name: "久谦资本", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3866205727.rss", htmlUrl: "", domain: "ai" },
  { name: "INDIGO数字镜像", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3093979779.rss", htmlUrl: "", domain: "ai" },
  { name: "Z Potentials", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3285810954.rss", htmlUrl: "", domain: "ai" },
  { name: "IT桔子", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_2392467062.rss", htmlUrl: "", domain: "ai" },
  { name: "投中网", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3902515905.rss", htmlUrl: "", domain: "ai" },
  { name: "白鲸出海", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3075486737.rss", htmlUrl: "", domain: "ai" },
  { name: "刘言飞语", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_2394925538.rss", htmlUrl: "", domain: "ai" },
];

// 建筑科技板块默认 RSS 源（we-mp-rss 公众号）
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
  { name: "北京构力科技有限公司", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3216848714.rss", htmlUrl: "", domain: "building" },
  { name: "老帅BIM", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3875812326.rss", htmlUrl: "", domain: "building" },
  { name: "wepon智慧城市与城市智慧", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3249852279.rss", htmlUrl: "", domain: "building" },
  { name: "大界机器人RoboticPlus.AI", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3510922513.rss", htmlUrl: "", domain: "building" },
  { name: "中国房地产业协会", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3085738101.rss", htmlUrl: "", domain: "building" },
  { name: "中国建筑业", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_3526387939.rss", htmlUrl: "", domain: "building" },
  { name: "建筑中国", xmlUrl: "http://we-mp-rss:8001/feed/MP_WXS_2393845121.rss", htmlUrl: "", domain: "building" },
];

// 合并为默认总源（AI 资讯 17 个 + 建筑科技 16 个 = 33 个公众号）
export function getDefaultFeeds() {
  return [...RSS_FEEDS, ...RSS_FEEDS_BUILDING];
}
