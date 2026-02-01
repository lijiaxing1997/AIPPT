# 兴河PPT（AIPPT）

本项目是一个**本地化**的 AI PPT 工具：以“项目文件夹”为单位管理内容，AI 生成大纲/风格/每页内容，并调用生图接口生成 16:9 的 PPT 图片；最终可导出 **PDF / PPTX（图片页）**。

![首页](main.png)

## 重要
- **Chat API**：需要用到OpenAI范式接口的对话模型，自行选择即可。
- **Image API**：需要用到生图接口API 目前采用的是`https://api.vectorengine.ai/`。使用请注册并且获取令牌，我看下来就是1毛一张PPT图片。（不是广告）

## 功能

- **多项目**：创建/打开本地项目文件夹（可搬移/备份）
- **AI 生成**：大纲（章节/页标题/概要）、主题风格、单页内容（要点/讲稿/配图描述）
- **生图与版本**：按页生成图片，支持编辑提示词、重新生成、版本回退
- **导出**：PDF / PPTX（图片铺满页面；PPTX 会写入 speaker notes）

## 运行环境

- Node.js >= 20.19（Vite 7 要求）
- pnpm（本仓库使用 pnpm workspace）

## 开发（Web 模式）

```bash
pnpm install
pnpm dev
```

- Web（Vite）：`http://127.0.0.1:5173`
- Server（Fastify）：`http://127.0.0.1:8787`

## 开发（桌面端 / Electron）

```bash
pnpm install
pnpm dev:electron
```

## 构建与运行（生产：Web + Server）

```bash
pnpm build
NODE_ENV=production pnpm start
```

打开：`http://127.0.0.1:8787`

> 如果你想显式指定 Web 静态资源目录，可设置：`AIPPT_WEB_DIST_DIR=/abs/path/to/apps/web/dist`。

## 打包桌面端（Electron）

```bash
pnpm build:electron
pnpm dist:electron
```

- 安装包输出目录：`apps/electron/release`
- 主要构建产物：
  - Web：`apps/web/dist`
  - Server：`apps/server/dist`
  - Electron：`apps/electron/dist`

本地预览（生产形态）：

```bash
pnpm start:electron
```

## 配置（API Key / 模型 / 生图）

首次运行后，在界面「设置」中填写：

- OpenAI：`baseURL` / `model` / `apiKey`
- 生图接口：`baseURL` / `apiKey`（以 `Authorization: Bearer <token>` 方式鉴权）
- 可选：HTTP 代理（同时作用于 OpenAI 与生图请求）

配置会落到本机，不写入项目目录。

## 本地数据位置

- 默认项目目录：`~/Documents/兴河PPT Projects`
  - 可通过 `AIPPT_PROJECTS_DIR` 覆盖
- 全局配置文件：`<configDir>/config.json`
  - macOS：`~/Library/Application Support/兴河PPT/config.json`
  - Windows：`%APPDATA%\\兴河PPT\\config.json`
  - Linux：`~/.config/兴河PPT/config.json`
  - 可通过 `AIPPT_CONFIG_DIR` 覆盖

项目目录结构（示例）：

```text
<project>/
  project.json
  aippt.sqlite
  images/
  exports/
  cache/        # 可选：生图缓存
```
