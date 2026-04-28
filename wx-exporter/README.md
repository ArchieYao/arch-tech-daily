# wx-exporter · 公众号文章 → Word 本地导出工具

> 一个**完全独立的本地小工具**，住在主项目 `ai-daily/` 仓库根目录下的 `wx-exporter/` 文件夹里。
>
> 它**不动主项目任何文件**，自带 `package.json` / `docker-compose.yml` / 前后端，独立启动、独立数据目录、独立端口。
>
> 主项目部署到云端不会带上它（云端 Dockerfile 不 COPY 它，且 `.gitignore` 排除了它的 `node_modules/` 和 `data/`）。

---

## ⚠️ 安全与隐私说明（请先读完再用）

本工具是 **本机一次性小工具**，没有账号体系、没有访问鉴权，请严格按下面的规则使用：

1. **不要部署到云服务器、不要暴露到公网**。
   - we-mp-rss 容器里保存着你的**微信扫码登录态**（约等于一段时间内的微信账号控制权），任何能访问它后台的人都能读到你订阅的公众号、触发抓取、下载已抓的文章。
   - 默认配置（`docker-compose.yml` 里的 `127.0.0.1:8002` + `BIND_HOST=127.0.0.1`）已经**只对本机开放**，请保持现状。
2. **`.env` 文件不会进 Git**（`.gitignore` 已排除），但里面包含 we-mp-rss 后台密码，请妥善保管，**不要拷贝到公开聊天/issue/截图**。
3. **`data/` 目录不会进 Git**（`.gitignore` 已排除），里面有：
   - `data/werss/`：we-mp-rss 容器的 SQLite 数据库 + 微信扫码登录 cookie
   - `data/exports/`：抓取下来的公众号正文 + 图片 + 打包好的 docx/zip
   这些都属于个人隐私数据，**严禁上传到任何代码仓库或对象存储**。
4. **首次启动后请立即修改 we-mp-rss 默认密码**（`admin / admin@123` 是镜像出厂值），然后同步修改 `.env`。
5. 抓取频率已被限制为串行 + 1.5–3 秒随机延时，请不要自行改高或并发跑；微信对 IP 有风控，**云端 IP 触发风控会连累整台机器**。

---

## 它能做什么

提供两种选择文章的方式，都能一键导出为 Word：

- **Mode A · 按公众号 + 时间范围**：勾选若干已订阅公众号 + 时间范围，自动抓取，按「**一个公众号一个 .docx**」输出，多个时再额外打一个 zip
- **Mode B · 按文章链接**：直接粘贴一个或多个 `https://mp.weixin.qq.com/s/...` 链接，抓完后合并成「**一个 .docx**」

共同点：
- 自动抓取每篇文章的 **完整正文 + 图片**
- 全程本机执行，文件保存在本地 `data/exports/` 目录
- 支持实时进度 / 日志 / 取消任务

---

## 三步上手

