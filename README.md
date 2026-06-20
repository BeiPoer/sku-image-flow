# 电商图片工作流

一个零依赖的本地 Web 小工具，用于把产品图生成流程固化成 SKU 工作流：

- 上传主产品图和辅助参考图
- 用视觉模型分析产品信息
- 生成主图候选 4 张
- 人工选择 1 张主图
- 基于产品图和选定主图生成详情图候选
- 每个节点人工选择最终图
- 一键下载 zip，包含最终图片、`prompts.json`、`selected.json`

## 运行要求

- Node.js 24+
- OpenAI 兼容代理地址
- 支持 OpenAI Images API 和 Responses API

本项目不需要 `npm install`。

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
- `DEFAULT_CANDIDATES` 默认每个节点生成 4 张候选图

## 启动

```bash
npm start
```

打开：

```text
http://127.0.0.1:3678
```

## 生产环境运行

`npm start` 只适合本地前台运行。生产环境建议用进程管理工具常驻运行，常见方式有下面几种。

### PM2（推荐）

最简单，适合个人服务器：

```bash
npm install -g pm2
pm2 start "npm start" --name sku-image-flow
pm2 save
pm2 startup
```

常用命令：

```bash
pm2 status
pm2 logs sku-image-flow
pm2 restart sku-image-flow
pm2 stop sku-image-flow
```

### systemd

更偏服务器原生方式，适合不想依赖 PM2 的环境。核心启动命令仍然是：

```bash
npm start
```

把它写进 systemd service 的 `ExecStart` 即可。

### nohup

临时部署可以用，不推荐长期生产使用：

```bash
nohup npm start > app.log 2>&1 &
```

生产环境对外访问时，通常再用 Nginx / Caddy 把域名反向代理到 `http://127.0.0.1:3678`。

## 默认图片节点

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

主图节点和详情页节点是分开的。详情图节点必须先选择一张主图，然后才允许生成。

## 数据位置

运行后会生成：

```text
data/
  app.db
  uploads/
  generated/
```

`data/` 已加入 `.gitignore`。候选图、最终选择、prompt 和生成记录都会保存在本地。

## 导出

zip 默认只包含最终选中的图：

```text
SKU123_01_主图.png
SKU123_02_手模图.png
SKU123_03_防水图.png
...
prompts.json
selected.json
```

候选历史仍保存在本地 `data/generated/` 中。
