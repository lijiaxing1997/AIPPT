# AIPPT

本项目是一个本地化 AI PPT 工具：创建/打开项目文件夹，AI 生成大纲与每页 16:9 图片，最终导出 PDF/PPTX（图片页）。

## 开发

```bash
pnpm install
pnpm dev
```

- Web（Vite）：`http://127.0.0.1:5173`
- Server（Fastify）：`http://127.0.0.1:8787`

## 构建与运行（生产）

```bash
pnpm build
pnpm start
```

## 本地数据位置

- 默认项目目录：`~/Documents/AIPPT Projects`
- 全局配置文件：`~/Library/Application Support/AIPPT/config.json`（macOS）