> 前置：本机已装 [Docker Desktop](https://www.docker.com/products/docker-desktop/) 和 [Node.js ≥ 18](https://nodejs.org/)

### 第 1 步：启动本地 we-mp-rss 容器

```bash
cd wx-exporter
docker compose up -d
```

这会拉起一个**独立的** we-mp-rss 容器：

| 项目 | 值 |
| --- | --- |
| 容器名 | `wx-exporter-werss` |
| 端口 | `127.0.0.1:8002 → 容器 8001`（仅本机可访问） |
| 数据目录 | `wx-exporter/data/werss/` |
| 与主项目 we-mp-rss | **完全隔离**（端口、容器名、数据卷都不一样） |

> 如需局域网内其它设备使用，可改 `docker-compose.yml` 的 ports 为 `0.0.0.0:8002:8001`，但请先看本文顶部「安全与隐私说明」。

启动后等 30 秒左右，浏览器打开：

```
http://127.0.0.1:8002
```

默认账号 `admin` / `admin@123`（如有变更同步改 `.env`）。

### 第 2 步：在 we-mp-rss 后台扫码登录 + 订阅公众号

1. 进入后台 → 「微信扫码」 → 用手机微信扫码登录
2. 「公众号管理」 → 搜索想要的公众号 → 订阅
3. 点击「同步」让它先把这些公众号的最近文章拉一遍（让 SQLite 有数据）

### 第 3 步：启动 wx-exporter Web UI

```bash
cd wx-exporter
cp .env.example .env      # Windows PowerShell: copy .env.example .env
npm install
npm start
```

输出：

```
=================================================
 wx-exporter (本地公众号 → Word 导出工具)
  Web UI:        http://127.0.0.1:3789
  WERSS 后端:    http://localhost:8002
  SQLite 路径:   .../wx-exporter/data/werss/db.db
  导出目录:      .../wx-exporter/data/exports
=================================================
```

浏览器打开 `http://127.0.0.1:3789`，顶部有两个 Tab：

### Mode A · 按公众号 + 时间

1. 顶部状态条会显示「WERSS ✓ · 微信扫码 ✓ · 数据库 xxKB」
2. 选择想要导出的公众号（支持搜索 / 全选）
3. 选择时间范围（提供 1 / 7 / 30 / 90 天快捷按钮）
4. 点 **预览命中文章** 看每个公众号会导出哪些文章
5. 点 **开始导出** 启动任务，下方任务列表实时更新进度
6. 任务完成后点 **⬇ 打包下载** 拿到 zip / docx

### Mode B · 按文章链接

1. 切到顶部「按文章链接」Tab
2. 填写「批次名称」，例如 `每周精选_0412`（它会变成输出的 docx 文件名）
3. 把一个或多个微信文章链接粘到文本框里（支持用换行、逗号、空格一次粘多条），点 **添加到列表**
   - 非法链接会被忽略并给出提示
   - 同一篇文章（同 `__biz + mid + idx + sn`）会自动去重
4. 可以反复粘贴继续累加，也可以单独移除某一条或清空重来
5. 点 **预览命中文章** 会在下方列出当前 URL 列表（**不**提前抓标题，预览只校验）
6. 点 **开始导出** → 工具会逐篇抓取 → 合并成一个 `批次名称.docx`

> Mode B 不需要 we-mp-rss 登录态 / 订阅关系，只要 `mp.weixin.qq.com/s/...` 链接本身能打开即可；顶部状态条显示「WERSS ✗」也不影响它工作。

**支持的链接格式**：

```
https://mp.weixin.qq.com/s/abcDEF_123              ← 短链
https://mp.weixin.qq.com/s?__biz=X&mid=1&idx=1&sn=y&chksm=z   ← 长链
```

工具会自动剥除 `from=timeline` / `scene=xx` / `#rd` 等追踪参数，用于去重。

**限制**：一次最多 200 条。

---

## 目录结构

```
wx-exporter/
├── package.json                # 独立依赖
├── docker-compose.yml          # 本地独立 we-mp-rss
├── .env.example                # 环境变量模板（复制为 .env 修改）
├── .gitignore                  # 排除 node_modules / data
├── README.md                   # 你正在看的文件
├── app.mjs                     # Express 主入口（端口 3789）
├── lib/
│   ├── werss-client.mjs        # 调 we-mp-rss 拿公众号列表 + 登录态
│   ├── articles-query.mjs      # sql.js 直读本地 db.db
│   ├── article-scraper.mjs     # 抓 mp.weixin.qq.com/s/... 解析正文
│   ├── image-fetcher.mjs       # 带 Referer 下载 mmbiz.qpic.cn 图片
│   ├── docx-builder.mjs        # 组装 .docx
│   ├── url-parser.mjs          # Mode B 用：规范化 / 去重微信文章链接
│   └── export-jobs.mjs         # 内存任务管理（状态/进度/日志）
├── public/                     # 前端静态资源
│   ├── index.html
│   ├── app.js
│   └── style.css
└── data/                       # ← .gitignore 中排除
    ├── werss/                  # we-mp-rss 容器数据（SQLite + 登录态）
    └── exports/                # 导出产物，按 jobId 分子目录
```

## 配置（.env）

```ini
WERSS_BASE_URL=http://localhost:8002
WERSS_USERNAME=admin
WERSS_PASSWORD=admin@123
WERSS_DB_PATH=./data/werss/db.db
PORT=3789
OUTPUT_DIR=./data/exports
```

> 改了端口记得**同时改两处**：`docker-compose.yml` 的端口映射 + `.env` 的 `WERSS_BASE_URL`。

## API（如果想脚本化使用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 自检（we-mp-rss 是否可达 / 微信是否扫码 / db.db 是否存在） |
| GET | `/api/mps` | 列出已订阅公众号 |
| POST | `/api/preview` | `{mpIds, start, end}` 预览命中文章（Mode A） |
| POST | `/api/preview-urls` | `{urls, existing?}` 校验/规范化/去重一批链接（Mode B） |
| POST | `/api/start` | Mode A: `{mode:'by_range', mpIds, start, end}` · Mode B: `{mode:'by_urls', urls, batchName}` → 返回 `{jobId}` |
| GET | `/api/jobs` | 所有任务列表 |
| GET | `/api/jobs/:id` | 任务详情（含日志、产物） |
| POST | `/api/jobs/:id/abort` | 取消任务 |
| GET | `/api/jobs/:id/download?file=xxx.docx` | 下载产物 |

时间字段统一传 ISO 字符串，如 `2026-04-01T00:00:00.000Z`。

## 已知限制 / 注意事项

- **抓取频率**：每篇文章之间会随机停 1.5–3 秒，串行抓取。如果一次选了几十个公众号 × 几百篇文章，请耐心等待，不要点几十次"开始"。
- **风控**：微信对 `mp.weixin.qq.com/s/...` 页面的爬取没有强反爬，但短时间高并发可能触发。本工具已尽量友好，如出现 `触发风控` 报错，等几分钟再试。
- **图片格式**：Word 内嵌图片仅支持 jpg/png/gif/bmp。如果文章里出现 webp 或 svg，会显示一行文字占位，**不会**让整篇导出失败。
- **文章已被删除/违规**：会在 docx 中保留标题 + 原文链接，正文位置标注 `[抓取失败：...]`。
- **数据库可能没有最新文章**：we-mp-rss 后台需要"刷新公众号"才会去拉新文章。本工具直接读 `db.db`，所以**没刷新就没新文章**。可以在 `docker-compose.yml` 里把 `SPAN_INTERVAL` 调小让它刷得更勤，但太勤容易封号。
- **登录态过期**：扫码登录态约几小时到几天会过期，过期后回 we-mp-rss 后台重新扫码即可，本工具不需要重启。
- **本地工具，不要暴露到公网**：服务只监听 `127.0.0.1`，请保持现状。

## 跟主项目的隔离边界（给自己看）

- 主项目 `Dockerfile` 不会 `COPY wx-exporter/`（因为没写）→ 云端镜像不带它
- 主项目根目录的 `.gitignore` 不影响本子目录的 `.gitignore`
- 主项目的 `server.mjs` / `package.json` / `lib/` 都没动过
- 主项目用的是云端 we-mp-rss（`http://we-mp-rss:8001`），本工具用的是本地 `wx-exporter-werss`（`127.0.0.1:8002`），两个 SQLite 文件互不相关
- 想彻底删掉本工具：直接 `docker compose down -v && cd .. && rm -rf wx-exporter/`，对主项目零影响

## 常见问题

**Q：启动 `docker compose up -d` 后访问 `http://127.0.0.1:8002` 404 / 长时间无响应？**
A：we-mp-rss 启动需要约 30~60 秒（要装 chromium）。`docker logs wx-exporter-werss -f` 看到 `Application startup complete.` 即可。

**Q：扫码登录提示 `Invalid Session`？**
A：在 we-mp-rss 后台重新扫一次码即可。本工具的所有"已订阅"和"扫码态"都属于这个本地容器，与主项目互不干扰。

**Q：能不能把这个工具部署到云服务器？**
A：技术上能，但**不建议**。云端 IP 短时间内频繁请求 `mp.weixin.qq.com` 极易触发风控并连累整台机器。这是个**只在本机偶尔用一次**的小工具。

**Q：能批量"把所有公众号导出"吗？**
A：可以，前端有"全选"按钮，但请控制时间范围；建议一次不超过 10 个公众号 × 30 天，先小范围试一次。
