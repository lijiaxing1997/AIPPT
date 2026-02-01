# AI PPT（本地多项目）分阶段开发文档

> 技术栈：React + TypeScript（前端） / Node.js（后端） / SQLite（每项目数据库）  
> 约束：图片落本地，数据库只存路径；对话走 OpenAI SDK；生图走你提供的接口（本文按 `test.py` 推断）；未来需要 Electron 封装（本阶段不做，但架构预留）。

## 0. 背景与目标

你要做的是一个“本地化 + 多 Agent”的 AI PPT 生成器：用户创建项目 → AI 生成大纲/每页内容 → 每页生成一张 16:9 图片（PPT 本质是图片页）→ 支持查看/编辑提示词并重绘 → 最终导出 PDF 或 PPTX。

### 0.1 术语定义

- **项目（Project）**：一个可在文件系统中打开的文件夹，包含该项目的 SQLite 数据库、图片与导出文件。
- **大纲（Outline）**：章节结构 + 每页标题/摘要（AI 生成，可版本化）。
- **风格（Theme/Style）**：全局视觉风格描述（供生图提示词复用），也可包含配色/字体建议（AI 生成，可版本化）。
- **页（Slide）**：一页 PPT 的结构化内容（标题、要点、讲稿、配图描述等）。
- **页图（Slide Image）**：该页最终呈现的 16:9 图片（可多版本：v1/v2/...）。

### 0.2 范围（MVP 必做 / 暂不做）

**MVP 必做**
- 创建项目（项目名 + 创作内容）
- AI 生成：章节/每页标题/概要内容 + 每页详细内容
- 生图：每页 16:9 图片；点击图片查看/编辑提示词并重新生成
- 导出：PDF、PPTX（按“图片铺满一页”的方式导出）

**暂不做（但尽量不阻碍未来扩展）**
- 像传统 PPT 软件那样对元素进行拖拽编辑（文本框、形状、图表可编辑）
- 云端协作/账号体系/多端同步
- Electron 打包与自动更新（仅做架构预留）

---

## 1. 核心用户流程（User Flows）

### 1.1 首次打开 / 打开最近项目（VSCode 风格）
1. 打开应用
2. 自动尝试打开“上次使用的项目”
3. 若没有：显示欢迎页（居中），提供
   - 最近项目列表（可点开）
   - 创建项目（输入项目名 + 创作内容）
   - 打开已有项目文件夹（选择目录）

### 1.2 项目内工作流（生成 → 查看 → 调整 → 导出）
1. 进入项目后，点击 **AI 生成**
2. 后端依次运行 Agents（大纲→风格→每页内容→每页提示词→生图）
3. UI 展示生成进度（按章节/按页）
4. 用户在右侧缩略图中选择某页
5. 中间上方展示该页图片；下方展示该页生图提示词（可编辑）
6. 点击 **重新生成**：为该页创建新版本图片并更新缩略图
7. 点击 **导出**：生成 PDF / PPTX 文件并落到项目 `exports/`

---

## 2. 数据与文件结构（为“打开项目文件夹”而设计）

### 2.1 项目目录结构（建议）
每个项目是一个文件夹，可被“打开项目文件夹”识别：

```
<ProjectRoot>/
  project.json
  aippt.sqlite
  images/
    slide-0001/
      v1.png
      v2.png
    slide-0002/
      v1.png
  exports/
    <projectName>-2026-01-31-153000.pdf
    <projectName>-2026-01-31-153000.pptx
  cache/            # 可选：缓存请求/中间产物
  logs/             # 可选：后端日志
```

**关键点**
- 数据库只存“相对路径”，例如 `images/slide-0001/v2.png`，从而保证项目文件夹可搬移/备份。
- `project.json` 用于快速识别该目录是否是合法项目，并记录 `schemaVersion` 以便未来迁移。

### 2.2 应用级配置（全局，不进项目）
用于保存：
- OpenAI 的 `baseURL` / `apiKey` / `model`（支持自定义）
- 生图接口的 `baseURL` / `apiKey`（或 token）/ 默认参数
- 最近项目列表、上次打开项目路径

