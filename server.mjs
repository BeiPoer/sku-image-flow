import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const dataDir = path.resolve(process.env.SKU_IMAGE_FLOW_DATA_DIR || path.join(rootDir, "data"));
const uploadDir = path.join(dataDir, "uploads");
const templateUploadDir = path.join(dataDir, "template_uploads");
const generatedDir = path.join(dataDir, "generated");
const dbPath = path.join(dataDir, "app.db");
const distDir = path.resolve(process.env.SKU_IMAGE_FLOW_DIST_DIR || path.join(rootDir, "dist"));
const envDir = path.resolve(process.env.SKU_IMAGE_FLOW_ENV_DIR || rootDir);
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

await loadEnvFile(path.join(rootDir, ".env"));
await loadEnvFile(path.join(rootDir, ".env.local"));
await loadEnvFile(path.join(envDir, ".env"));
await loadEnvFile(path.join(envDir, ".env.local"));

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
const MIRROR_TEMPLATE_MAX_IMAGES = 50;

const nodes = [
  ["main", 1, "主图", "干净真实的产品主视觉，与详情页素材分开管理。", false, "生成一张电商产品主图，不要改变产品结构、logo、表盘、刻度、指针、表带材质和颜色。产品精修，产品置于纯净的纯白背景上。正视图,平角,3D渲染，精准还原产品颜色与包装材质(如玻璃+通道,塑料的哑光,金属的光泽)。清除所有指纹，灰尘与瑕疵，让产品看起来崭新，手表立体感强，提升整体感和高级感。标签/文字需清晰锐利。光线条和均匀，突出产品精致感，符合电商主图标准，表盘刻度和数字要清晰完整，不要模糊缺失，特别是logo的图案要正确无误，而且立体"],
  ["hand_model", 2, "手模图", "产品佩戴或手持场景，突出真实使用感。", true, "根据这个产品的调性，特性，设计细节，生成一张手摸图，要美观大气，注意不要文字不要文字，有较强的视觉冲击力，整体画面要和谐，手表要真实，立体感"],
  ["waterproof", 3, "防水图", "突出防水能力的场景图。", true, "根据这个产品的调性，特性，设计细节，生成一张防水电商海报，要美观大气，注意不要文字不要文字，有较强的视觉冲击力，大胆有冲击力，突破常规，整体画面要和谐，不要太简单了，要突出手表的力量感，手表要真实，立体感"],
  ["luminous", 4, "夜光图", "突出夜光和暗光质感。", true, "根据这个产品的调性，特性，设计细节，生成一张夜光电商海报图，要美观大气，注意不要文字不要文字，有较强的视觉冲击力，大胆有冲击力，突破常规，整体画面要和谐，不要太简单了，要突出手表的力量感手表要真实，立体感"],
  ["gift_box", 5, "礼盒图", "产品放入礼盒或包装盒的场景。", true, "根据这个产品的调性，特性，设计细节，生成一张手表放在礼盒里面的拍摄图，要美观大气，整体画面要和谐，主要突出手表，手表占比要大，距离近，手表要真实！立体感。如果是女士手表，要突出手表的柔美；如果是男士手表，要突出手表的力量感"],
  ["hero_poster", 6, "首屏海报", "详情页首屏用的强视觉海报。", true, "根据这个产品的调性，特性，设计细节，生成一张电商海报，要美观大气，有设计感，有较强的视觉冲击力，排版要大胆有冲击力，突破常规，文案不要太简单，整体画面要和谐，不要太简单了，要突出手表的力量感，手表要真实，立体感"],
  ["detail", 7, "细节图", "侧面、正面、表带或局部细节展示。", true, "根据这个产品的调性，特性，设计细节，生成一张三个方位细节的电商详情页，内容：侧面，正面，表带，要美观大气，有设计感，有较强的视觉冲击力，突破常规，整体画面要和谐，不要太简单了，要突出手表的力量感，手表要真实，立体感"],
  ["display_1", 8, "展示图1", "场景展示图第一张。", true, "生成一张产品展示图，使用简洁高级场景突出产品外观、质感和电商吸引力。产品主体清晰，构图稳定，保持产品一致。"],
  ["display_2", 9, "展示图2", "场景展示图第二张。", true, "生成一张产品展示图，风格与整套图片统一，但构图和背景与上一张有差异。突出产品高级感和真实感，保持产品一致。"],
  ["display_3", 10, "展示图3", "场景展示图第三张。", true, "生成一张产品展示图，延续统一视觉风格，使用不同角度或场景强化产品质感。不要改变产品结构、logo、颜色和比例。"],
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
// 通用一致性要求统一以纯文本（多行）存储；下面是内置默认文本
const DEFAULT_CONSISTENCY_TEXT = consistencyRules.join("\n");
// 把"数组或字符串"规整成纯文本（兼容历史 JSON 数组 / 旧调用方传数组）
function toConsistencyText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((s) => String(s)).join("\n");
  const str = String(value);
  // 历史数据可能存的是 JSON 数组字符串，转成换行文本
  if (str.trim().startsWith("[")) {
    try {
      const list = JSON.parse(str);
      if (Array.isArray(list)) return list.map((s) => String(s)).join("\n");
    } catch { /* 不是合法 JSON，原样当文本 */ }
  }
  return str;
}

await ensureDirs();
const db = initDb();
migrateTemplates();

function ensureApiConfig() {
  if (!config.openaiApiKey) {
    throw new Error("缺少 OPENAI_API_KEY，请先配置 .env.local 或环境变量。");
  }
}

