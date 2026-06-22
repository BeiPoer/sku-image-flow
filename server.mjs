import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(dataDir, "uploads");
const generatedDir = path.join(dataDir, "generated");
const dbPath = path.join(dataDir, "app.db");
const publicDir = path.join(rootDir, "public");

await loadEnvFile(path.join(rootDir, ".env"));
await loadEnvFile(path.join(rootDir, ".env.local"));

const config = {
  port: Number.parseInt(process.env.PORT || "3678", 10),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  imageModel: process.env.IMAGE_MODEL || "gpt-image-2",
  visionTextModel: process.env.VISION_TEXT_MODEL || "gpt-5-mini",
  defaultCandidates: Number.parseInt(process.env.DEFAULT_CANDIDATES || "4", 10) || 4
};

// 图片比例 → 接口尺寸
const ASPECT_SIZE = {
  "1:1": "1024x1024",
  "3:4": "768x1024",
  "4:3": "1024x768",
  "16:9": "1280x720",
  "9:16": "720x1280"
};

const nodes = [
  ["main", 1, "主图", "干净真实的产品主视觉，与详情页素材分开管理。", false, "生成一张电商产品主图。画面干净、真实、高级，产品主体清晰，正视或轻微平角，突出产品材质、颜色和包装质感。不要改变产品结构、logo、表盘、刻度、指针、表带材质和颜色。暂不强制白底，但背景应简洁，不要生成多余文字、水印或错误标识。"],
  ["hand_model", 2, "手模图", "产品佩戴或手持场景，突出真实使用感。", true, "生成一张手模佩戴或手持产品的电商图。手部自然、皮肤质感真实，产品占比清晰，突出佩戴效果和高级感。不要改变产品外观，不要添加错误文字。"],
  ["waterproof", 3, "防水图", "突出防水能力的场景图。", true, "生成一张防水主题电商图。使用真实水花、水珠或浅水场景突出防水能力，画面有冲击力但产品主体必须清晰真实。不要改变产品外观，不要生成错误文字。"],
  ["luminous", 4, "夜光图", "突出夜光和暗光质感。", true, "生成一张夜光主题电商图。暗光环境中突出产品夜光效果、表盘质感和高级科技感，光线真实。不要改变产品结构、logo、刻度和颜色，不要生成错误文字。"],
  ["gift_box", 5, "礼盒图", "产品放入礼盒或包装盒的场景。", true, "生成一张礼盒包装场景图。产品放在精致礼盒或包装盒中，产品占比大、距离近，突出礼赠感、高级感和真实材质。不要改变产品主体，不要生成错误文字。"],
  ["hero_poster", 6, "首屏海报", "详情页首屏用的强视觉海报。", true, "生成一张详情页首屏电商海报。画面美观大气，有设计感和视觉冲击力，排版大胆但不要杂乱，突出产品调性、材质和卖点。产品必须真实立体，保持主体一致。"],
  ["detail", 7, "细节图", "侧面、正面、表带或局部细节展示。", true, "生成一张产品细节展示图，包含正面、侧面、表带或关键局部细节，突出材质、工艺和设计。可以使用分区构图，但产品结构必须与参考图一致，不要生成错误文字。"],
  ["display_1", 8, "展示图1", "场景展示图第一张。", true, "生成一张产品展示图，使用简洁高级场景突出产品外观、质感和电商吸引力。产品主体清晰，构图稳定，保持产品一致。"],
  ["display_2", 9, "展示图2", "场景展示图第二张。", true, "生成另一张产品展示图，风格与整套图片统一，但构图和背景与上一张有差异。突出产品高级感和真实感，保持产品一致。"],
  ["display_3", 10, "展示图3", "场景展示图第三张。", true, "生成第三张产品展示图，延续统一视觉风格，使用不同角度或场景强化产品质感。不要改变产品结构、logo、颜色和比例。"],
  ["intro", 11, "简介图", "产品简介/卖点展示图。", true, "生成一张产品简介图，用电商视觉方式突出产品核心卖点、材质和高级感。可以有清晰排版感，但不要生成乱码或错误文字；如果不能保证文字准确，请保持无文字。"],
  ["lens_feature", 12, "镜片功能图", "镜片或核心功能展示图。", true, "生成一张镜片或核心功能展示图，突出镜面、表盘、材质、防刮或通透质感等功能特征。画面专业、清晰、高级，保持产品主体一致，不要生成错误文字。"]
].map(([key, order, label, description, usesSelectedMain, prompt]) => ({ key, order, label, description, usesSelectedMain, prompt, defaultAspect: key === "main" ? "1:1" : "9:16" }));

async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = await readFile(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const consistencyRules = [
  "必须保持产品主体高度一致，尤其是外形轮廓、logo、表盘结构、刻度、指针、颜色、表带材质和比例。",
  "不得添加参考图中不存在的按钮、标识、宝石、纹理、品牌文字或装饰。",
  "不得改变产品颜色、材质、表盘布局、包装结构和品牌标识。",
  "产品要真实、立体、清晰，不要水印，不要乱码，不要错误文字。"
];

await ensureDirs();
const db = initDb();

function ensureApiConfig() {
  if (!config.openaiApiKey) {
    throw new Error("缺少 OPENAI_API_KEY，请先配置 .env.local 或环境变量。");
  }
}

async function ensureDirs() {
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(uploadDir, { recursive: true }),
    mkdir(generatedDir, { recursive: true })
  ]);
}