建议位置（跨平台友好，Electron 也能复用）：
- macOS：`~/Library/Application Support/AIPPT/config.json`
- Windows：`%APPDATA%\\AIPPT\\config.json`
- Linux：`~/.config/aippt/config.json`

> MVP 阶段也可先用项目根目录的 `config.local.json`（gitignore）代替；但“最近项目/上次打开”依然建议放全局配置。

---

## 3. 系统架构（React TS + Node.js + SQLite）

### 3.1 组件划分
- **前端（React TS）**
  - 负责 VSCode 类布局、项目选择页、生成进度、缩略图列表、图片预览、提示词编辑、导出入口
- **后端（Node.js，建议也用 TS）**
  - 项目管理（创建/打开/最近）
  - SQLite 读写（每项目一个 DB 文件）
  - 多 Agent 编排（文本生成）
  - 生图接口调用、图片落盘、版本管理
  - 导出 PDF/PPTX

> 为 Electron 预留：所有“文件系统/路径/导出/SQLite”都放后端层；前端只通过 API 调用，后续可替换为 Electron IPC 而不改业务逻辑。

### 3.2 推荐工程组织（单仓库）
（你可确认是否用 `pnpm` workspace；否则也可 `npm`）

```
apps/
  web/        # React + Vite
  server/     # Node + TS（Fastify/Express 任选）
packages/
  shared/     # 共享 types、zod schema、常量
```

---

## 4. 多 Agent 架构设计

### 4.1 Agent 划分（与你的要求一一对应）
1. **OutlineAgent（生成大纲）**
   - 输入：项目创作内容（textarea）、可选的受众/语气（页数默认不限制，由 AI 自行决定）
   - 输出：章节（sections）+ 每页标题 + 每页“概括内容”
2. **ThemeAgent（生成主题风格）**
   - 输入：项目创作内容 + 大纲摘要
   - 输出：全局风格描述（用于拼接到每页提示词），可附带配色/字体建议
3. **SlideContentAgent（生成每页具体内容）**
   - 输入：大纲中某一页的信息 + 项目创作内容
   - 输出：该页的详细内容（要点、讲稿、数据点、图示描述等）
4. **SlideImagePromptAgent（生成每页图片提示词）**
   - 输入：ThemeAgent 风格 + SlideContentAgent 的图示描述
   - 输出：该页可直接用于生图的提示词（默认 16:9）
5. **SlideImageRenderAgent（生成每页图片）**
   - 输入：该页图片提示词
   - 输出：图片文件落盘路径 + 生成元信息（耗时、provider、返回的 responseId 等）

### 4.2 编排方式（Pipeline）
建议后端提供一个“生成管线”：
- `GenerateOutlineJob`
- `GenerateThemeJob`
- `GenerateSlidesJob`（按页并发：默认不限制并发数，按页数全并发；保留配置项以便未来限流）
- `RenderSlideImagesJob`（按页并发：最大并发 5；保留配置项以便未来调整）

并在数据库中记录每页状态：
- `pending` → `generating_text` → `text_ready` → `generating_image` → `ready`
- `error`（记录 error message + 可重试）

重试建议：
- OpenAI 调用失败自动重试 3 次
- 生图调用失败不自动重试（失败立即记录 error，交给 UI 手动重试/重绘）
- 若 `Outline/Theme` 失败：阻断本次生成；若某一页 `Slide 文本/图片` 失败：记录错误并跳过该页，继续生成其它页

### 4.3 输出格式约束（强建议 JSON Schema + 校验）
为保证可控性：
- 所有 Agent 输出统一要求 **JSON**（不要夹杂 Markdown）
- 后端用 `zod`（或 `ajv`）校验结构，不合法则自动重试（最多 3 次）或回退策略

---

## 5. SQLite 数据模型（建议）

> 以“每项目一个 SQLite 文件”为前提，便于打开项目文件夹、备份、迁移。

### 5.1 表结构（最小可用）
- `projects`
  - `id`, `name`, `root_path`, `source_text`, `created_at`, `updated_at`
- `outline_versions`
  - `id`, `project_id`, `version`, `outline_json`, `created_at`
- `theme_versions`
  - `id`, `project_id`, `version`, `theme_json`, `created_at`