async function ensureDirs() {
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(uploadDir, { recursive: true }),
    mkdir(templateUploadDir, { recursive: true }),
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
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS template (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'normal',
      description TEXT,
      consistency_rules TEXT,
      default_candidate_count INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS template_node (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      ord INTEGER NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      uses_selected_main INTEGER NOT NULL DEFAULT 1,
      is_main INTEGER NOT NULL DEFAULT 0,
      prompt TEXT NOT NULL,
      aspect TEXT NOT NULL DEFAULT '9:16',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (template_id) REFERENCES template(id) ON DELETE CASCADE,
      UNIQUE (template_id, node_key)
    );
    CREATE TABLE IF NOT EXISTS template_image (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      ord INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT,
      aspect TEXT NOT NULL DEFAULT '1:1',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (template_id) REFERENCES template(id) ON DELETE CASCADE,
      UNIQUE (template_id, node_key)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_sku ON asset(sku_id);
    CREATE INDEX IF NOT EXISTS idx_task_sku ON generation_task(sku_id);
    CREATE INDEX IF NOT EXISTS idx_candidate_sku_node ON candidate_image(sku_id, node_key);
    CREATE INDEX IF NOT EXISTS idx_tnode_template ON template_node(template_id);
    CREATE INDEX IF NOT EXISTS idx_timage_template ON template_image(template_id);
  `);
  ensureColumn(database, "sku", "candidate_count", "candidate_count INTEGER");
  ensureColumn(database, "sku", "node_aspects_json", "node_aspects_json TEXT");
  ensureColumn(database, "sku", "template_id", "template_id TEXT");
  ensureColumn(database, "template", "kind", "kind TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(database, "template", "phrases", "phrases TEXT");
  return database;
}

function now() {
  return new Date().toISOString();
}

function safeFileName(name) {
  return (name || "file").replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "_").replace(/_+/g, "_").slice(0, 90) || "file";
}

function stripHeaderQuotes(value) {
  const text = String(value || "").trim();
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replace(/\\"/g, '"');
  return text;
}

function decodeBinaryHeaderValue(value) {
  const text = stripHeaderQuotes(value);
  if (!text) return "";
  const decoded = Buffer.from(text, "binary").toString("utf8");
  return decoded.includes("\uFFFD") ? text : decoded;
}

function decodeRfc5987HeaderValue(value) {
  const text = stripHeaderQuotes(value);
  const match = /^([^']*)'[^']*'(.*)$/.exec(text);
  const charset = (match?.[1] || "utf-8").toLowerCase();
  const encoded = match ? match[2] : text;
  const bytes = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === "%" && i + 2 < encoded.length) {
      const byte = Number.parseInt(encoded.slice(i + 1, i + 3), 16);
      if (Number.isFinite(byte)) {
        bytes.push(byte);
        i += 2;
        continue;
      }
    }
    bytes.push(encoded.charCodeAt(i));
  }
  try {
    return new TextDecoder(charset).decode(Buffer.from(bytes));
  } catch {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return decodeBinaryHeaderValue(text);
    }
  }
}

function decodeMultipartFileName({ filename, filenameStar } = {}) {
  return filenameStar ? decodeRfc5987HeaderValue(filenameStar) : decodeBinaryHeaderValue(filename);
}

function repairMojibakeFileName(name) {
  const text = String(name || "");
  if (!text || !/[\u00c0-\u00ff]/.test(text)) return text;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 255) return text;
  }
  const repaired = Buffer.from(text, "latin1").toString("utf8");
  if (!repaired || repaired.includes("\uFFFD")) return text;
  return /[\u4e00-\u9fff]/.test(repaired) ? repaired : text;
}

function displayOriginalName(name) {
  return repairMojibakeFileName(name);
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

function parseImageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (!length || offset + 2 + length > buffer.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const type = buffer.toString("ascii", 12, 16);
    if (type === "VP8X" && buffer.length >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height };
    }
    if (type === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (type === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function aspectFromBuffer(buffer) {
  const size = parseImageSize(buffer);
  if (!size || !size.width || !size.height) return "1:1";
  const ratio = size.width / size.height;
  const candidates = [
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["4:3", 4 / 3],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16]
  ];
  return candidates.reduce((best, cur) => (Math.abs(cur[1] - ratio) < Math.abs(best[1] - ratio) ? cur : best))[0];
}

function row(statement, ...args) {
  return db.prepare(statement).get(...args) || null;
}

function rows(statement, ...args) {
  return db.prepare(statement).all(...args);
}

// ---- 全局配置（app_config 键值表）：只存被用户改过的项，未改回退到代码内置默认值 ----
function getConfig(key) {
  const r = row("SELECT value FROM app_config WHERE key = ?", key);
  return r ? r.value : null;
}

function setConfig(key, value) {
  db.prepare("INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

function deleteConfig(key) {
  db.prepare("DELETE FROM app_config WHERE key = ?").run(key);
}

// 某节点的有效生图提示词：用户覆盖优先，否则回退该节点内置默认 prompt
function effectiveNodePrompt(nodeKey) {
  const override = getConfig("node_prompt:" + nodeKey);
  if (override != null && override.trim()) return override;
  return getNode(nodeKey).prompt;
}

// 有效的通用一致性要求（按行存储），为空回退内置默认
function effectiveConsistencyRules() {
  const override = getConfig("consistency_rules");
  if (override != null) {
    const list = override.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return consistencyRules;
}

// 设置页所需的完整配置：每个节点带默认值与有效值，便于前端显示占位与「恢复默认」
function getConfigPayload() {
  return {
    nodes: nodes.map((n) => ({
      key: n.key,
      label: n.label,
      order: n.order,
      defaultPrompt: n.prompt,
      prompt: effectiveNodePrompt(n.key)
    })),
    consistencyRules: effectiveConsistencyRules(),
    defaultConsistencyRules: consistencyRules
  };
}

function createSku({ name, notes, templateId }) {
  const id = randomUUID();
  const ts = now();
  db.prepare("INSERT INTO sku (id, name, notes, template_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)")
    .run(id, name, notes || null, templateId, ts, ts);
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

function recomputeSkuStatus(skuId) {
  const sku = getSku(skuId);
  if (!sku) return "draft";
  if (sku.selected_main_asset_id) return "main_selected";

  const selectedCount = row("SELECT COUNT(*) AS n FROM candidate_image WHERE sku_id = ? AND selected = 1", skuId)?.n || 0;
  if (selectedCount > 0) return "details_generated";

  const template = sku.template_id ? getTemplate(sku.template_id) : null;
  const mainNode = template && template.kind !== "mirror"
    ? row("SELECT node_key FROM template_node WHERE template_id = ? AND is_main = 1 ORDER BY ord ASC LIMIT 1", template.id)
    : null;
  if (mainNode) {
    const mainCount = row("SELECT COUNT(*) AS n FROM candidate_image WHERE sku_id = ? AND node_key = ?", skuId, mainNode.node_key)?.n || 0;
    if (mainCount > 0) return "main_generated";
  }

  const candidateCount = row("SELECT COUNT(*) AS n FROM candidate_image WHERE sku_id = ?", skuId)?.n || 0;
  if (candidateCount > 0) return "details_generated";

  if (sku.analysis_json) return "analyzed";

  const uploadCount = row("SELECT COUNT(*) AS n FROM asset WHERE sku_id = ? AND source_type = 'upload' AND role != 'retry'", skuId)?.n || 0;
  if (uploadCount > 0) return "uploaded";

  return "draft";
}

// ---- 模板与模板节点 ----

// 把 template_node 行映射成拼接/前端用的节点对象（兼容历史字段名 key/order/usesSelectedMain/defaultAspect）
function mapNodeRow(r) {
  return {
    key: r.node_key,
    order: r.ord,
    label: r.label,
    description: r.description || "",
    usesSelectedMain: Boolean(r.uses_selected_main),
    isMain: Boolean(r.is_main),
    prompt: r.prompt,
    defaultAspect: r.aspect || "9:16",
    deleted: Boolean(r.deleted)
  };
}

function mapTemplateImageRow(r) {
  const originalName = displayOriginalName(r.original_name || "");
  return {
    id: r.id,
    template_id: r.template_id,
    node_key: r.node_key,
    order: r.ord,
    file_path: r.file_path,
    original_name: originalName,
    aspect: r.aspect || "1:1",
    deleted: Boolean(r.deleted),
    created_at: r.created_at,
    url: `/api/file?path=${encodeURIComponent(r.file_path)}`
  };
}

function mapMirrorNodeRow(r) {
  const order = r.ord;
  return {
    key: r.node_key,
    order,
    label: `镜像图 ${String(order).padStart(2, "0")}`,
    description: "参考模板图的构图、场景、光影、背景、视角、布局和整体风格生成复刻图。",
    usesSelectedMain: false,
    isMain: false,
    prompt: "",
    defaultAspect: r.aspect || "1:1",
    deleted: Boolean(r.deleted),
    kind: "mirror",
    referenceImageId: r.id,
    referenceUrl: `/api/file?path=${encodeURIComponent(r.file_path)}`,
    referenceName: displayOriginalName(r.original_name || "")
  };
}

function getTemplate(id) {
  return row("SELECT * FROM template WHERE id = ?", id);
}

function listTemplates() {
  return rows("SELECT * FROM template ORDER BY created_at ASC");
}

// 模板节点；默认排除软删除节点，但已出图的历史节点用 includeDeleted 取回
function templateNodes(templateId, { includeDeleted = false } = {}) {
  const extra = includeDeleted ? "" : " AND deleted = 0";
  return rows(`SELECT * FROM template_node WHERE template_id = ?${extra} ORDER BY ord ASC`, templateId).map(mapNodeRow);
}

function templateImages(templateId, { includeDeleted = false } = {}) {
  const extra = includeDeleted ? "" : " AND deleted = 0";
  return rows(`SELECT * FROM template_image WHERE template_id = ?${extra} ORDER BY ord ASC`, templateId).map(mapTemplateImageRow);
}

function mirrorNodes(templateId, { includeDeleted = false } = {}) {
  const extra = includeDeleted ? "" : " AND deleted = 0";
  return rows(`SELECT * FROM template_image WHERE template_id = ?${extra} ORDER BY ord ASC`, templateId).map(mapMirrorNodeRow);
}

function templateNodeList(template, options = {}) {
  if (!template) return [];
  return template.kind === "mirror" ? mirrorNodes(template.id, options) : templateNodes(template.id, options);
}

function getTemplateNode(templateId, key) {
  const template = getTemplate(templateId);
  if (template?.kind === "mirror") {
    const image = row("SELECT * FROM template_image WHERE template_id = ? AND node_key = ?", templateId, key);
    if (!image) throw new Error(`未知图片节点：${key}`);
    return mapMirrorNodeRow(image);
  }
  const r = row("SELECT * FROM template_node WHERE template_id = ? AND node_key = ?", templateId, key);
  if (!r) throw new Error(`未知图片节点：${key}`);
  return mapNodeRow(r);
}

function insertTemplateNode(templateId, n, ord) {
  const id = randomUUID();
  db.prepare(`INSERT INTO template_node (id, template_id, node_key, ord, label, description, uses_selected_main, is_main, prompt, aspect, deleted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, templateId, n.node_key || nextNodeKey(templateId), ord ?? n.ord ?? 1,
      n.label || "未命名节点", n.description || null,
      n.uses_selected_main ? 1 : 0, n.is_main ? 1 : 0, n.prompt || "",
      n.aspect || "9:16", n.deleted ? 1 : 0, now());
  return id;
}

// 为新节点生成稳定且不与历史（含软删除）冲突的 node_key
function nextNodeKey(templateId) {
  const used = new Set(rows("SELECT node_key FROM template_node WHERE template_id = ?", templateId).map((r) => r.node_key));
  let key;
  do { key = "node_" + randomUUID().slice(0, 8); } while (used.has(key));
  return key;
}

function nextMirrorNodeKey(templateId) {
  const used = new Set(rows("SELECT node_key FROM template_image WHERE template_id = ?", templateId).map((r) => r.node_key));
  let key;
  do { key = "mirror_" + randomUUID().slice(0, 8); } while (used.has(key));
  return key;
}

function createTemplate({ name, description, consistencyRules, defaultCandidateCount, nodes: seedNodes, kind = "normal" }) {
  const id = randomUUID();
  const ts = now();
  const safeKind = kind === "mirror" ? "mirror" : "normal";
  db.prepare(`INSERT INTO template (id, name, kind, description, consistency_rules, default_candidate_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, safeKind, description || null,
      (() => { const t = toConsistencyText(consistencyRules).trim(); return t || null; })(),
      defaultCandidateCount ?? null, ts, ts);
  if (safeKind !== "mirror" && Array.isArray(seedNodes)) {
    seedNodes.forEach((n, i) => insertTemplateNode(id, n, n.ord ?? i + 1));
  }
  return getTemplate(id);
}

function touchTemplate(id) {
  db.prepare("UPDATE template SET updated_at = ? WHERE id = ?").run(now(), id);
}

async function insertTemplateImageFromFile(templateId, file, ord) {
  if (!(file.contentType || "").startsWith("image/")) return null;
  const currentCount = row("SELECT COUNT(*) AS n FROM template_image WHERE template_id = ? AND deleted = 0", templateId)?.n || 0;
  if (currentCount >= MIRROR_TEMPLATE_MAX_IMAGES) {
    throw new Error(`镜像模板最多 ${MIRROR_TEMPLATE_MAX_IMAGES} 张参考图`);
  }
  const id = randomUUID();
  const originalName = displayOriginalName(file.filename || "参考图");
  const ext = path.extname(originalName) || extensionFromMime(file.contentType);
  const dir = path.join(templateUploadDir, templateId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}_${id}_${safeFileName(path.basename(originalName, ext))}${ext}`);
  await writeFile(filePath, file.buffer);
  const aspect = aspectFromBuffer(file.buffer);
  const nodeKey = nextMirrorNodeKey(templateId);
  const order = ord ?? ((row("SELECT COALESCE(MAX(ord), 0) AS n FROM template_image WHERE template_id = ?", templateId)?.n || 0) + 1);
  db.prepare(`INSERT INTO template_image (id, template_id, node_key, ord, file_path, original_name, aspect, deleted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
    .run(id, templateId, nodeKey, order, filePath, originalName || null, aspect, now());
  return mapTemplateImageRow(row("SELECT * FROM template_image WHERE id = ?", id));
}

async function copyMirrorTemplateImages(sourceTemplateId, targetTemplateId) {
  const images = rows("SELECT * FROM template_image WHERE template_id = ? AND deleted = 0 ORDER BY ord ASC", sourceTemplateId);
  const dir = path.join(templateUploadDir, targetTemplateId);
  await mkdir(dir, { recursive: true });
  for (const image of images) {
    const id = randomUUID();
    const ext = path.extname(image.file_path) || ".png";
    const filePath = path.join(dir, `${Date.now()}_${id}_${safeFileName(path.basename(image.original_name || image.file_path, ext))}${ext}`);
    await copyFile(image.file_path, filePath);
    db.prepare(`INSERT INTO template_image (id, template_id, node_key, ord, file_path, original_name, aspect, deleted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(id, targetTemplateId, nextMirrorNodeKey(targetTemplateId), image.ord, filePath, image.original_name || null, image.aspect || "1:1", now());
  }
}

async function removeTemplateFiles(templateId) {
  const dir = path.join(templateUploadDir, templateId);
  if (!isInside(templateUploadDir, dir)) throw new Error("删除路径越界。");
  await rm(dir, { recursive: true, force: true });
}

// 模板有效的通用一致性要求：存了用存的，否则回退内置默认
// 模板的通用一致性要求（纯文本，多行）；为空回退内置默认文本。兼容历史 JSON 数组。
function templateConsistencyText(template) {
  const text = toConsistencyText(template && template.consistency_rules).trim();
  return text || DEFAULT_CONSISTENCY_TEXT;
}

// 内置「手表」预设的节点种子（迁移与「手表预设」新建共用）
function watchPresetNodes({ withOverrides = false } = {}) {
  return nodes.map((n) => ({
    node_key: n.key,
    ord: n.order,
    label: n.label,
    description: n.description,
    uses_selected_main: n.usesSelectedMain,
    is_main: n.key === "main",
    prompt: withOverrides ? effectiveNodePrompt(n.key) : n.prompt,
    aspect: n.defaultAspect
  }));
}

// 首次升级：把旧的固定流程迁成一个内置「手表」模板，存量 SKU 归入它
function migrateTemplates() {
  const count = row("SELECT COUNT(*) AS n FROM template");
  let defaultTemplateId;
  if (!count || count.n === 0) {
    const tpl = createTemplate({
      name: "手表",
      description: "默认详情图模板（迁移自旧版固定流程）",
      consistencyRules: effectiveConsistencyRules(),
      defaultCandidateCount: null,
      nodes: watchPresetNodes({ withOverrides: true })
    });
    defaultTemplateId = tpl.id;
  } else {
    defaultTemplateId = row("SELECT id FROM template ORDER BY created_at ASC LIMIT 1").id;
  }
  db.prepare("UPDATE sku SET template_id = ? WHERE template_id IS NULL").run(defaultTemplateId);
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

function normalizeCandidateCount(value, fallback = config.defaultCandidates) {
  const parsed = Number.parseInt(String(value), 10);
  return Math.max(1, Math.min(8, Number.isFinite(parsed) && parsed > 0 ? parsed : fallback));
}

function effectiveCandidateCount({ requested, sku, template }) {
  if (requested !== undefined && requested !== null && requested !== "") {
    return normalizeCandidateCount(requested);
  }
  if (sku?.candidate_count !== undefined && sku?.candidate_count !== null && sku?.candidate_count !== "") {
    return normalizeCandidateCount(sku.candidate_count);
  }
  if (template?.default_candidate_count !== undefined && template?.default_candidate_count !== null && template?.default_candidate_count !== "") {
    return normalizeCandidateCount(template.default_candidate_count);
  }
  return normalizeCandidateCount(config.defaultCandidates);
}

// 生图提示词分块：单一数据源。预览展示用它，实际拼接也用它，保证两者完全一致。
// 每块：kind 类型；label 显示名；hint 「如何修改」提示；editable 是否可由用户改；
//       present 本次是否参与拼接；text 该块拼进最终提示词的完整文本。
function buildImageSegments({ node, sku, template, retryHint = "" }) {
  const analysis = parseAnalysis(sku.analysis_json);
  const segs = [];
  segs.push({
    kind: "task", label: "任务（节点提示词）", editable: true, present: true,
    hint: "在模板的「节点设置」里修改该节点的生图提示词",
    text: `任务：${node.prompt}`
  });
  segs.push({
    kind: "sku_name", label: "SKU / 产品名称", editable: false, present: true,
    hint: "来自新建 SKU 时填写的名称",
    text: `SKU/产品名称：${sku.name}`
  });
  segs.push({
    kind: "notes", label: "补充信息（备注）", editable: false, present: Boolean(sku.notes),
    hint: "来自新建 SKU 时填写的零散备注，留空则不参与拼接",
    text: sku.notes ? `补充信息：${sku.notes}` : ""
  });
  const aLines = [];
  if (analysis?.category) aLines.push(`产品品类：${analysis.category}`);
  if (analysis?.style) aLines.push(`产品风格：${analysis.style}`);
  if (analysis?.material) aLines.push(`材质信息：${analysis.material}`);
  if (Array.isArray(analysis?.colors) && analysis.colors.length) aLines.push(`主要颜色：${analysis.colors.join("、")}`);
  if (Array.isArray(analysis?.sellingPoints) && analysis.sellingPoints.length) aLines.push(`核心卖点：${analysis.sellingPoints.join("、")}`);
  segs.push({
    kind: "analysis", label: "产品分析信息", editable: false, present: aLines.length > 0,
    hint: "由「分析产品」自动生成，重新分析可更新；为空时不参与拼接",
    text: aLines.join("\n")
  });
  const rulesText = templateConsistencyText(template);
  segs.push({
    kind: "consistency", label: "通用一致性要求", editable: true, present: Boolean(rulesText),
    hint: "在模板的「模板设置」里修改通用一致性要求",
    text: rulesText ? `一致性要求：\n${rulesText}` : ""
  });
  const extra = Array.isArray(analysis?.consistencyRules) ? analysis.consistencyRules : [];
  segs.push({
    kind: "analysis_consistency", label: "补充一致性约束", editable: false, present: extra.length > 0,
    hint: "由「分析产品」自动生成；为空时不参与拼接",
    text: extra.length ? ["补充一致性约束：", ...extra.map((item) => `- ${item}`)].join("\n") : ""
  });
  segs.push({
    kind: "retry", label: "本次重跑修正重点", editable: true, present: Boolean(retryHint),
    hint: "重跑时在该节点上方输入框填写，仅本次生成生效",
    text: retryHint ? `本次重跑修正重点：${retryHint}` : ""
  });
  segs.push({
    kind: "output", label: "输出要求", editable: false, present: true,
    hint: "固定内容，如需修改请改源码 buildImageSegments",
    text: "输出要求：生成高质量电商图片，产品占比清晰，构图专业。"
  });
  return segs;
}

function buildImagePrompt(args) {
  return (args.template?.kind === "mirror" ? buildMirrorImageSegments(args) : buildImageSegments(args))
    .filter((seg) => seg.present && seg.text)
    .map((seg) => seg.text)
    .join("\n");
}

function buildMirrorImageSegments({ node, sku, retryHint = "" }) {
  const segs = [];
  segs.push({
    kind: "mirror_task", label: "镜像复刻任务", editable: false, present: true,
    hint: "固定规则：来自镜像模板参考图，不在节点里单独编辑",
    text: "任务：以第一张模板参考图为主要视觉参考，复刻它的构图、场景、光影、背景、视角、布局和整体风格。"
  });
  segs.push({
    kind: "mirror_product", label: "商品替换要求", editable: false, present: true,
    hint: "固定规则：第二张图是当前 SKU 商品图",
    text: "商品替换：把模板参考图中的商品替换为当前 SKU 商品图中的商品，必须保持 SKU 商品的外观结构、颜色、logo、材质、细节和比例，不要沿用模板图里的原商品。"
  });
  segs.push({
    kind: "sku_name", label: "SKU / 产品名称", editable: false, present: true,
    hint: "来自新建 SKU 时填写的名称",
    text: `SKU/产品名称：${sku.name}`
  });
  segs.push({
    kind: "notes", label: "SKU 全局提示词", editable: true, present: Boolean(sku.notes),
    hint: "在镜像 SKU 工作台的「SKU 全局提示词」里修改",
    text: sku.notes ? `SKU 全局提示词：${sku.notes}` : ""
  });
  segs.push({
    kind: "retry", label: "本次节点修正", editable: true, present: Boolean(retryHint),
    hint: "重跑时在该节点上方输入框填写，仅本次生成生效",
    text: retryHint ? `本次节点修正：${retryHint}` : ""
  });
  segs.push({
    kind: "output", label: "输出要求", editable: false, present: true,
    hint: "固定内容，如需修改请改源码 buildMirrorImageSegments",
    text: "输出要求：生成高质量电商图，商品主体清晰，画面自然真实，无水印，无乱码，无错误文字。"
  });
  if (node?.referenceName) {
    segs.push({
      kind: "reference", label: "模板参考图", editable: false, present: false,
      hint: "来自镜像模板上传的参考图文件",
      text: `模板参考图：${node.referenceName}`
    });
  }
  return segs;
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
    const filenameStarMatch = /filename\*=([^;\r\n]+)/i.exec(rawHeaders);
    const filenameMatch = /filename="([^"]*)"/i.exec(rawHeaders);
    const contentTypeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(rawHeaders);
    const valueBuffer = Buffer.from(body, "binary");
    const filename = decodeMultipartFileName({
      filename: filenameMatch?.[1] || "",
      filenameStar: filenameStarMatch?.[1] || ""
    });
    if (filename) {
      files.push({
        fieldName: nameMatch[1],
        filename,
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
  // ---------------- 模板 ----------------
  if (url.pathname === "/api/templates") {
    if (req.method === "GET") {
      const list = rows(`SELECT t.*,
        (SELECT COUNT(*) FROM sku WHERE template_id = t.id) AS sku_count,
        CASE
          WHEN t.kind = 'mirror' THEN (SELECT COUNT(*) FROM template_image WHERE template_id = t.id AND deleted = 0)
          ELSE (SELECT COUNT(*) FROM template_node WHERE template_id = t.id AND deleted = 0)
        END AS node_count
        FROM template t ORDER BY t.created_at ASC`);
      return sendJson(res, 200, { templates: list });
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const name = body.name?.trim();
      if (!name) return sendJson(res, 400, { error: "模板名称不能为空" });
      let seedNodes = [];
      let consistency = consistencyRules;
      let defCount = null;
      let kind = "normal";
      let copiedTemplate = null;
      if (body.copyFrom) {
        const src = getTemplate(body.copyFrom);
        if (!src) return sendJson(res, 400, { error: "源模板不存在" });
        copiedTemplate = src;
        kind = src.kind === "mirror" ? "mirror" : "normal";
        if (kind === "normal") {
          seedNodes = templateNodes(body.copyFrom).map((n) => ({
            node_key: n.key, ord: n.order, label: n.label, description: n.description,
            uses_selected_main: n.usesSelectedMain, is_main: n.isMain, prompt: n.prompt, aspect: n.defaultAspect
          }));
        }
        consistency = templateConsistencyText(src);
        defCount = src.default_candidate_count;
      } else if (body.preset === "watch") {
        seedNodes = watchPresetNodes();
      } else {
        // 空白模板：预置一个主图首节点，后续节点默认依赖主图
        seedNodes = [{
          node_key: "main", ord: 1, label: "主图", description: "干净真实的产品主视觉。",
          uses_selected_main: 0, is_main: 1, prompt: "", aspect: "1:1"
        }];
      }
      const tpl = createTemplate({
        name, description: body.description?.trim() || null,
        consistencyRules: consistency, defaultCandidateCount: defCount, nodes: seedNodes, kind
      });
      if (kind === "mirror" && copiedTemplate) {
        await copyMirrorTemplateImages(copiedTemplate.id, tpl.id);
      }
      return sendJson(res, 200, { template: tpl });
    }
    return sendJson(res, 405, { error: "方法不被支持" });
  }

  if (url.pathname === "/api/templates/mirror") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "方法不被支持" });
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) return sendJson(res, 400, { error: "请使用 multipart/form-data 上传镜像模板参考图" });
    const { fields, files } = await parseMultipart(req, contentType);
    const name = fields.name?.trim();
    if (!name) return sendJson(res, 400, { error: "模板名称不能为空" });
    const imageFiles = files.filter((file) => (file.contentType || "").startsWith("image/")).slice(0, MIRROR_TEMPLATE_MAX_IMAGES);
    if (!imageFiles.length) return sendJson(res, 400, { error: "镜像模板至少需要 1 张参考图" });
    const tpl = createTemplate({
      name,
      description: fields.description?.trim() || null,
      consistencyRules: null,
      defaultCandidateCount: null,
      nodes: [],
      kind: "mirror"
    });
    try {
      for (const [index, file] of imageFiles.entries()) {
        await insertTemplateImageFromFile(tpl.id, file, index + 1);
      }
      touchTemplate(tpl.id);
      return sendJson(res, 200, { template: getTemplate(tpl.id), templateImages: templateImages(tpl.id), nodes: mirrorNodes(tpl.id) });
    } catch (error) {
      db.prepare("DELETE FROM template WHERE id = ?").run(tpl.id);
      await removeTemplateFiles(tpl.id);
      throw error;
    }
  }

  const tplMatch = /^\/api\/templates\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
  if (tplMatch) {
    const [, templateId, sub] = tplMatch;
    const template = getTemplate(templateId);
    if (!template) return sendJson(res, 404, { error: "模板不存在" });

    if (!sub && req.method === "GET") {
      const nodes = templateNodeList(template);
      return sendJson(res, 200, {
        template,
        consistencyText: templateConsistencyText(template),
        defaultConsistencyText: DEFAULT_CONSISTENCY_TEXT,
        nodes,
        templateImages: template.kind === "mirror" ? templateImages(templateId) : []
      });
    }
    if (!sub && (req.method === "PATCH" || req.method === "PUT")) {
      const body = await readJson(req);
      const name = body.name === undefined ? template.name : (String(body.name).trim() || template.name);
      const description = body.description === undefined ? template.description : (String(body.description).trim() || null);
      let rulesText = template.consistency_rules;
      // 兼容前端两种字段名：consistencyRules（驼峰）/ consistency_rules（下划线）
      const rulesInput = body.consistencyRules !== undefined ? body.consistencyRules
        : (body.consistency_rules !== undefined ? body.consistency_rules : undefined);
      if (rulesInput !== undefined) {
        // 纯文本原样存（保留换行），空则置 null 以回退内置默认
        const text = toConsistencyText(rulesInput).trim();
        rulesText = text || null;
      }
      let defCount = template.default_candidate_count;
      const countInput = body.defaultCandidateCount !== undefined ? body.defaultCandidateCount
        : (body.default_candidate_count !== undefined ? body.default_candidate_count : undefined);
      if (countInput !== undefined) {
        defCount = (countInput === null || countInput === "") ? null : normalizeCandidateCount(countInput);
      }
      // 短语：最多 50 条，每条 100 字内，去空
      let phrasesJson = template.phrases;
      if (body.phrases !== undefined) {
        const list = (Array.isArray(body.phrases) ? body.phrases : [])
          .map((p) => String(p == null ? "" : p).trim())
          .filter(Boolean)
          .map((p) => p.slice(0, 100))
          .slice(0, 50);
        phrasesJson = list.length ? JSON.stringify(list) : null;
      }
      db.prepare("UPDATE template SET name = ?, description = ?, consistency_rules = ?, default_candidate_count = ?, phrases = ?, updated_at = ? WHERE id = ?")
        .run(name, description, rulesText, defCount, phrasesJson, now(), templateId);
      return sendJson(res, 200, { template: getTemplate(templateId) });
    }
    if (!sub && req.method === "DELETE") {
      const used = row("SELECT COUNT(*) AS n FROM sku WHERE template_id = ?", templateId);
      if (used && used.n > 0) return sendJson(res, 400, { error: `该模板下还有 ${used.n} 个 SKU，请先删除或迁移后再删模板` });
      db.prepare("DELETE FROM template WHERE id = ?").run(templateId);
      if (template.kind === "mirror") await removeTemplateFiles(templateId);
      return sendJson(res, 200, { template });
    }
    if (sub === "skus" && req.method === "GET") {
      const list = rows("SELECT * FROM sku WHERE template_id = ? ORDER BY updated_at DESC", templateId).map((sku) => {
        // 封面优先级：已选定的最终图（按节点序，主图通常在前）> 任意上传的产品图
        const cover =
          row("SELECT file_path FROM candidate_image WHERE sku_id = ? AND selected = 1 ORDER BY node_key ASC LIMIT 1", sku.id) ||
          row("SELECT file_path FROM asset WHERE sku_id = ? AND source_type = 'upload' AND role != 'retry' ORDER BY created_at ASC LIMIT 1", sku.id);
        return {
          ...sku,
          cover_url: cover ? `/api/file?path=${encodeURIComponent(cover.file_path)}` : null
        };
      });
      return sendJson(res, 200, { template, skus: list });
    }
    if (sub === "images") {
      if (template.kind !== "mirror") return sendJson(res, 400, { error: "只有镜像模板支持参考图管理" });
      if (req.method === "POST") {
        const contentType = req.headers["content-type"] || "";
        if (!contentType.includes("multipart/form-data")) return sendJson(res, 400, { error: "请使用 multipart/form-data 上传参考图" });
        const { files } = await parseMultipart(req, contentType);
        const imageFiles = files.filter((file) => (file.contentType || "").startsWith("image/"));
        if (!imageFiles.length) return sendJson(res, 400, { error: "没有收到图片文件" });
        const activeCount = row("SELECT COUNT(*) AS n FROM template_image WHERE template_id = ? AND deleted = 0", templateId)?.n || 0;
        if (activeCount + imageFiles.length > MIRROR_TEMPLATE_MAX_IMAGES) {
          return sendJson(res, 400, { error: `镜像模板最多 ${MIRROR_TEMPLATE_MAX_IMAGES} 张参考图` });
        }
        const maxOrd = row("SELECT COALESCE(MAX(ord), 0) AS n FROM template_image WHERE template_id = ?", templateId)?.n || 0;
        for (const [index, file] of imageFiles.entries()) {
          await insertTemplateImageFromFile(templateId, file, maxOrd + index + 1);
        }
        touchTemplate(templateId);
        return sendJson(res, 200, { template: getTemplate(templateId), templateImages: templateImages(templateId), nodes: mirrorNodes(templateId) });
      }
      if (req.method === "PUT") {
        const body = await readJson(req);
        const incoming = Array.isArray(body.images) ? body.images : [];
        const existing = rows("SELECT * FROM template_image WHERE template_id = ? AND deleted = 0", templateId);
        const existingById = new Map(existing.map((r) => [r.id, r]));
        const keptIds = [];
        for (const item of incoming) {
          const id = typeof item === "string" ? item : item?.id;
          if (id && existingById.has(id) && !keptIds.includes(id)) keptIds.push(id);
        }
        if (!keptIds.length) return sendJson(res, 400, { error: "镜像模板至少需要保留 1 张参考图" });
        db.exec("BEGIN");
        try {
          keptIds.forEach((id, index) => {
            const item = incoming.find((value) => (typeof value === "string" ? value : value?.id) === id);
            const aspect = ASPECT_SIZE[item?.aspect] ? item.aspect : existingById.get(id).aspect;
            db.prepare("UPDATE template_image SET ord = ?, aspect = ?, deleted = 0 WHERE id = ? AND template_id = ?").run(index + 1, aspect || "1:1", id, templateId);
          });
          for (const r of existing) {
            if (!keptIds.includes(r.id)) db.prepare("UPDATE template_image SET deleted = 1 WHERE id = ? AND template_id = ?").run(r.id, templateId);
          }
          db.exec("COMMIT");
        } catch (txErr) {
          db.exec("ROLLBACK");
          throw txErr;
        }
        touchTemplate(templateId);
        return sendJson(res, 200, { template: getTemplate(templateId), templateImages: templateImages(templateId), nodes: mirrorNodes(templateId) });
      }
      return sendJson(res, 405, { error: "方法不被支持" });
    }
    if (sub === "nodes" && (req.method === "PUT" || req.method === "POST")) {
      if (template.kind === "mirror") return sendJson(res, 400, { error: "镜像模板不支持普通节点设置" });
      const body = await readJson(req);
      const incoming = Array.isArray(body.nodes) ? body.nodes : [];
      // is_main 唯一：只认列表里第一个标记为主图的节点
      let mainSeen = false;
      const existing = rows("SELECT * FROM template_node WHERE template_id = ?", templateId);
      const existingByKey = new Map(existing.map((r) => [r.node_key, r]));
      const hasMain = incoming.some((n) => n.isMain);
      const keptKeys = new Set();
      db.exec("BEGIN");
      try {
      incoming.forEach((n, index) => {
        const isMain = Boolean(n.isMain) && !mainSeen;
        if (isMain) mainSeen = true;
        const fields = {
          ord: index + 1,
          label: (n.label && String(n.label).trim()) || "未命名节点",
          description: n.description != null ? String(n.description) : null,
          uses_selected_main: (isMain || !hasMain) ? 0 : (n.usesSelectedMain ? 1 : 0),
          is_main: isMain ? 1 : 0,
          prompt: n.prompt != null ? String(n.prompt) : "",
          aspect: ASPECT_SIZE[n.aspect] ? n.aspect : "9:16"
        };
        const key = n.node_key && existingByKey.has(n.node_key) ? n.node_key : null;
        if (key) {
          // 已有节点：node_key 不可改，只更新其余字段并复活（取消软删除）
          keptKeys.add(key);
          db.prepare(`UPDATE template_node SET ord = ?, label = ?, description = ?, uses_selected_main = ?, is_main = ?, prompt = ?, aspect = ?, deleted = 0 WHERE template_id = ? AND node_key = ?`)
            .run(fields.ord, fields.label, fields.description, fields.uses_selected_main, fields.is_main, fields.prompt, fields.aspect, templateId, key);
        } else {
          const newKey = nextNodeKey(templateId);
          keptKeys.add(newKey);
          insertTemplateNode(templateId, { node_key: newKey, ...fields });
        }
      });
      // 未在提交列表中的现有节点 → 软删除（保留已出图历史）
      for (const r of existing) {
        if (!keptKeys.has(r.node_key) && !r.deleted) {
          db.prepare("UPDATE template_node SET deleted = 1 WHERE id = ?").run(r.id);
        }
      }
      db.exec("COMMIT");
      } catch (txErr) {
        db.exec("ROLLBACK");
        throw txErr;
      }
      touchTemplate(templateId);
      return sendJson(res, 200, { nodes: templateNodes(templateId) });
    }
    return sendJson(res, 405, { error: "方法不被支持" });
  }

  if (req.method === "POST" && url.pathname === "/api/skus") {
    const body = await readJson(req);
    if (!body.name?.trim()) return sendJson(res, 400, { error: "SKU 名称不能为空" });
    if (!body.templateId) return sendJson(res, 400, { error: "缺少所属模板" });
    if (!getTemplate(body.templateId)) return sendJson(res, 400, { error: "所属模板不存在" });
    return sendJson(res, 200, { sku: createSku({ name: body.name.trim(), notes: body.notes?.trim() || null, templateId: body.templateId }) });
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
    const template = getTemplate(sku.template_id);
    const skuAspects = parseAspects(sku.node_aspects_json);
    // 每个节点附带提示词分块预览（不含重跑修正，那是临时输入）
    const nodesWithPrompt = templateNodeList(template).map((node) => {
      const aspect = template?.kind === "mirror" ? (node.defaultAspect || "1:1") : (skuAspects[node.key] || node.defaultAspect || "1:1");
      return {
        ...node,
        aspect,
        promptSegments: template?.kind === "mirror"
          ? buildMirrorImageSegments({ node, sku, template, retryHint: "" })
          : buildImageSegments({ node, sku, template, retryHint: "" })
      };
    });
    const defaultCount = (template && template.default_candidate_count) || config.defaultCandidates;
    return sendJson(res, 200, {
      sku,
      template,
      assets,
      candidates,
      tasks,
      nodes: nodesWithPrompt,
      templateImages: template?.kind === "mirror" ? templateImages(template.id) : [],
      defaults: { candidateCount: defaultCount }
    });
  }

  if (req.method === "POST" && action === "upload") {
    const { fields, files } = await parseMultipart(req, req.headers["content-type"]);
    const role = fields.role || "source";
    if (!files.length) return sendJson(res, 400, { error: "没有收到上传文件" });
    const saved = [];
    const dir = path.join(uploadDir, skuId);
    await mkdir(dir, { recursive: true });
    const template = getTemplate(sku.template_id);
    const acceptedFiles = template?.kind === "mirror" && role === "source" ? files.slice(0, 1) : files;
    if (template?.kind === "mirror" && role === "source") {
      const oldAssets = rows("SELECT * FROM asset WHERE sku_id = ? AND source_type = 'upload' AND role = 'source'", skuId);
      for (const old of oldAssets) {
        db.prepare("DELETE FROM asset WHERE id = ? AND sku_id = ?").run(old.id, skuId);
        if (old.file_path && isInside(uploadDir, old.file_path) && existsSync(old.file_path)) {
          await rm(old.file_path, { force: true });
        }
      }
    }
    for (const file of acceptedFiles) {
      const ext = path.extname(file.filename) || extensionFromMime(file.contentType);
      const filePath = path.join(dir, `${Date.now()}_${role}_${safeFileName(path.basename(file.filename, ext))}${ext}`);
      await writeFile(filePath, file.buffer);
      saved.push(createAsset({ skuId, role, filePath, sourceType: "upload" }));
    }
    updateSku(skuId, { status: "uploaded" });
    return sendJson(res, 200, { assets: saved });
  }

  if (req.method === "DELETE" && action === "assets" && candidateId) {
    const assetId = candidateId;
    const asset = row("SELECT * FROM asset WHERE id = ? AND sku_id = ?", assetId, skuId);
    if (!asset) return sendJson(res, 404, { error: "产品图不存在" });
    if (asset.source_type !== "upload" || asset.role === "retry") {
      return sendJson(res, 400, { error: "只能删除上传的产品图" });
    }

    db.prepare("DELETE FROM asset WHERE id = ? AND sku_id = ?").run(assetId, skuId);
    if (asset.file_path && isInside(uploadDir, asset.file_path) && existsSync(asset.file_path)) {
      await rm(asset.file_path, { force: true });
    }

    const remainingUploads = row(
      "SELECT COUNT(*) AS n FROM asset WHERE sku_id = ? AND source_type = 'upload' AND role != 'retry'",
      skuId
    )?.n || 0;
    if (remainingUploads === 0) {
      updateSku(skuId, { analysis_json: null, selected_main_asset_id: null });
    }

    const nextStatus = recomputeSkuStatus(skuId);
    updateSku(skuId, { status: nextStatus });
    return sendJson(res, 200, { ok: true, status: nextStatus });
  }

  if (req.method === "POST" && action === "analyze") {
    const imageAssets = rows("SELECT * FROM asset WHERE sku_id = ? AND source_type = 'upload' ORDER BY created_at ASC", skuId);
    if (!imageAssets.length) return sendJson(res, 400, { error: "请先上传产品图" });
    const text = await analyzeProduct(sku, imageAssets);
    const analysis = parseJsonLoose(text);
    const updated = updateSku(skuId, { analysis_json: JSON.stringify(analysis, null, 2), status: "analyzed" });
    return sendJson(res, 200, { sku: updated, analysis });
  }

  // 保存人工编辑后的产品分析（生图时即用改后的内容）
  if (req.method === "POST" && action === "analysis") {
    const body = await readJson(req);
    const incoming = body && typeof body.analysis === "object" && body.analysis ? body.analysis : {};
    // 与既有分析合并，保留未在表单出现的字段（如 raw、consistencyRules）
    const prev = parseAnalysis(sku.analysis_json) || {};
    const merged = { ...prev, ...incoming };
    const updated = updateSku(skuId, { analysis_json: JSON.stringify(merged, null, 2), status: "analyzed" });
    return sendJson(res, 200, { sku: updated, analysis: merged });
  }

  if (req.method === "POST" && action === "settings") {
    const body = await readJson(req);
    const template = getTemplate(sku.template_id);
    const aspects = parseAspects(sku.node_aspects_json);
    let count = sku.candidate_count;
    if (body.count !== undefined && body.count !== null && body.count !== "") {
      count = normalizeCandidateCount(body.count);
    }
    let notes = sku.notes;
    if (body.notes !== undefined) {
      notes = String(body.notes || "").trim() || null;
    }
    if (body.nodeKey) {
      if (template?.kind === "mirror") return sendJson(res, 400, { error: "镜像模板节点比例由参考图决定" });
      getTemplateNode(sku.template_id, body.nodeKey);
      if (!ASPECT_SIZE[body.aspect]) return sendJson(res, 400, { error: "不支持的图片比例" });
      aspects[body.nodeKey] = body.aspect;
    }
    db.prepare("UPDATE sku SET candidate_count = ?, node_aspects_json = ?, notes = ?, updated_at = ? WHERE id = ?")
      .run(count ?? null, JSON.stringify(aspects), notes, now(), skuId);
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
    const node = getTemplateNode(sku.template_id, body.nodeKey);
    const template = getTemplate(sku.template_id);
    const uploadedAssets = rows("SELECT * FROM asset WHERE sku_id = ? AND source_type = 'upload' AND role != 'retry' ORDER BY created_at ASC", skuId);
    if (!uploadedAssets.length) return sendJson(res, 400, { error: "请先上传产品图" });
    let referenceAssets = [];
    let inputAssetIds = [];
    if (template?.kind === "mirror") {
      const templateImage = row("SELECT * FROM template_image WHERE template_id = ? AND node_key = ? AND deleted = 0", sku.template_id, node.key);
      if (!templateImage) return sendJson(res, 400, { error: "镜像参考图不存在或已删除" });
      referenceAssets = [templateImage, uploadedAssets[0]];
      inputAssetIds = [`template_image:${templateImage.id}`, uploadedAssets[0].id];
    } else {
      referenceAssets = [...uploadedAssets];
      inputAssetIds = referenceAssets.map((asset) => asset.id);
    }
    if (template?.kind !== "mirror" && node.usesSelectedMain) {
      if (!sku.selected_main_asset_id) return sendJson(res, 400, { error: "请先选择一张主图" });
      const selectedMain = row("SELECT * FROM asset WHERE id = ?", sku.selected_main_asset_id);
      if (selectedMain) {
        referenceAssets.push(selectedMain);
        inputAssetIds.push(selectedMain.id);
      }
    }
    // 本次重跑临时上传的修正参考图：与文字提示一起作为生成输入
    if (retryFiles.length) {
      const retryDir = path.join(uploadDir, skuId, "retry");
      await mkdir(retryDir, { recursive: true });
      for (const file of retryFiles) {
        const ext = path.extname(file.filename) || extensionFromMime(file.contentType);
        const filePath = path.join(retryDir, `${Date.now()}_retry_${safeFileName(path.basename(file.filename, ext))}${ext}`);
        await writeFile(filePath, file.buffer);
        const retryAsset = createAsset({ skuId, role: "retry", filePath, sourceType: "upload" });
        referenceAssets.push(retryAsset);
        inputAssetIds.push(retryAsset.id);
      }
    }
    const prompt = buildImagePrompt({ node, sku, template, retryHint: body.retryHint || "" });
    const count = effectiveCandidateCount({ requested: body.count, sku, template });
    const aspect = template?.kind === "mirror" ? (node.defaultAspect || "1:1") : (parseAspects(sku.node_aspects_json)[node.key] || node.defaultAspect || "1:1");
    const size = ASPECT_SIZE[aspect] || ASPECT_SIZE["1:1"];
    const task = createTask({ skuId, nodeKey: node.key, prompt, inputAssetIds });
    try {
      const results = await generateImages({ prompt, count, referenceAssets, size });
      const candidates = [];
      for (const [index, result] of results.entries()) {
        const filePath = await saveGeneratedImage({ skuId, nodeKey: node.key, b64: result.b64, mimeType: result.mimeType, index });
        candidates.push(createCandidate({ skuId, taskId: task.id, nodeKey: node.key, filePath, prompt }));
      }
      updateTask(task.id, { status: "completed" });
      updateSku(skuId, { status: node.isMain ? "main_generated" : "details_generated" });
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
    db.prepare("UPDATE candidate_image SET selected = 1 WHERE id = ?").run(candidateId);
    const asset = createAsset({ skuId, role: `selected_${candidate.node_key}`, filePath: candidate.file_path, sourceType: "selected" });
    const candNode = getTemplateNode(sku.template_id, candidate.node_key);
    if (candNode.isMain) updateSku(skuId, { selected_main_asset_id: asset.id, status: "main_selected" });
    return sendJson(res, 200, { candidate: row("SELECT * FROM candidate_image WHERE id = ?", candidateId) });
  }

  if (req.method === "DELETE" && action === "candidates" && candidateId) {
    const candidate = row("SELECT * FROM candidate_image WHERE id = ? AND sku_id = ?", candidateId, skuId);
    if (!candidate) return sendJson(res, 404, { error: "候选图不存在" });

    const candidateFile = candidate.file_path;
    const selectedAssets = rows("SELECT * FROM asset WHERE sku_id = ? AND source_type = 'selected' AND file_path = ?", skuId, candidateFile);
    if (selectedAssets.some((asset) => asset.id === sku.selected_main_asset_id)) {
      updateSku(skuId, { selected_main_asset_id: null });
    }

    db.prepare("UPDATE candidate_image SET selected = 0 WHERE sku_id = ? AND node_key = ?").run(skuId, candidate.node_key);
    db.prepare("DELETE FROM candidate_image WHERE id = ? AND sku_id = ?").run(candidateId, skuId);
    for (const asset of selectedAssets) {
      db.prepare("DELETE FROM asset WHERE id = ? AND sku_id = ?").run(asset.id, skuId);
    }

    if (candidateFile && isInside(generatedDir, candidateFile) && existsSync(candidateFile)) {
      await rm(candidateFile, { force: true });
    }

    const nextStatus = recomputeSkuStatus(skuId);
    updateSku(skuId, { status: nextStatus });
    return sendJson(res, 200, { ok: true, status: nextStatus });
  }

  if (req.method === "GET" && action === "export") {
    const selected = rows("SELECT * FROM candidate_image WHERE sku_id = ? AND selected = 1 ORDER BY node_key ASC", skuId);
    if (!selected.length) return sendJson(res, 400, { error: "还没有选择最终图" });
    const files = [];
    const prompts = [];
    const meta = [];
    const template = getTemplate(sku.template_id);
    for (const node of templateNodeList(template, { includeDeleted: true })) {
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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
    // 前端构建产物（web/ 经 `npm run build` 输出到 dist/）：静态资源 + SPA fallback
    if (req.method === "GET" || req.method === "HEAD") {
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = path.join(distDir, rel);
      if (rel && isInside(distDir, filePath) && existsSync(filePath) && (await stat(filePath)).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const cache = url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
        return serveFile(res, filePath, STATIC_MIME[ext], cache);
      }
      const indexHtml = path.join(distDir, "index.html");
      if (existsSync(indexHtml)) return serveFile(res, indexHtml, "text/html; charset=utf-8", "no-cache");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>前端尚未构建</h1><p>请在 <code>web/</code> 目录执行 <code>npm install &amp;&amp; npm run build</code> 后刷新。</p>");
      return;
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
  const address = server.address();
  const port = typeof address === "object" && address && "port" in address ? address.port : config.port;
  console.log(`电商图片工作流已启动：http://127.0.0.1:${port}`);
});