function ensureColumn(database, table, name, ddl) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function initDb() {
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS sku (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      notes TEXT,
      analysis_json TEXT,
      selected_main_asset_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS asset (
      id TEXT PRIMARY KEY,
      sku_id TEXT NOT NULL,
      role TEXT NOT NULL,
      file_path TEXT NOT NULL,
      source_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sku_id) REFERENCES sku(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS generation_task (
      id TEXT PRIMARY KEY,
      sku_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      input_asset_ids TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (sku_id) REFERENCES sku(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS candidate_image (
      id TEXT PRIMARY KEY,
      sku_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      file_path TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0,
      reject_reason TEXT,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sku_id) REFERENCES sku(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES generation_task(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_asset_sku ON asset(sku_id);
    CREATE INDEX IF NOT EXISTS idx_task_sku ON generation_task(sku_id);
    CREATE INDEX IF NOT EXISTS idx_candidate_sku_node ON candidate_image(sku_id, node_key);
  `);
  ensureColumn(database, "sku", "candidate_count", "candidate_count INTEGER");
  ensureColumn(database, "sku", "node_aspects_json", "node_aspects_json TEXT");
  return database;
}

function now() {
  return new Date().toISOString();
}

function safeFileName(name) {
  return (name || "file").replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "_").replace(/_+/g, "_").slice(0, 90) || "file";
}

function inferMime(filePathOrName) {
  const ext = path.extname(filePathOrName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function extensionFromMime(mime) {
  if (mime?.includes("jpeg")) return ".jpg";
  if (mime?.includes("webp")) return ".webp";
  return ".png";
}

function row(statement, ...args) {
  return db.prepare(statement).get(...args) || null;
}

function rows(statement, ...args) {
  return db.prepare(statement).all(...args);
}

function createSku({ name, notes }) {
  const id = randomUUID();
  const ts = now();
  db.prepare("INSERT INTO sku (id, name, notes, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)")
    .run(id, name, notes || null, ts, ts);
  return getSku(id);
}

function getSku(id) {
  return row("SELECT * FROM sku WHERE id = ?", id);
}

function updateSku(id, input) {
  const current = getSku(id);
  if (!current) throw new Error("SKU 不存在。");
  db.prepare(`UPDATE sku SET name = ?, notes = ?, analysis_json = ?, selected_main_asset_id = ?, status = ?, updated_at = ? WHERE id = ?`)
    .run(
      input.name ?? current.name,
      input.notes === undefined ? current.notes : input.notes,
      input.analysis_json === undefined ? current.analysis_json : input.analysis_json,
      input.selected_main_asset_id === undefined ? current.selected_main_asset_id : input.selected_main_asset_id,
      input.status ?? current.status,
      now(),
      id
    );
  return getSku(id);
}

async function removeSku(id) {
  const current = getSku(id);
  if (!current) throw new Error("SKU 不存在。");
  db.prepare("DELETE FROM sku WHERE id = ?").run(id);
  await Promise.all([
    removeSkuDir(path.join(uploadDir, id)),
    removeSkuDir(path.join(generatedDir, id))
  ]);
}

async function removeSkuDir(dir) {
  if (!isInside(dataDir, dir)) throw new Error("删除路径越界。");
  await rm(dir, { recursive: true, force: true });
}

function createAsset({ skuId, role, filePath, sourceType }) {
  const id = randomUUID();
  db.prepare("INSERT INTO asset (id, sku_id, role, file_path, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, skuId, role, filePath, sourceType, now());
  return row("SELECT * FROM asset WHERE id = ?", id);
}

function createTask({ skuId, nodeKey, prompt, inputAssetIds }) {
  const id = randomUUID();
  const ts = now();
  db.prepare(`INSERT INTO generation_task (id, sku_id, node_key, status, prompt, input_asset_ids, created_at, updated_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`)
    .run(id, skuId, nodeKey, prompt, JSON.stringify(inputAssetIds), ts, ts);
  return row("SELECT * FROM generation_task WHERE id = ?", id);
}

function updateTask(id, { status, error = null }) {
  db.prepare("UPDATE generation_task SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(status, error, now(), id);
}

function createCandidate({ skuId, taskId, nodeKey, filePath, prompt }) {
  const id = randomUUID();
  db.prepare(`INSERT INTO candidate_image (id, sku_id, task_id, node_key, file_path, selected, prompt, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, skuId, taskId, nodeKey, filePath, prompt, now());
  return row("SELECT * FROM candidate_image WHERE id = ?", id);
}

function getNode(key) {
  const node = nodes.find((item) => item.key === key);
  if (!node) throw new Error(`未知图片节点：${key}`);
  return node;
}

function parseAnalysis(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function parseAspects(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function buildImagePrompt({ node, sku, retryHint }) {
  const analysis = parseAnalysis(sku.analysis_json);
  const parts = [
    `任务：${node.prompt}`,
    `SKU/产品名称：${sku.name}`,
    sku.notes ? `补充信息：${sku.notes}` : "",
    analysis?.category ? `产品品类：${analysis.category}` : "",
    analysis?.style ? `产品风格：${analysis.style}` : "",
    analysis?.material ? `材质信息：${analysis.material}` : "",
    Array.isArray(analysis?.colors) && analysis.colors.length ? `主要颜色：${analysis.colors.join("、")}` : "",
    Array.isArray(analysis?.sellingPoints) && analysis.sellingPoints.length ? `核心卖点：${analysis.sellingPoints.join("、")}` : "",
    "一致性要求：",
    ...consistencyRules.map((item) => `- ${item}`),
    Array.isArray(analysis?.consistencyRules) && analysis.consistencyRules.length ? "补充一致性约束：" : "",
    ...(Array.isArray(analysis?.consistencyRules) ? analysis.consistencyRules.map((item) => `- ${item}`) : []),
    retryHint ? `本次重跑修正重点：${retryHint}` : "",
    "输出要求：生成高质量电商图片，产品占比清晰，构图专业。"
  ];
  return parts.filter(Boolean).join("\n");
}

function buildAnalysisPrompt(sku) {
  return [
    "你是电商图片生成工作流里的产品分析助手。",
    "请根据上传的产品图和用户备注，提炼后续生图所需的信息。",
    "只返回 JSON，不要输出 Markdown。",
    "JSON 字段：category, style, material, colors, sellingPoints, consistencyRules, raw。",
    "consistencyRules 要重点描述哪些外观元素必须保持一致。",
    `SKU/产品名称：${sku.name}`,
    sku.notes ? `用户备注：${sku.notes}` : "用户备注：无"
  ].join("\n");
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function sendJson(res, statusCode, data) {
  const body = Buffer.from(JSON.stringify(data, null, 2));
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length
  });
  res.end(body);
  return true;
}

function sendHtml(res, html) {
  const body = Buffer.from(html);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length
  });
  res.end(body);
}

async function serveFile(res, filePath, contentType, cacheControl) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const info = await stat(filePath);
  res.writeHead(200, {
    "Content-Type": contentType || inferMime(filePath),
    "Content-Length": info.size,
    "Cache-Control": cacheControl || "private, max-age=3600"
  });
  createReadStream(filePath).pipe(res);
}

function isInside(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${path.sep}`);
}

async function parseMultipart(req, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("缺少 multipart boundary。");
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const binary = buffer.toString("binary");
  const parts = binary.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];
  for (const part of parts) {
    const cleaned = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const index = cleaned.indexOf("\r\n\r\n");
    if (index < 0) continue;
    const rawHeaders = cleaned.slice(0, index);
    let body = cleaned.slice(index + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    const nameMatch = /name="([^"]+)"/i.exec(rawHeaders);
    if (!nameMatch) continue;
    const filenameMatch = /filename="([^"]*)"/i.exec(rawHeaders);
    const contentTypeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(rawHeaders);
    const valueBuffer = Buffer.from(body, "binary");
    if (filenameMatch && filenameMatch[1]) {
      files.push({
        fieldName: nameMatch[1],
        filename: filenameMatch[1],
        contentType: contentTypeMatch?.[1] || "application/octet-stream",
        buffer: valueBuffer
      });
    } else {
      fields[nameMatch[1]] = new TextDecoder().decode(valueBuffer);
    }
  }
  return { fields, files };
}

async function apiFetch(pathname, init) {
  ensureApiConfig();
  const response = await fetch(`${config.openaiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI 兼容接口请求失败：${response.status} ${response.statusText}\n${text}`);
  }
  return response;
}

function normalizeImage(item) {
  if (typeof item.b64_json === "string") return { b64: item.b64_json, mimeType: "image/png" };
  if (typeof item.url === "string") throw new Error("接口返回 URL，但当前工具期望 b64_json。请让代理返回 base64。");
  throw new Error("接口返回中没有可识别的图片数据。");
}

async function createImages(prompt, count, size) {
  const response = await apiFetch("/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.imageModel,
      prompt,
      n: count,
      size: size || "1024x1024",
      response_format: "b64_json"
    })
  });
  const json = await response.json();
  return (json.data || []).map(normalizeImage);
}

async function editImages(prompt, count, referenceAssets, size) {
  const form = new FormData();
  form.set("model", config.imageModel);
  form.set("prompt", prompt);
  form.set("n", String(count));
  form.set("size", size || "1024x1024");
  form.set("response_format", "b64_json");
  for (const asset of referenceAssets.slice(0, 16)) {
    const bytes = await readFile(asset.file_path);
    form.append("image[]", new Blob([bytes], { type: inferMime(asset.file_path) }), path.basename(asset.file_path));
  }
  const response = await apiFetch("/images/edits", { method: "POST", body: form });
  const json = await response.json();
  return (json.data || []).map(normalizeImage);
}

async function generateImages({ prompt, count, referenceAssets, size }) {
  if (referenceAssets?.length) return editImages(prompt, count, referenceAssets, size);
  return createImages(prompt, count, size);
}

async function analyzeProduct(sku, imageAssets) {
  const content = [{ type: "input_text", text: buildAnalysisPrompt(sku) }];
  for (const asset of imageAssets.slice(0, 8)) {
    const bytes = await readFile(asset.file_path);
    content.push({
      type: "input_image",
      image_url: `data:${inferMime(asset.file_path)};base64,${bytes.toString("base64")}`
    });
  }
  const response = await apiFetch("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.visionTextModel,
      input: [{ role: "user", content }]
    })
  });
  const json = await response.json();
  if (typeof json.output_text === "string") return json.output_text;
  const parts = [];
  for (const item of json.output || []) {
    for (const contentItem of item.content || []) {
      if (typeof contentItem.text === "string") parts.push(contentItem.text);
    }
  }
  return parts.join("\n").trim();
}

function parseJsonLoose(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { raw: text };
  }
}

async function saveGeneratedImage({ skuId, nodeKey, b64, mimeType, index }) {
  const dir = path.join(generatedDir, skuId, nodeKey);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}_cand_${String(index + 1).padStart(2, "0")}${extensionFromMime(mimeType || "image/png")}`);
  await writeFile(filePath, Buffer.from(b64, "base64"));
  return filePath;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/skus") {
    return sendJson(res, 200, { skus: rows("SELECT * FROM sku ORDER BY updated_at DESC") });
  }

  if (req.method === "POST" && url.pathname === "/api/skus") {
    const body = await readJson(req);
    if (!body.name?.trim()) return sendJson(res, 400, { error: "SKU 名称不能为空" });
    return sendJson(res, 200, { sku: createSku({ name: body.name.trim(), notes: body.notes?.trim() || null }) });
  }

  const skuMatch = /^\/api\/skus\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(url.pathname);
  if (!skuMatch) return false;
  const [, skuId, action, candidateId, subAction] = skuMatch;
  const sku = getSku(skuId);
  if (!sku) return sendJson(res, 404, { error: "SKU 不存在" });

  if (req.method === "DELETE" && !action) {
    await removeSku(skuId);
    return sendJson(res, 200, { sku });
  }

  if (req.method === "GET" && !action) {
    const assets = rows("SELECT * FROM asset WHERE sku_id = ? ORDER BY created_at ASC", skuId).map((asset) => ({
      ...asset,
      url: `/api/file?path=${encodeURIComponent(asset.file_path)}`
    }));
    const candidates = rows("SELECT * FROM candidate_image WHERE sku_id = ? ORDER BY created_at DESC", skuId).map((candidate) => ({
      ...candidate,
      url: `/api/file?path=${encodeURIComponent(candidate.file_path)}`
    }));
    const tasks = rows("SELECT * FROM generation_task WHERE sku_id = ? ORDER BY created_at DESC", skuId);
    return sendJson(res, 200, { sku, assets, candidates, tasks, nodes, defaults: { candidateCount: config.defaultCandidates } });
  }

  if (req.method === "POST" && action === "upload") {
    const { fields, files } = await parseMultipart(req, req.headers["content-type"]);
    const role = fields.role || "source";
    if (!files.length) return sendJson(res, 400, { error: "没有收到上传文件" });
    const saved = [];
    const dir = path.join(uploadDir, skuId);
    await mkdir(dir, { recursive: true });
    for (const file of files) {
      const ext = path.extname(file.filename) || extensionFromMime(file.contentType);
      const filePath = path.join(dir, `${Date.now()}_${role}_${safeFileName(path.basename(file.filename, ext))}${ext}`);
      await writeFile(filePath, file.buffer);
      saved.push(createAsset({ skuId, role, filePath, sourceType: "upload" }));
    }
    updateSku(skuId, { status: "uploaded" });
    return sendJson(res, 200, { assets: saved });
  }

  if (req.method === "POST" && action === "analyze") {
    const imageAssets = rows("SELECT * FROM asset WHERE sku_id = ? AND source_type = 'upload' ORDER BY created_at ASC", skuId);
    if (!imageAssets.length) return sendJson(res, 400, { error: "请先上传产品图" });
    const text = await analyzeProduct(sku, imageAssets);
    const analysis = parseJsonLoose(text);
    const updated = updateSku(skuId, { analysis_json: JSON.stringify(analysis, null, 2), status: "analyzed" });
    return sendJson(res, 200, { sku: updated, analysis });
  }

  if (req.method === "POST" && action === "settings") {
    const body = await readJson(req);
    const aspects = parseAspects(sku.node_aspects_json);
    let count = sku.candidate_count;
    if (body.count !== undefined && body.count !== null && body.count !== "") {
      count = Math.max(1, Math.min(8, Number.parseInt(String(body.count), 10) || config.defaultCandidates));
    }
    if (body.nodeKey) {
      getNode(body.nodeKey);
      if (!ASPECT_SIZE[body.aspect]) return sendJson(res, 400, { error: "不支持的图片比例" });
      aspects[body.nodeKey] = body.aspect;
    }
    db.prepare("UPDATE sku SET candidate_count = ?, node_aspects_json = ?, updated_at = ? WHERE id = ?")
      .run(count ?? null, JSON.stringify(aspects), now(), skuId);
    return sendJson(res, 200, { sku: getSku(skuId) });
  }

  if (req.method === "POST" && action === "generate") {
    const contentType = req.headers["content-type"] || "";
    let body;
    let retryFiles = [];
    if (contentType.includes("multipart/form-data")) {
      const { fields, files } = await parseMultipart(req, contentType);
      body = { nodeKey: fields.nodeKey, count: fields.count, retryHint: fields.retryHint };
      retryFiles = files.filter((file) => (file.contentType || "").startsWith("image/")).slice(0, 5);
    } else {
      body = await readJson(req);
    }
    const node = getNode(body.nodeKey);
    const uploadedAssets = rows("SELECT * FROM asset WHERE sku_id = ? AND source_type = 'upload' ORDER BY created_at ASC", skuId);
    if (!uploadedAssets.length) return sendJson(res, 400, { error: "请先上传产品图" });
    const referenceAssets = [...uploadedAssets];
    if (node.usesSelectedMain) {
      if (!sku.selected_main_asset_id) return sendJson(res, 400, { error: "请先选择一张主图" });
      const selectedMain = row("SELECT * FROM asset WHERE id = ?", sku.selected_main_asset_id);
      if (selectedMain) referenceAssets.push(selectedMain);
    }
    // 本次重跑临时上传的修正参考图：与文字提示一起作为生成输入
    if (retryFiles.length) {
      const retryDir = path.join(uploadDir, skuId, "retry");
      await mkdir(retryDir, { recursive: true });
      for (const file of retryFiles) {
        const ext = path.extname(file.filename) || extensionFromMime(file.contentType);
        const filePath = path.join(retryDir, `${Date.now()}_retry_${safeFileName(path.basename(file.filename, ext))}${ext}`);
        await writeFile(filePath, file.buffer);
        referenceAssets.push(createAsset({ skuId, role: "retry", filePath, sourceType: "upload" }));
      }
    }
    const prompt = buildImagePrompt({ node, sku, retryHint: body.retryHint || "" });
    const count = Math.max(1, Math.min(8, Number.parseInt(String(body.count || sku.candidate_count || config.defaultCandidates), 10)));
    const aspect = parseAspects(sku.node_aspects_json)[node.key] || node.defaultAspect || "1:1";
    const size = ASPECT_SIZE[aspect] || ASPECT_SIZE["1:1"];
    const task = createTask({ skuId, nodeKey: node.key, prompt, inputAssetIds: referenceAssets.map((asset) => asset.id) });
    try {
      const results = await generateImages({ prompt, count, referenceAssets, size });
      const candidates = [];
      for (const [index, result] of results.entries()) {
        const filePath = await saveGeneratedImage({ skuId, nodeKey: node.key, b64: result.b64, mimeType: result.mimeType, index });
        candidates.push(createCandidate({ skuId, taskId: task.id, nodeKey: node.key, filePath, prompt }));
      }
      updateTask(task.id, { status: "completed" });
      updateSku(skuId, { status: node.key === "main" ? "main_generated" : "details_generated" });
      return sendJson(res, 200, { taskId: task.id, candidates });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateTask(task.id, { status: "failed", error: message });
      return sendJson(res, 500, { error: message });
    }
  }

  if (req.method === "POST" && action === "candidates" && candidateId && subAction === "select") {
    const candidate = row("SELECT * FROM candidate_image WHERE id = ? AND sku_id = ?", candidateId, skuId);
    if (!candidate) return sendJson(res, 404, { error: "候选图不存在" });
    db.prepare("UPDATE candidate_image SET selected = 0 WHERE sku_id = ? AND node_key = ?").run(skuId, candidate.node_key);
    db.prepare("UPDATE candidate_image SET selected = 1, reject_reason = NULL WHERE id = ?").run(candidateId);
    const asset = createAsset({ skuId, role: `selected_${candidate.node_key}`, filePath: candidate.file_path, sourceType: "selected" });
    if (candidate.node_key === "main") updateSku(skuId, { selected_main_asset_id: asset.id, status: "main_selected" });
    return sendJson(res, 200, { candidate: row("SELECT * FROM candidate_image WHERE id = ?", candidateId) });
  }

  if (req.method === "POST" && action === "candidates" && candidateId && subAction === "reject") {
    const body = await readJson(req);
    db.prepare("UPDATE candidate_image SET selected = 0, reject_reason = ? WHERE id = ? AND sku_id = ?")
      .run(body.reason || null, candidateId, skuId);
    return sendJson(res, 200, { candidate: row("SELECT * FROM candidate_image WHERE id = ?", candidateId) });
  }

  if (req.method === "GET" && action === "export") {
    const selected = rows("SELECT * FROM candidate_image WHERE sku_id = ? AND selected = 1 ORDER BY node_key ASC", skuId);
    if (!selected.length) return sendJson(res, 400, { error: "还没有选择最终图" });
    const files = [];
    const prompts = [];
    const meta = [];
    for (const node of nodes) {
      const candidate = selected.find((item) => item.node_key === node.key);
      if (!candidate) continue;
      const ext = path.extname(candidate.file_path) || ".png";
      const name = `${safeFileName(sku.name)}_${String(node.order).padStart(2, "0")}_${node.label}${ext}`;
      files.push({ name, data: await readFile(candidate.file_path) });
      prompts.push({ nodeKey: node.key, label: node.label, prompt: candidate.prompt });
      meta.push({ nodeKey: node.key, label: node.label, fileName: name, sourcePath: candidate.file_path });
    }
    files.push({ name: "prompts.json", data: Buffer.from(JSON.stringify(prompts, null, 2)) });
    files.push({ name: "selected.json", data: Buffer.from(JSON.stringify({ sku, selected: meta }, null, 2)) });
    const zip = await createZip(files);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${sku.name}.zip`)}`,
      "Content-Length": zip.length
    });
    res.end(zip);
    return true;
  }

  return false;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function dosTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(1980, date.getFullYear()) - 1980;
  return { time, date: (year << 9) | (month << 5) | day };
}

async function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosTime();
  for (const file of files) {
    const nameBuffer = Buffer.from(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function renderShell({ skuId = "" } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f7f8fa" />
  <meta name="color-scheme" content="light" />
  <title>电商图片工作流</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <main class="page" id="app">
    <div class="empty" style="padding:96px 20px">
      <div class="spinner" style="color:#9aa1ac"></div>
      <p>加载中…</p>
    </div>
  </main>
  <script>window.__SKU_ID__ = ${JSON.stringify(skuId)};</script>
  <script type="module" src="/app.js"></script>
</body>
</html>`;
}

const appJs = `
const SKU_ID = window.__SKU_ID__;
const app = document.getElementById("app");
const rejectReasons = ["产品不像", "logo 错", "结构错", "文字错误", "主体太小", "背景不合适", "风格不够高级"];

// 轻量 DOM diff：原地更新而非整体替换 innerHTML，
// 这样未变化的元素（尤其 <img>）会被保留，不会重新加载导致闪烁。
function morphAttrs(from, to) {
  const toAttrs = to.attributes;
  for (let i = 0; i < toAttrs.length; i += 1) {
    if (from.getAttribute(toAttrs[i].name) !== toAttrs[i].value) from.setAttribute(toAttrs[i].name, toAttrs[i].value);
  }
  const fromAttrs = from.attributes;
  for (let i = fromAttrs.length - 1; i >= 0; i -= 1) {
    if (!to.hasAttribute(fromAttrs[i].name)) from.removeAttribute(fromAttrs[i].name);
  }
}
function morphNode(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) { from.replaceWith(to); return; }
  if (from.nodeType === 3 || from.nodeType === 8) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
  if (from.nodeType !== 1) return;
  morphAttrs(from, to);
  // 正在输入的输入框：保留其内容，避免光标跳到末尾或打断输入
  if ((from.nodeName === "TEXTAREA" || from.nodeName === "INPUT") && from === document.activeElement) return;
  morphChildren(from, to);
}
function morphChildren(from, to) {
  const toChildren = Array.from(to.childNodes);
  for (let i = 0; i < toChildren.length; i += 1) {
    const fromChild = from.childNodes[i];
    if (!fromChild) from.appendChild(toChildren[i]);
    else morphNode(fromChild, toChildren[i]);
  }
  while (from.childNodes.length > toChildren.length) from.removeChild(from.lastChild);
}
function paint(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  morphChildren(app, tmp);
}

const ICON = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  analyze: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.6L22.5 17l-2.6.9L19 20.5l-.9-2.6L15.5 17l2.6-.9z',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  check: 'M20 6 9 17l-5-5',
  lockRect: 'M5 11h14v10H5z',
  lockArc: 'M8 11V7a4 4 0 0 1 8 0v4',
  close: 'M18 6 6 18M6 6l12 12',
  zoom: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  imageRect: 'M3 3h18v18H3z',
  imageMtn: 'M3 16l5-5 4 4 3-3 6 6',
  imageSun: 'M9.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M10 11v6M14 11v6M6 6l1 15h10l1-15',
  flag: 'M4 21V4M4 4h13l-2 4 2 4H4',
  chev: 'M9 6l6 6-6 6',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  folder: 'M3 7h6l2 2h10v10H3z',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h0',
  info: 'M12 16v-4M12 8h0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  zap: 'M13 2 3 14h7l-1 8 10-12h-7l1-8z'
};

function svg(paths, size) {
  size = size || 18;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}
function icon(name, size) { return svg('<path d="' + (ICON[name] || '') + '"/>', size); }
function iconLock(size) { return svg('<path d="' + ICON.lockRect + '"/><path d="' + ICON.lockArc + '"/>', size); }
function iconImage(size) { return svg('<path d="' + ICON.imageRect + '"/><path d="' + ICON.imageMtn + '"/><path d="' + ICON.imageSun + '"/>', size); }

const STATUS = {
  draft: ["草稿", "gray"],
  uploaded: ["已上传素材", "blue"],
  analyzed: ["已分析", "indigo"],
  main_generated: ["主图候选已生成", "indigo"],
  main_selected: ["主图已选定", "green"],
  details_generated: ["详情图生成中", "indigo"]
};
function statusBadge(status) {
  const m = STATUS[status] || [status || "草稿", "gray"];
  return '<span class="badge ' + m[1] + '"><span class="dot"></span>' + esc(m[0]) + '</span>';
}

const ASPECTS = [
  ["1:1", "正方形", [16, 16]],
  ["3:4", "竖向", [13, 18]],
  ["4:3", "横向", [18, 13]],
  ["16:9", "宽屏横向", [20, 11]],
  ["9:16", "宽屏竖向", [11, 20]]
];
function aspectGlyph(v) {
  const item = ASPECTS.find((a) => a[0] === v) || ASPECTS[0];
  return '<span class="ag"><i style="width:' + item[2][0] + 'px;height:' + item[2][1] + 'px"></i></span>';
}
function aspectLabel(v) {
  const item = ASPECTS.find((a) => a[0] === v) || ASPECTS[0];
  return item[0] + " · " + item[1];
}
function skuCount() {
  const d = state.data;
  return (d && d.sku && d.sku.candidate_count) || (d && d.defaults && d.defaults.candidateCount) || 4;
}
function nodeAspect(key) {
  let stored = "";
  try {
    const map = JSON.parse((state.data && state.data.sku.node_aspects_json) || "{}");
    stored = map[key];
  } catch {
    stored = "";
  }
  if (ASPECTS.some((a) => a[0] === stored)) return stored;
  const node = state.data && state.data.nodes && state.data.nodes.find((n) => n.key === key);
  return (node && node.defaultAspect) || "1:1";
}

let state = {
  data: null,
  busy: "",
  busyNode: "",
  promptOpen: "",
  rejectOpen: "",
  aspectOpen: "",
  preview: null,
  retryHints: {},
  retryImages: {},
  activeNode: "assets",
  toasts: [],
  pending: { source: [], reference: [] },
  batch: null,
  busyNodes: {}
};
const AUTO_CONCURRENCY = 4; // 一键生成时详情节点的并行数（按代理承受能力调整）
let toastSeq = 0;

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(json.error || "请求失败");
  return json;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function pushToast(type, message, title) {
  const id = ++toastSeq;
  state.toasts.push({ id, type, message, title: title || "" });
  render();
  setTimeout(() => { state.toasts = state.toasts.filter((t) => t.id !== id); render(); }, type === "error" ? 6500 : 3200);
}
function dismissToast(id) { state.toasts = state.toasts.filter((t) => t.id !== id); render(); }

async function run(label, node, fn) {
  state.busy = label;
  state.busyNode = node || "";
  render();
  try {
    await fn();
    if (SKU_ID) await loadSku();
    else await loadHome();
  } catch (error) {
    pushToast("error", error.message || String(error), "操作失败");
  } finally {
    state.busy = "";
    state.busyNode = "";
    render();
  }
}

async function loadHome() { state.data = await api("/api/skus"); render(); }
async function loadSku() { state.data = await api("/api/skus/" + SKU_ID); render(); }

async function deleteSku(id, name) {
  if (!id) return;
  const label = name ? "「" + name + "」" : "这个 SKU";
  if (!window.confirm("确定删除 " + label + "？关联素材、候选图和生成记录都会一起删除。")) return;
  state.busy = "删除 SKU";
  render();
  try {
    await api("/api/skus/" + encodeURIComponent(id), { method: "DELETE" });
    await loadHome();
    pushToast("success", "已删除 " + label, "删除完成");
  } catch (error) {
    pushToast("error", error.message || String(error), "删除失败");
  } finally {
    state.busy = "";
    render();
  }
}

function render() {
  if (SKU_ID) renderSku();
  else renderHome();
}

function toastsHtml() {
  if (!state.toasts.length) return "";
  return '<div class="toast-wrap">' + state.toasts.map((t) => {
    const ic = t.type === "error" ? icon("alert") : t.type === "success" ? icon("check") : icon("info");
    return \`<div class="toast \${esc(t.type)}">
      <span class="t-ic">\${ic}</span>
      <div class="t-body">\${t.title ? '<div class="t-title">' + esc(t.title) + '</div>' : ''}\${esc(t.message)}</div>
      <button class="t-close" data-toast="\${t.id}" type="button">\${icon("close", 16)}</button>
    </div>\`;
  }).join("") + '</div>';
}

function bindCommon() {
  for (const el of document.querySelectorAll("[data-toast]")) {
    el.onclick = () => dismissToast(Number(el.dataset.toast));
  }
  bindPreviewHandlers();
}

/* ---------------- 首页 ---------------- */
function brandBar() {
  return \`
    <header class="appbar">
      <a class="brand" href="/">
        <span class="brand-mark">\${icon("box", 20)}</span>
        <span class="brand-text"><h1>电商图片工作流</h1><p>SKU 主图与详情图生成台</p></span>
      </a>
    </header>\`;
}

function renderHome() {
  const skus = state.data?.skus || [];
  paint(\`
    \${brandBar()}
    <div class="home-hero">
      <h2>从产品图到整套电商图</h2>
      <p>上传产品图，AI 分析卖点，逐节点生成候选并人工选定，一键打包导出。</p>
    </div>
    <section class="panel">
      <div class="panel-head"><h3>\${icon("plus", 18)} 新建 SKU</h3></div>
      <form class="create-form" id="create-form">
        <label class="field">SKU 名称<input name="name" placeholder="例如 SKU123" required /></label>
        <label class="field">零散备注<textarea name="notes" placeholder="材质、卖点、风格要求等，可留空"></textarea></label>
        <button \${state.busy ? 'disabled' : ''}>创建并进入</button>
      </form>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h3>\${icon("box", 18)} SKU 列表 <span class="count">\${skus.length}</span></h3>
        <button class="ghost icon-btn" id="refresh" title="刷新">\${icon("refresh", 18)}</button>
      </div>
      \${skus.length ? '<div class="sku-grid">' + skus.map((sku) => \`
        <article class="sku-card">
          <a class="sku-link" href="/skus/\${esc(sku.id)}">
            <div class="name">\${esc(sku.name)}<span class="go">\${icon("chev", 18)}</span></div>
            <div class="notes">\${esc(sku.notes || "无备注")}</div>
          </a>
          <div class="meta">
            <span>\${statusBadge(sku.status)}</span>
            <time>\${new Date(sku.updated_at).toLocaleString()}</time>
          </div>
          <div class="sku-actions">
            <button class="ghost danger icon-btn" data-delete-sku="\${esc(sku.id)}" data-sku-name="\${esc(sku.name)}" title="删除 SKU" \${state.busy ? 'disabled' : ''}>\${icon("trash", 16)}</button>
          </div>
        </article>\`).join("") + '</div>'
        : \`<div class="empty"><span class="ic">\${iconImage(26)}</span><p>还没有 SKU，先在上方新建一个吧。</p></div>\`}
    </section>
    \${toastsHtml()}\`);

  document.getElementById("create-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run("创建 SKU", "", async () => {
      const json = await api("/api/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), notes: form.get("notes") })
      });
      window.location.href = "/skus/" + json.sku.id;
    });
  };
  document.getElementById("refresh").onclick = () => loadHome();
  for (const el of document.querySelectorAll("[data-delete-sku]")) {
    el.onclick = () => deleteSku(el.dataset.deleteSku, el.dataset.skuName || "");
  }
  bindCommon();
}

function byNode(candidates) {
  const map = {};
  for (const item of candidates || []) {
    if (!map[item.node_key]) map[item.node_key] = [];
    map[item.node_key].push(item);
  }
  return map;
}

function isGenerating(key) {
  return state.busyNode === key || Boolean(state.busyNodes && state.busyNodes[key]);
}

/* ---------------- 详情页 ---------------- */
function renderSku() {
  const data = state.data;
  if (!data?.sku) {
    app.innerHTML = '<div class="empty" style="padding:96px 20px"><div class="spinner" style="color:#9aa1ac"></div><p>加载中…</p></div>';
    return;
  }
  const sourceAssets = data.assets.filter((asset) => asset.role === "source");
  const refAssets = data.assets.filter((asset) => asset.role === "reference");
  const candidates = byNode(data.candidates);
  const total = data.nodes.length;
  const selectedCount = data.nodes.filter((n) => (candidates[n.key] || []).some((c) => c.selected)).length;
  const selectedMain = Boolean(data.sku.selected_main_asset_id);
  if (state.activeNode !== "assets" && !data.nodes.some((n) => n.key === state.activeNode)) state.activeNode = "assets";
  const pct = total ? Math.round((selectedCount / total) * 100) : 0;

  paint(\`
    <header class="appbar">
      <a class="backlink" href="/">\${icon("back", 18)} 返回</a>
      <div class="appbar-title">
        <div class="row"><h1>\${esc(data.sku.name)}</h1>\${statusBadge(data.sku.status)}</div>
        <span class="sub">\${esc(data.sku.notes || "无备注")}</span>
      </div>
      <div class="spacer"></div>
      <div class="progress-chip">
        \${icon("check", 16)}<span>已选 <b>\${selectedCount}</b>/\${total}</span>
        <div class="progress-track"><div class="progress-fill" style="width:\${pct}%"></div></div>
      </div>
      \${state.batch
        ? \`<button disabled><span class="spinner"></span> 生成中 \${state.batch.done}/\${state.batch.total}</button>\`
        : \`<button data-autogen \${state.busy ? 'disabled' : ''}>\${icon("zap", 18)} 一键生成</button>\`}
      <a class="button \${selectedCount ? "" : "disabled"}" href="/api/skus/\${esc(data.sku.id)}/export">\${icon("download", 18)} 下载 zip</a>
    </header>
    <div class="workspace">
      \${renderSidebar(data, candidates, selectedMain, selectedCount, total, pct)}
      <div class="content">\${renderContent(data, candidates, sourceAssets, refAssets, selectedMain)}</div>
    </div>
    \${state.aspectOpen ? '<div class="aspect-overlay" data-aspect-close></div>' : ''}
    \${toastsHtml()}
    \${renderPreview()}\`);

  bindSidebar();
  bindContent(data, sourceAssets);
  bindCommon();
}

function renderSidebar(data, candidates, selectedMain, selectedCount, total, pct) {
  const assetsState = data.sku.analysis_json ? '<span class="nav-state done">' + icon("check", 16) + '</span>'
    : data.assets.length ? '<span class="nav-state has"><span class="pip"></span></span>' : '';
  const items = data.nodes.map((node) => {
    const list = candidates[node.key] || [];
    const isSel = list.some((c) => c.selected);
    const blocked = node.usesSelectedMain && !selectedMain;
    let st = "";
    if (isGenerating(node.key)) st = '<span class="nav-state has"><span class="spinner" style="width:13px;height:13px;border-width:2px"></span></span>';
    else if (isSel) st = '<span class="nav-state done">' + icon("check", 16) + '</span>';
    else if (list.length) st = '<span class="nav-state has"><span class="pip"></span></span>';
    else if (blocked) st = '<span class="nav-state locked">' + iconLock(15) + '</span>';
    return \`<button class="nav-item \${state.activeNode === node.key ? "active" : ""}" data-nav="\${esc(node.key)}">
      <span class="nav-idx">\${String(node.order).padStart(2, "0")}</span>
      <span class="nav-name">\${esc(node.label)}</span>\${st}
    </button>\`;
  }).join("");

  return \`
    <nav class="sidebar">
      <div class="side-label">进度</div>
      <div class="side-progress"><div class="progress-track"><div class="progress-fill" style="width:\${pct}%"></div></div><span>\${selectedCount}/\${total}</span></div>
      <button class="nav-item \${state.activeNode === "assets" ? "active" : ""}" data-nav="assets">
        <span class="nav-idx">\${iconImage(15)}</span>
        <span class="nav-name">产品资料 · 分析</span>\${assetsState}
      </button>
      <hr />
      <div class="side-label">图片节点</div>
      \${items}
    </nav>\`;
}

function bindSidebar() {
  for (const el of document.querySelectorAll("[data-nav]")) {
    el.onclick = () => { state.activeNode = el.dataset.nav; state.promptOpen = ""; state.rejectOpen = ""; render(); };
  }
}

function renderContent(data, candidates, sourceAssets, refAssets, selectedMain) {
  if (state.activeNode === "assets") return renderAssets(data, sourceAssets, refAssets);
  const node = data.nodes.find((n) => n.key === state.activeNode) || data.nodes[0];
  return renderNode(data, node, candidates[node.key] || [], sourceAssets.length, selectedMain);
}

function pendingLabel(role) {
  const files = state.pending[role] || [];
  if (!files.length) return "";
  const names = files.slice(0, 2).map((f) => f.name).join("、");
  return '<div class="dz-files">已选 ' + files.length + ' 张：' + esc(names) + (files.length > 2 ? " 等" : "") + '</div>';
}

function dropzone(role, title) {
  const count = (state.pending[role] || []).length;
  return \`
    <div>
      <label class="dropzone" data-drop data-role="\${role}">
        <input type="file" data-file multiple accept="image/*" />
        <span class="dz-ic">\${icon("upload", 28)}</span>
        <span class="dz-title">\${esc(title)}</span>
        <span class="dz-hint">点击选择，或拖拽图片到此处</span>
        \${pendingLabel(role)}
      </label>
      <div class="dz-actions">
        <button data-upload data-role="\${role}" \${state.busy || !count ? 'disabled' : ''}>\${icon("upload", 16)} 上传\${count ? " " + count + " 张" : ""}</button>
      </div>
    </div>\`;
}

function renderAssets(data, sourceAssets, refAssets) {
  const assets = sourceAssets.concat(refAssets);
  const analyzing = state.busy && state.busyNode === "__analyze";
  return \`
    <div class="section-head">
      <div class="titles"><h2>产品资料 · 分析</h2><p>上传主产品图与参考图，AI 分析结果会写入后续生成指令。</p></div>
      <div class="actions">
        <label class="inline-field" title="每个节点每次生成的候选图数量（1–8），对该 SKU 全部节点生效">每次生成
          <input type="number" id="sku-count" min="1" max="8" value="\${skuCount()}" \${state.busy ? 'disabled' : ''} /> 张
        </label>
        <button id="analyze" \${state.busy || !sourceAssets.length ? 'disabled' : ''}>\${analyzing ? '<span class="spinner"></span>' : icon("analyze", 18)} AI 分析产品信息</button>
      </div>
    </div>
    <section class="panel">
      <div class="upload-grid">
        \${dropzone("source", "主产品图")}
        \${dropzone("reference", "辅助参考图")}
      </div>
      \${assets.length ? '<div class="assets-strip">' + assets.map((asset) => \`
        <figure>
          <img class="zoomable" data-preview-src="\${esc(asset.url)}" data-preview-title="\${asset.role === "source" ? "主产品图" : "参考图"}" src="\${esc(asset.url)}" alt="" />
          <figcaption>\${asset.role === "source" ? "主产品图" : "参考图"}</figcaption>
        </figure>\`).join("") + '</div>'
        : \`<div class="empty"><span class="ic">\${iconImage(26)}</span><p>还没有上传图片。</p></div>\`}
      \${data.sku.analysis_json ? \`<div class="analysis-card"><details class="analysis"><summary>\${icon("chev", 16)}<span class="chev"></span>查看产品分析 JSON</summary><pre>\${esc(data.sku.analysis_json)}</pre></details></div>\` : ''}
    </section>\`;
}

function retryImagesStrip(nodeKey) {
  const imgs = state.retryImages[nodeKey] || [];
  if (!imgs.length) return "";
  return '<div class="retry-imgs">' + imgs.map((item, index) =>
    '<div class="retry-thumb"><img class="zoomable" data-preview-src="' + esc(item.url) + '" data-preview-title="' + esc(item.name) + '" src="' + esc(item.url) + '" alt="' + esc(item.name) + '" />' +
      '<button type="button" class="retry-thumb-x" data-retry-rm data-node="' + esc(nodeKey) + '" data-idx="' + index + '" title="移除">' + icon("close", 12) + '</button>' +
    '</div>'
  ).join("") + '</div>';
}

function renderNode(data, node, list, sourceCount, selectedMain) {
  const blocked = node.usesSelectedMain && !selectedMain;
  const selected = list.find((candidate) => candidate.selected);
  const generating = isGenerating(node.key);
  let body;
  if (generating) {
    const ratio = nodeAspect(node.key).replace(":", "/");
    body = \`<div class="busy-inline"><span class="spinner"></span>正在生成候选图，请稍候…</div>
      <div class="skeleton-grid">\${Array.from({ length: skuCount() }, () => '<div class="skel"><div class="ph" style="aspect-ratio:' + ratio + '"></div><div class="ph line"></div></div>').join("")}</div>\`;
  } else if (list.length) {
    body = '<div class="candidate-grid">' + list.map((candidate) => renderCandidate(node, candidate)).join("") + '</div>';
  } else {
    body = \`<div class="empty"><span class="ic">\${iconImage(26)}</span><p>暂无候选图，点击右上角生成 4 张。</p></div>\`;
  }
  return \`
    <div class="section-head">
      <div class="titles"><h2>\${String(node.order).padStart(2, "0")} · \${esc(node.label)}</h2><p>\${esc(node.description)}</p></div>
      <div class="actions">
        \${selected ? '<span class="badge green"><span class="dot"></span>已选最终图</span>' : ''}
        \${(() => {
          const cur = nodeAspect(node.key);
          const open = state.aspectOpen === node.key;
          const menu = open ? '<div class="aspect-menu">' + ASPECTS.map(([v, d]) =>
            '<button class="aspect-option ' + (cur === v ? 'active' : '') + '" data-aspect data-node="' + esc(node.key) + '" data-value="' + v + '">' +
              aspectGlyph(v) + '<span class="ao-text"><b>' + v + '</b><i>' + esc(d) + '</i></span>' +
              (cur === v ? '<span class="ao-check">' + icon("check", 14) + '</span>' : '') +
            '</button>').join("") + '</div>' : '';
          return '<div class="aspect-picker">' +
            '<button class="aspect-trigger ' + (open ? 'open' : '') + '" data-aspect-toggle data-node="' + esc(node.key) + '" ' + (state.busy ? 'disabled' : '') + ' title="该节点的图片比例">' +
              aspectGlyph(cur) + '<span>' + esc(aspectLabel(cur)) + '</span>' + icon("chev", 14) +
            '</button>' + menu +
          '</div>';
        })()}
        <button data-generate data-node="\${esc(node.key)}" \${state.busy || blocked || !sourceCount ? 'disabled' : ''}>\${icon("refresh", 18)} \${list.length ? "重跑" : "生成"} \${skuCount()} 张</button>
      </div>
    </div>
    <section class="panel">
      \${blocked ? \`<div class="locked-banner">\${iconLock(20)}<div class="lb-text"><strong>需先选择主图</strong><span>详情类节点依赖选定的主图作为参考，请先完成「01 主图」。</span></div><button class="ghost" data-nav="main">去选择主图</button></div>\` : ''}
      <div class="node-toolbar">
        <div class="retry-row" data-retry-drop="\${esc(node.key)}">
          <label for="retry-\${esc(node.key)}">重跑修正重点（可留空，可在下方粘贴或拖拽图片，最多 5 张）</label>
          <div class="retry-input">
            \${retryImagesStrip(node.key)}
            <textarea id="retry-\${esc(node.key)}" data-retry data-node="\${esc(node.key)}" placeholder="例如：主体更大、减少文字、背景更干净；可直接粘贴(Ctrl+V)或拖拽图片到此处">\${esc(state.retryHints[node.key] || "")}</textarea>
          </div>
        </div>
        \${body}
      </div>
    </section>\`;
}

function renderCandidate(node, candidate) {
  const markOpen = state.rejectOpen === candidate.id;
  return \`
    <figure class="candidate \${candidate.selected ? "is-selected" : ""}">
      <img class="zoomable" data-preview-src="\${esc(candidate.url)}" data-preview-title="\${esc(node.label)}" src="\${esc(candidate.url)}" alt="\${esc(node.label)}" />
      \${candidate.selected ? '<span class="check">' + icon("check", 16) + '</span>' : ''}
      <figcaption>
        <div class="cand-meta">
          <span>\${candidate.selected ? "最终图" : new Date(candidate.created_at).toLocaleString()}</span>
          \${candidate.reject_reason ? '<span class="reject-flag">' + icon("flag", 14) + esc(candidate.reject_reason) + '</span>' : ''}
        </div>
        <div class="cand-actions">
          <button data-select data-id="\${esc(candidate.id)}" \${state.busy ? 'disabled' : ''}>\${candidate.selected ? "已选择" : "选择"}</button>
          <button class="ghost" data-prompt data-id="\${esc(candidate.id)}">Prompt</button>
          <button class="ghost" data-markopen data-id="\${esc(candidate.id)}" title="标记问题">\${icon("flag", 16)}</button>
        </div>
        \${markOpen ? '<div class="reject-chips">' + rejectReasons.map((reason) => '<button class="tiny" data-reject data-id="' + esc(candidate.id) + '" data-reason="' + esc(reason) + '" ' + (state.busy ? 'disabled' : '') + '>' + esc(reason) + '</button>').join("") + '</div>' : ''}
        \${state.promptOpen === candidate.id ? '<pre class="prompt-box">' + esc(candidate.prompt) + '</pre>' : ''}
      </figcaption>
    </figure>\`;
}

function bindContent(data, sourceAssets) {
  const autogen = document.querySelector("[data-autogen]");
  if (autogen) autogen.onclick = () => autoGenerate();

  const analyze = document.getElementById("analyze");
  if (analyze) analyze.onclick = () => run("分析产品", "__analyze", () => api("/api/skus/" + data.sku.id + "/analyze", { method: "POST" }));

  const countInput = document.getElementById("sku-count");
  if (countInput) countInput.onchange = () => run("保存设置", "", () => api("/api/skus/" + data.sku.id + "/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: countInput.value })
  }));
  for (const el of document.querySelectorAll("[data-aspect-toggle]")) {
    el.onclick = (e) => {
      e.stopPropagation();
      state.aspectOpen = state.aspectOpen === el.dataset.node ? "" : el.dataset.node;
      render();
    };
  }
  for (const el of document.querySelectorAll("[data-aspect]")) {
    el.onclick = (e) => {
      e.stopPropagation();
      state.aspectOpen = "";
      run("保存设置", "", () => api("/api/skus/" + data.sku.id + "/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeKey: el.dataset.node, aspect: el.dataset.value })
      }));
    };
  }
  const aspectClose = document.querySelector("[data-aspect-close]");
  if (aspectClose) aspectClose.onclick = () => { state.aspectOpen = ""; render(); };

  for (const zone of document.querySelectorAll("[data-drop]")) {
    const role = zone.dataset.role;
    const input = zone.querySelector("[data-file]");
    if (input) input.onchange = (e) => setPending(role, e.target.files);
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("dragover"); };
    zone.ondragleave = () => zone.classList.remove("dragover");
    zone.ondrop = (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      if (e.dataTransfer?.files?.length) setPending(role, e.dataTransfer.files);
    };
  }
  for (const btn of document.querySelectorAll("[data-upload]")) {
    btn.onclick = () => uploadFiles(btn.dataset.role);
  }

  for (const el of document.querySelectorAll("[data-generate]")) {
    el.onclick = () => generateNode(el.dataset.node);
  }
  for (const el of document.querySelectorAll("[data-retry]")) {
    el.oninput = (e) => { state.retryHints[el.dataset.node] = e.target.value; };
    el.onpaste = (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      const files = [];
      for (const item of items) {
        if (item.kind === "file" && (item.type || "").startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) { e.preventDefault(); addRetryImages(el.dataset.node, files); }
    };
  }
  for (const zone of document.querySelectorAll("[data-retry-drop]")) {
    const nodeKey = zone.dataset.retryDrop;
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("dragover"); };
    zone.ondragleave = (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("dragover"); };
    zone.ondrop = (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => (f.type || "").startsWith("image/"));
      if (files.length) addRetryImages(nodeKey, files);
    };
  }
  for (const el of document.querySelectorAll("[data-retry-rm]")) {
    el.onclick = () => removeRetryImage(el.dataset.node, Number(el.dataset.idx));
  }
  for (const el of document.querySelectorAll("[data-nav]")) {
    el.onclick = () => { state.activeNode = el.dataset.nav; state.promptOpen = ""; state.rejectOpen = ""; render(); };
  }

  for (const el of document.querySelectorAll("[data-select]")) {
    el.onclick = () => run("选择最终图", "", () => api("/api/skus/" + data.sku.id + "/candidates/" + el.dataset.id + "/select", { method: "POST" }));
  }
  for (const el of document.querySelectorAll("[data-prompt]")) {
    el.onclick = () => { state.promptOpen = state.promptOpen === el.dataset.id ? "" : el.dataset.id; render(); };
  }
  for (const el of document.querySelectorAll("[data-markopen]")) {
    el.onclick = () => { state.rejectOpen = state.rejectOpen === el.dataset.id ? "" : el.dataset.id; render(); };
  }
  for (const el of document.querySelectorAll("[data-reject]")) {
    el.onclick = () => run("标记问题", "", () => api("/api/skus/" + data.sku.id + "/candidates/" + el.dataset.id + "/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: el.dataset.reason })
    }));
  }
}

function setPending(role, fileList) {
  state.pending[role] = Array.from(fileList || []);
  render();
}

const MAX_RETRY_IMAGES = 5;
function addRetryImages(nodeKey, files) {
  const cur = state.retryImages[nodeKey] || (state.retryImages[nodeKey] = []);
  const room = MAX_RETRY_IMAGES - cur.length;
  if (room <= 0) { pushToast("info", "每次重跑最多上传 " + MAX_RETRY_IMAGES + " 张图片"); return; }
  const accepted = Array.from(files).slice(0, room);
  for (const file of accepted) cur.push({ file, url: URL.createObjectURL(file), name: file.name || "image" });
  if (files.length > room) pushToast("info", "最多 " + MAX_RETRY_IMAGES + " 张，多余的已忽略");
  render();
}
function removeRetryImage(nodeKey, index) {
  const cur = state.retryImages[nodeKey] || [];
  const [removed] = cur.splice(index, 1);
  if (removed && removed.url) URL.revokeObjectURL(removed.url);
  render();
}

/* ---------------- 预览 ---------------- */
function renderPreview() {
  if (!state.preview) return "";
  return \`
    <div class="preview-backdrop" id="preview-backdrop" role="dialog" aria-modal="true" aria-label="图片预览">
      <div class="preview-shell">
        <div class="preview-head">
          <span>\${esc(state.preview.title || "图片预览")}</span>
          <button class="ghost" id="preview-close" type="button">\${icon("close", 16)} 关闭</button>
        </div>
        <img class="preview-image" src="\${esc(state.preview.src)}" alt="\${esc(state.preview.title || "图片预览")}" />
      </div>
    </div>\`;
}

function openPreview(src, title) { state.preview = { src, title }; render(); }
function closePreview() { state.preview = null; render(); }

function bindPreviewHandlers() {
  for (const image of document.querySelectorAll("[data-preview-src]")) {
    image.onclick = () => openPreview(image.dataset.previewSrc, image.dataset.previewTitle);
  }
  const backdrop = document.getElementById("preview-backdrop");
  const close = document.getElementById("preview-close");
  if (backdrop) backdrop.onclick = (event) => { if (event.target === backdrop) closePreview(); };
  if (close) close.onclick = closePreview;
}

/* ---------------- 写操作 ---------------- */
async function uploadFiles(role) {
  const files = state.pending[role] || [];
  if (!files.length) { pushToast("info", "请先选择要上传的图片"); return; }
  await run("上传图片", "", async () => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.set("role", role);
    await api("/api/skus/" + SKU_ID + "/upload", { method: "POST", body: form });
    state.pending[role] = [];
  });
}

async function generateNode(nodeKey) {
  const images = state.retryImages[nodeKey] || [];
  await run("生成图片", nodeKey, async () => {
    if (images.length) {
      const form = new FormData();
      form.set("nodeKey", nodeKey);
      form.set("count", String(skuCount()));
      if (state.retryHints[nodeKey]) form.set("retryHint", state.retryHints[nodeKey]);
      for (const item of images) form.append("retryImages", item.file, item.name);
      await api("/api/skus/" + SKU_ID + "/generate", { method: "POST", body: form });
    } else {
      await api("/api/skus/" + SKU_ID + "/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeKey, count: skuCount(), retryHint: state.retryHints[nodeKey] || null })
      });
    }
    for (const item of images) { if (item.url) URL.revokeObjectURL(item.url); }
    state.retryImages[nodeKey] = [];
  });
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const size = Math.min(Math.max(1, limit), items.length);
  const runners = [];
  for (let k = 0; k < size; k += 1) {
    runners.push((async () => {
      while (cursor < items.length) {
        const idx = cursor;
        cursor += 1;
        await worker(items[idx], idx);
      }
    })());
  }
  await Promise.all(runners);
}

async function autoGenerate() {
  const data = state.data;
  if (!data || state.busy || state.batch) return;
  const cand = byNode(data.candidates);
  const hasCand = (key) => (cand[key] || []).length > 0;
  const selectedMain = Boolean(data.sku.selected_main_asset_id);
  const sourceCount = data.assets.filter((a) => a.role === "source").length;
  if (!sourceCount) { pushToast("error", "请先上传产品图，再使用一键生成。", "缺少产品图"); return; }

  let targets;
  if (!selectedMain) {
    if (hasCand("main")) {
      state.activeNode = "main";
      render();
      pushToast("info", "主图候选已生成，请先选定一张主图，再点一键生成详情节点。", "请先选定主图");
      return;
    }
    targets = data.nodes.filter((n) => n.key === "main");
  } else {
    targets = data.nodes.filter((n) => n.usesSelectedMain && !hasCand(n.key));
    if (!targets.length) {
      pushToast("info", "所有详情节点都已生成候选，没有需要补生成的节点。", "无需生成");
      return;
    }
  }

  state.busy = "一键生成";
  state.batch = { total: targets.length, done: 0 };
  state.busyNodes = {};
  state.activeNode = targets[0].key;
  let failed = 0;
  await runPool(targets, AUTO_CONCURRENCY, async (node) => {
    state.busyNodes[node.key] = true;
    render();
    try {
      await api("/api/skus/" + SKU_ID + "/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeKey: node.key, count: skuCount(), retryHint: state.retryHints[node.key] || null })
      });
    } catch (error) {
      failed += 1;
      pushToast("error", node.label + "：" + (error.message || String(error)), "节点生成失败");
    }
    delete state.busyNodes[node.key];
    state.batch.done += 1;
    render();
  });
  state.busy = "";
  state.busyNode = "";
  state.busyNodes = {};
  state.batch = null;
  await loadSku();

  if (!selectedMain) {
    state.activeNode = "main";
    render();
    if (!failed) pushToast("success", "主图候选已生成，请选定一张主图后再次点击一键生成，自动跑完所有详情节点。", "主图已就绪");
  } else {
    const ok = targets.length - failed;
    pushToast(failed ? "info" : "success", "已生成 " + ok + "/" + targets.length + " 个节点" + (failed ? "，" + failed + " 个失败可单独重跑" : "") + "。", "一键生成完成");
  }
}

if (SKU_ID) loadSku();
else loadHome();

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.preview) closePreview();
  else if (event.key === "Escape" && state.aspectOpen) { state.aspectOpen = ""; render(); }
});
`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/app.css") return serveFile(res, path.join(publicDir, "app.css"), "text/css; charset=utf-8", "no-cache");
    if (url.pathname === "/app.js") {
      const body = Buffer.from(appJs);
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Content-Length": body.length });
      res.end(body);
      return;
    }
    if (url.pathname === "/api/file") {
      const filePath = url.searchParams.get("path");
      if (!filePath || !isInside(dataDir, filePath) || !existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      return serveFile(res, filePath);
    }
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) return sendJson(res, 404, { error: "接口不存在" });
      return;
    }
    const skuPage = /^\/skus\/([^/]+)$/.exec(url.pathname);
    if (url.pathname === "/" || skuPage) {
      return sendHtml(res, renderShell({ skuId: skuPage?.[1] || "" }));
    }
    res.writeHead(404);
    res.end("Not found");
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      await sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    } else {
      res.end();
    }
  }
});

server.listen(config.port, () => {
  console.log(`电商图片工作流已启动：http://127.0.0.1:${config.port}`);
});