- `slides`
  - `id`, `project_id`, `section_index`, `slide_index`
  - `title`, `summary`
  - `content_json`（详细内容）
  - `status`, `error_message`, `updated_at`
- `slide_image_versions`
  - `id`, `slide_id`, `version`
  - `prompt_text`
  - `image_path`（相对路径）
  - `provider`, `request_json`, `response_json`（可选，用于复现）
  - `created_at`

### 5.2 版本策略
- 大纲/风格：整体版本（v1/v2），便于“一键重生成整套”
- 单页图片：每次重绘产生新版本，默认展示最新版本，可回退

---

## 6. 后端 API 设计（建议）

> MVP 阶段建议 REST；后续 Electron 可换 IPC 但保持同样的 handler 结构。

### 6.1 项目
- `POST /api/projects`
  - body：`{ name, sourceText, rootDir? }`
  - 创建项目文件夹、初始化 sqlite、写入 `project.json`
- `GET /api/projects/recent`
- `POST /api/projects/open`
  - body：`{ projectRootPath }`
- `GET /api/projects/:projectId`

### 6.2 生成（Jobs）
- `POST /api/projects/:projectId/generate`
  - body：`{ mode: "all" | "outline" | "theme" | "slides" | "images" }`
  - 返回 jobId，前端轮询或 SSE/WebSocket 订阅进度
- `GET /api/projects/:projectId/progress`

### 6.3 Slide 查看与重绘
- `GET /api/projects/:projectId/slides`
- `GET /api/slides/:slideId`
- `POST /api/slides/:slideId/image/generate`
  - body：`{ promptText?, useLatestTheme?: true }`

### 6.4 导出
- `POST /api/projects/:projectId/export`
  - body：`{ type: "pdf" | "pptx" }`
- `GET /api/projects/:projectId/exports`

---

## 7. 生图接口对接（基于你给的 `test.py` 推断）

你提供的测试脚本核心信息如下（**已去除敏感 key/token**）：
- **URL 形态**：`POST https://api.vectorengine.ai/v1beta/models/gemini-3-pro-image-preview:generateContent`（`?key=` 可不填）
- **Header**：`Authorization: Bearer <TOKEN>`，`Content-Type: application/json`
- **请求体**（核心字段）：
  - `contents[0].role = "user"`
  - `contents[0].parts[0].text = sum_prompt`
  - `generationConfig.responseModalities = ["TEXT","IMAGE"]`
  - `generationConfig.imageConfig = { aspectRatio: "16:9", imageSize: "2K" }`

### 7.1 Node 侧实现要点
- 将“风格 prompt + 页内容 prompt”拼接为 `sum_prompt`（与你脚本一致）
- 处理返回 JSON 中可能出现的 `inlineData.data`（base64）与 `inlineData.mimeType`
  - 你的脚本是“递归遍历 JSON 找 inlineData”，Node 也建议这么做，鲁棒性高
- 落盘时按 `slide-0001/vN.png` 组织，并写入 `slide_image_versions`

### 7.2 已确认（接口策略）
1. `?key=` **不必填**，`Authorization: Bearer <TOKEN>` 即可鉴权。
2. 返回 JSON 字段不强依赖：按 `test.py` 的做法“递归查找 `inlineData` 并保存图片”，同时把原始响应（raw text/json）落盘/入库便于排查。
3. 并发/QPS：最大并发 **5**（例如 12 张会分批排队生成）。
4. `imageSize/aspectRatio` 先按脚本默认 `aspectRatio=16:9`、`imageSize=2K`；后续如需可做成配置项。

---

## 8. UI/交互设计（VSCode-like 布局）

### 8.1 总体布局比例（默认）
- 左侧：大纲/风格（20%）
- 中间：预览 + 提示词编辑（60%）
  - 上：图片预览（高度 70%）
  - 下：提示词编辑框 + 重新生成按钮（高度 30%）
- 右侧：缩略图导航（20%，可滚动）

> 建议三列、上下分割都做成“可拖拽调整”的面板，默认符合你的 20/60/20 + 70/30，用户可改。

