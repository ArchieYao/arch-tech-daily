# AI Daily — AI 资讯日报生成器

自动从 33 个 RSS 源（微信公众号 + 自定义源）抓取文章，用 AI 评分筛选，一键生成每日精选日报。

支持豆包、Gemini、OpenAI 等多个 AI 渠道，内置密码保护和加密存储，Docker 一键部署。

![界面截图](img/Interface%20screenshot.png)

## 功能特性

### AI 资讯板块
- 33 个预置 RSS 源（微信公众号），可自由增删
- AI 三维评分（相关性 / 质量 / 时效性），自动分类打标签
- 中文标题翻译 + 摘要生成 + 今日看点总结
- Top 3 必读推荐 + 全部精选列表

### 建筑科技板块
- 独立的建筑科技 RSS 源分组
- 与 AI 资讯分开展示，互不干扰

### 通用功能
- 定时自动生成日报（可配置时间）
- 公开分享链接（无需登录即可查看）
- 全文翻译（可选，支持流式输出）
- PDF / 打印导出
- 亮色 / 暗色主题切换
- 移动端适配
- 密码保护 + API Key 加密存储（AES-256-GCM）
- 防暴力破解（5 次错误锁定 15 分钟）

---

## 快速部署（Docker Compose）

> 推荐方式，包含 AI Daily + we-mp-rss（微信公众号 RSS 服务）两个容器。

### 第一步：下载项目

```bash
git clone https://github.com/wp-x/ai-daily.git
cd ai-daily
```

### 第二步：创建配置文件

```bash
cp .env.example .env
```

用编辑器打开 `.env`，修改以下内容：

```bash
# 【必改】替换为一个随机字符串，用于加密 API Key
CONFIG_SECRET=替换为你的随机字符串

# 【可选】管理后台登录账号，默认 admin / admin123
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=你的密码
```

> 生成随机密钥的方法：
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
> ```

### 第三步：启动服务

```bash
docker compose up -d
```

等待镜像拉取完成后，访问 `http://localhost:3456`。

### 第四步：配置 AI 渠道

1. 用默认账号登录（admin / admin123）
2. 点击右上角 **设置** 图标
3. 选择 AI 渠道，填入 API Key
4. 点击 **测试连接**，确认可用后保存
5. **建议立即修改默认密码**（设置 → 修改密码）

### 第五步：生成日报

点击右上角 **生成** 按钮，选择时间范围（默认 48 小时），等待 3-5 分钟即可。

---

## 如何获取 AI API Key

本项目需要一个 AI API Key 来进行文章评分和摘要生成。以下三个渠道任选其一：

### 豆包（Doubao）— 推荐，国内直连

1. 访问 [火山引擎控制台](https://console.volcengine.com/ark)
2. 注册 / 登录账号
3. 进入「模型推理」→「API Key 管理」
4. 创建 API Key，复制保存
5. 推荐模型：`doubao-seed-2-0-pro-260215`

### Google Gemini — 免费额度充足

1. 访问 [Google AI Studio](https://aistudio.google.com/apikey)
2. 用 Google 账号登录
3. 点击「Create API Key」
4. 复制保存 API Key
5. 推荐模型：`gemini-2.0-flash`
6. 注意：需要能访问 Google 服务

### OpenAI — 或任何 OpenAI 兼容 API

1. 访问 [OpenAI Platform](https://platform.openai.com/api-keys)
2. 注册 / 登录后创建 API Key
3. 也支持任何 OpenAI 兼容的第三方 API（选「自定义」渠道，填入 Base URL）

---

## 微信公众号 RSS 配置

项目通过 [we-mp-rss](https://github.com/rachelos/we-mp-rss) 获取微信公众号文章。Docker Compose 已自动包含此服务。

### 首次使用

1. 在 AI Daily 设置页面，进入「公众号 RSS」标签页
2. 点击「扫码登录微信」，用微信扫描二维码
3. 登录成功后，可搜索并订阅公众号
4. 订阅的公众号会自动生成 RSS 源

### 注意事项

- 微信登录状态有时效，过期后需要重新扫码
- we-mp-rss 默认每 10 分钟抓取一次新文章
- AI Daily 每天凌晨 00:00 会自动刷新所有公众号

---

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADMIN_USERNAME` | 管理后台用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理后台密码 | `admin123` |
| `CONFIG_SECRET` | API Key 加密密钥（建议自定义） | 内置默认值 |
| `PORT` | 服务端口 | `3456` |
| `TZ` | 时区 | `Asia/Shanghai` |
| `WERSS_BASE_URL` | we-mp-rss 服务地址 | `http://we-mp-rss:8001` |
| `WERSS_USERNAME` | we-mp-rss 登录用户名 | `admin` |
| `WERSS_PASSWORD` | we-mp-rss 登录密码 | `admin@123` |
| `ENABLE_TRANSLATION` | 启用全文翻译功能 | `false` |
| `PDF_FONT_PATH` | PDF 导出中文字体路径 | 内置字体 |

---

## 手动部署（不用 Docker）

```bash
# 1. 下载项目
git clone https://github.com/wp-x/ai-daily.git
cd ai-daily

# 2. 安装依赖
npm install

# 3. 创建配置
cp .env.example .env
# 编辑 .env，填入 CONFIG_SECRET

# 4. 启动
npm start
```

访问 `http://localhost:3456`。

> 手动部署时，微信公众号 RSS 功能需要单独部署 [we-mp-rss](https://github.com/rachelos/we-mp-rss)，并在 `.env` 中配置 `WERSS_BASE_URL` 指向该服务地址。

---

## 项目结构

```
ai-daily/
├── server.mjs              # Express 服务器 + API 路由
├── lib/
│   ├── ai-client.mjs       # 统一 AI 客户端（Gemini / OpenAI / 豆包）
│   ├── auth.mjs            # 认证系统（密码、Session、防暴力破解）
│   ├── config.mjs          # 加密配置存储（AES-256-GCM）
│   ├── db.mjs              # JSON 文件数据库
│   ├── feeds.mjs           # RSS 并发抓取
│   ├── scoring.mjs         # AI 评分（批量处理）
│   ├── summarize.mjs       # AI 摘要生成
│   ├── highlights.mjs      # 今日看点生成
│   ├── translate.mjs       # 全文翻译（流式）
│   ├── rss-list.mjs        # 默认 33 个 RSS 源
│   └── werss-client.mjs    # we-mp-rss API 客户端
├── public/
│   ├── index.html          # 前端页面
│   ├── app.js              # 前端逻辑
│   └── style.css           # 样式
├── docker-compose.yml      # Docker Compose 编排
├── Dockerfile
├── .env.example            # 环境变量模板
└── package.json
```

---

## 致谢

- 微信公众号 RSS：[we-mp-rss](https://github.com/rachelos/we-mp-rss)
- AI 模型：[Google Gemini](https://ai.google.dev/) / [OpenAI](https://openai.com/) / [豆包](https://www.volcengine.com/product/doubao)

## 许可证

[MIT](LICENSE)
