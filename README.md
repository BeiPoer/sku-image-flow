# 电商图片工作流

一个本地 Web 小工具，用模板化的方式把产品图生成流程固化下来：

- **模板**：一套详情图节点流程（节点名称、顺序、比例、提示词、是否依赖主图都可自定义）
- **SKU**：挂在某个模板下的具体产品，复用该模板的节点流程

一个模板下可以创建多个 SKU；不同品类（手表、服装、数码……）可以各建一个模板。

前端基于 React + [Semi Design](https://semi.design)（Vite 构建，源码在 `web/`），后端是单文件 Node 服务（`server.mjs`，零运行时依赖，内置 SQLite，负责 API 与托管构建产物 `dist/`）。

## 工作流程

1. 新建模板（空白 / 内置「手表」预设 / 复制现有模板）
2. 在模板里按需调整节点与提示词
3. 在模板下新建 SKU，上传主产品图和辅助参考图
4. 用视觉模型分析产品信息
5. 生成主图候选，人工选定 1 张主图
6. 基于产品图与选定主图，逐节点生成详情图候选
7. 每个节点人工选择最终图
8. 一键下载 zip，包含最终图片、`prompts.json`、`selected.json`

## 运行要求

- Node.js 24+
- OpenAI 兼容代理地址
- 支持 OpenAI Images API 和 Responses API

后端零运行时依赖，但前端（`web/`）需要先安装依赖并构建一次。

## 配置

复制 `.env.example` 为 `.env.local`，填入你的代理配置：

```env
OPENAI_API_KEY=你的key
OPENAI_BASE_URL=https://你的代理地址/v1
IMAGE_MODEL=gpt-image-2
VISION_TEXT_MODEL=gpt-5-mini
DEFAULT_CANDIDATES=4
PORT=3678
```

说明：

- `IMAGE_MODEL` 默认是 `gpt-image-2`
- `OPENAI_BASE_URL` 应填写 OpenAI 兼容代理的 `/v1` 地址
- `VISION_TEXT_MODEL` 用于产品图分析
- `DEFAULT_CANDIDATES` 是每次生成候选图数量的全局兜底值；模板可设自己的默认张数，SKU 也可单独覆盖

## 启动

首次（或前端有改动后）先构建前端，再启动服务：

```bash
npm run setup   # = 安装 web 依赖 + 构建前端（产物输出到 dist/）
npm start
```

之后日常只需 `npm start`。打开：

```text
http://127.0.0.1:3678
```

### 开发前端

改前端时可用 Vite 热更新（dev server 会把 `/api` 代理到 `:3678` 的 Node 后端，需另开一个终端跑 `npm start`）：

```bash
npm run web:dev     # http://127.0.0.1:5173
```

改完后 `npm run build` 重新产出 `dist/`，生产由 `npm start` 直接托管。

## 模板与节点

每个模板拥有自己的一套节点。可以在模板的「节点设置」里增删节点、改名称/顺序/比例/提示词，并标记哪个是主图节点、哪些节点依赖已选主图。

内置「手表」预设包含以下节点：

```text
01_主图
02_手模图
03_防水图
04_夜光图
05_礼盒图
06_首屏海报
07_细节图
08_展示图1
09_展示图2
10_展示图3
11_简介图
12_镜片功能图
```

说明：

- 标记为「依赖已选主图」的节点，必须先在主图节点选定一张主图后才能生成
- 改动模板的节点/提示词，会**实时**对该模板下所有 SKU 生效
- 删除节点采用软删除：已生成的历史图片仍会保留，只是不再出现在工作台
- 节点的内部标识（`node_key`）创建后不可更改，只能改显示名称

### 数据升级

首次升级到多模板版本时，会自动创建一个内置「手表」模板（含原有节点与你此前自定义的提示词），并把所有存量 SKU 归入它。无需手动迁移。

## 数据位置

运行后会生成：

```text
data/
  app.db
  uploads/
  generated/
```

`data/` 已加入 `.gitignore`。模板、节点、候选图、最终选择、prompt 和生成记录都会保存在本地。

## 导出

zip 默认只包含最终选中的图，文件名按所属模板的节点顺序命名：

```text
SKU123_01_主图.png
SKU123_02_手模图.png
SKU123_03_防水图.png
...
prompts.json
selected.json
```

候选历史仍保存在本地 `data/generated/` 中。