### 8.2 交互细节
- 点击右侧缩略图：切换当前页（中间更新图片与提示词）
- 点击中间图片：同样聚焦当前页，并可提供“查看当前版本/历史版本”入口
- 提示词编辑：
  - 有“未保存”状态（dirty）
  - 点击“重新生成”时，默认使用编辑后的提示词生成新版本
- 内容编辑：
  - 点击“保存内容”后，该页状态为“内容就绪（text_ready）”
  - 当状态为内容就绪时，“保存内容”右侧显示“生成图片（单页）”，便于用户手动逐页生成（与第 4 步“生成图片”全量生成不同）
- 生成进度：
  - 左侧大纲节点与右侧缩略图要能显示状态（生成中/失败/完成）
  - 失败可点击重试（仅当前页或从该页继续）

### 8.3 视觉风格建议（偏 VSCode 深色）
（来自 `ui-ux-pro-max` 的暗色风格与排版建议）
- Dark Mode：背景可用 `#0D1117` / `#121212`，文字 `#E6EDF3`，边框 `#30363D`
- 字体建议：
  - UI：`DM Sans` / `IBM Plex Sans`
  - 提示词编辑器：`JetBrains Mono`
- 图标：使用 SVG 图标库（如 `lucide-react`），避免 emoji 作为图标
- 可访问性：所有可交互元素保留清晰的 focus ring（键盘可用）

---

## 9. 导出设计（PDF / PPTX）

由于“每页就是一张 16:9 图片”，导出可以非常稳健：

### 9.1 导出 PDF
- 每页 PDF = 一张图片铺满
- Node 侧可用 `pdf-lib` 或类似库
- 生成文件写入 `exports/` 并记录到 DB

### 9.2 导出 PPTX
- 每页 PPTX = 一张图片作为背景
- Node 侧可用 `pptxgenjs`
- 可选：把每页的标题/要点作为备注（speaker notes）写入（不影响视觉）

### 9.3 已确认（导出期望）
- PPTX 只需要“图片页”，不要求可编辑文本元素。

---

## 10. 分阶段开发计划（里程碑 + 验收标准）

### Phase 0：工程初始化（1-2 天）
**目标**：跑起来一个“前后端 + SQLite + 项目目录”的骨架。
- 初始化 monorepo（或前后端分目录）
- 前端：React TS + 基础布局框架
- 后端：Node 服务 + 配置加载 + SQLite 连接
- 定义 `project.json` 与目录结构

**验收**
- `创建项目` 可生成项目文件夹、`aippt.sqlite`、`project.json`
- `打开项目文件夹` 可正确识别并载入

---

### Phase 1：VSCode-like UI + 项目管理（2-4 天）
**目标**：把你描述的 UI 骨架与项目流打通，但先不接 AI。
- 欢迎页：最近项目 / 创建 / 打开
- 主界面三栏布局 + 上下分割
- 右侧缩略图列表（先用占位图/空状态）
- 左侧大纲树（先用占位数据）
- 中间提示词编辑框（支持编辑状态）

**验收**
- 启动自动打开“上次项目”，否则展示欢迎页
- 三栏布局比例符合默认 20/60/20，可滚动、可切换当前页（用假数据）

---

### Phase 2：文本生成（大纲/风格/每页内容）（3-6 天）
**目标**：接入 OpenAI SDK，把多 Agent 的“文本链路”跑通。
- 配置文件支持 `openai.baseURL` / `openai.apiKey` / `openai.model`（全部支持自定义）
- OutlineAgent：生成章节与页列表，写入 `outline_versions` + `slides`
- ThemeAgent：生成风格描述，写入 `theme_versions`
- SlideContentAgent：逐页生成详细内容，写入 `slides.content_json`（失败重试 3 次，仍失败则该页记录错误并跳过）
- 前端展示：
  - 左侧：章节树 + 当前风格摘要
  - 右侧：根据 `slides` 生成缩略图占位（显示标题与状态）
  - 中间下：显示该页“建议图片描述/提示词草稿”（先不生图）

**验收**
- 点击 **AI 生成** 后：能看到章节与每页标题/概要；每页有详细内容（结构化）
- 任意一页可在 UI 中查看到“该页的图示描述/提示词草稿”

---

### Phase 3：生图 + 提示词编辑 + 版本管理（4-8 天）
**目标**：对接你的生图接口，生成并展示每页图片，支持编辑重绘。
- SlideImagePromptAgent：输出最终生图 prompt（默认 16:9）
- SlideImageRenderAgent：调用生图接口并落盘，写入 `slide_image_versions`（最大并发 5；失败则记录错误并跳过，可手动重试/重绘）
- UI：
  - 中间上：展示图片
  - 中间下：展示并可编辑 prompt，点击重新生成生成新版本
  - 右侧缩略图：真实图片缩略图 + 状态（生成中/失败/完成）

**验收**
- 每页都能生成 16:9 图片并展示
- 点击图片或缩略图能看到生成该图的 prompt
- 修改 prompt 后点击重新生成，会产生新版本图片并更新展示

---

### Phase 4：导出 PDF/PPTX + 稳定性（2-5 天）
**目标**：实现最终交付能力，并补齐稳定性与可用性。
- 导出 PDF：按页图片合成
- 导出 PPTX：按页图片铺满
- 导出进度与失败提示
- 基础缓存与重试：
  - 同 prompt 重复生成可选命中缓存（可开关）
  - OpenAI 网络错误重试（最多 3 次）；生图不自动重试；超时（可配置）。生图默认最大并发 5（保留配置项以便未来调整）

**验收**
- 一键导出 PDF/PPTX 成功，文件可打开且页数/顺序正确
- 生成过程失败有错误提示，可重试

---

### Phase 5（可选/后续）：Electron 适配（不在当前阶段实现）
**目标**：把 Web 形态无痛迁移为桌面端。
- 保持后端模块化：HTTP 可替换为 IPC
- 全局配置落 `appData`
- 本地文件访问与静态资源加载适配

#### ✅ 已落地（2026-01-31）
- 新增 `apps/electron/`：Electron 主进程启动窗口；开发态加载 Vite，生产态启动内置 Fastify 并加载同源页面。
- 后端拆出可复用启动函数：`apps/server/src/server.ts` 导出 `startServer()`，Electron 可直接调用（避免解析日志/端口）。
- 配置目录/默认项目目录可被 Electron 覆盖：
  - `AIPPT_CONFIG_DIR`：指向 `app.getPath("userData")`
  - `AIPPT_PROJECTS_DIR`：指向 `app.getPath("documents") + "/AIPPT Projects"`
- 桌面交互适配：
  - 欢迎页“打开项目”支持调用系统目录选择器（Electron IPC）
  - 导出/图片“打开”在 Electron 下走 `shell.openExternal`（避免在应用内弹新窗口）

#### 运行方式
- 开发（推荐）：`pnpm dev:electron`
  - 同时启动：`apps/server`（8787）、`apps/web`（Vite）、`apps/electron`
- 生产预览：`pnpm start:electron`
  - 会先 build（web/server/electron），再启动 Electron（内置 server 会选用随机端口并同源加载 UI）

---

## 11. 已确认的关键决策（根据你最新反馈）

1. **生图接口**
   - `?key=` 不必填；`Authorization: Bearer` 是唯一鉴权方式
   - 返回 JSON 不做字段强依赖：按 `test.py` 递归提取 `inlineData` 保存图片，同时保留原始响应用于排查
   - 最大并发 5：按页排队生成（例如 12 页 → 5 路并发）
2. **文本模型**
   - 支持自定义 OpenAI `baseURL` / `apiKey` / `model`
   - 所有 Agent 输出必须为严格 JSON
3. **PPTX 导出期望**
   - 图片页（不需要可编辑文本元素）
4. **项目管理**
   - 默认项目目录：`~/Documents/AIPPT Projects`
   - 不需要“导入/导出项目压缩包”
5. **页数与生成策略**
   - 页数不限制：由 AI 自行决定（当前不提供“指定页数/章节数”的强约束）
   - 文本生成失败：自动重试 3 次；仍失败则跳过，并保存错误信息（便于 UI 展示与后续手动重试）
   - 生图失败：不自动重试；保存错误信息，支持手动重试/重绘
