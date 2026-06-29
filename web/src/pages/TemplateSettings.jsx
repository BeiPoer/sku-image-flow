import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Form,
  Input,
  TextArea,
  Select,
  Switch,
  Spin,
  Tag,
  Toast,
  Typography,
  Popconfirm,
} from "@douyinfe/semi-ui";
import {
  IconPlus,
  IconDelete,
  IconArrowUp,
  IconArrowDown,
  IconSave,
  IconStar,
  IconImage,
} from "@douyinfe/semi-icons";
import { api } from "../api.js";
import AppHeader from "../components/AppHeader.jsx";
import { imageFilesFromClipboard, isEditablePasteTarget } from "../utils/clipboardImages.js";

const { Title, Paragraph, Text } = Typography;

const MAX_CANDIDATE_COUNT = 4;
const ASPECT_OPTIONS = ["1:1", "3:4", "4:3", "16:9", "9:16"].map((v) => ({ value: v, label: v }));
const MIRROR_ASPECT_OPTIONS = ["1:1", "3:4", "4:3", "16:9", "9:16"].map((v) => ({ value: v, label: aspectLabel(v) }));

function clampCandidateCount(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.min(MAX_CANDIDATE_COUNT, parsed));
}

function aspectLabel(value) {
  const cls = "aspect-graphic " + aspectClass(value);
  return (
    <span className="aspect-option">
      <span className={cls} aria-hidden="true">
        <span className="aspect-inner" />
      </span>
      <span className="aspect-text">{value}</span>
    </span>
  );
}

function aspectClass(value) {
  switch (value) {
    case "1:1":
      return "is-square";
    case "3:4":
      return "is-portrait";
    case "4:3":
      return "is-landscape";
    case "16:9":
      return "is-wide";
    case "9:16":
      return "is-tall";
    default:
      return "is-square";
  }
}

let tempSeq = 0;
function blankNode() {
  tempSeq += 1;
  return {
    _uid: "new_" + tempSeq,
    node_key: "", // 空 = 新节点，由后端分配 key
    label: "新节点",
    description: "",
    prompt: "",
    isMain: false,
    usesSelectedMain: true,
    aspect: "9:16",
  };
}

function fromServer(n) {
  return {
    _uid: n.node_key || n.key || "row_" + (tempSeq += 1),
    node_key: n.node_key || n.key || "",
    label: n.label || "",
    description: n.description || "",
    prompt: n.prompt || "",
    isMain: Boolean(n.is_main ?? n.isMain),
    usesSelectedMain: Boolean(n.uses_selected_main ?? n.usesSelectedMain),
    aspect: n.aspect || n.defaultAspect || "9:16",
  };
}

const MAX_PHRASES = 50;
const MAX_PHRASE_LEN = 100;

function parsePhrases(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map((s) => String(s)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// 镜像参考图放大预览层：全屏遮罩 + 居中大图，点遮罩或按 Esc 关闭。
function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="wb-lightbox" onClick={onClose}>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <button className="wb-lightbox-close" onClick={onClose} aria-label="关闭">×</button>
    </div>
  );
}

export default function TemplateSettings() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingNodes, setSavingNodes] = useState(false);
  const [info, setInfo] = useState({ name: "", description: "", consistency_rules: "", default_candidate_count: "" });
  const [templateKind, setTemplateKind] = useState("normal");
  const [phrases, setPhrases] = useState([]);
  const [newPhrase, setNewPhrase] = useState("");
  const [savingPhrases, setSavingPhrases] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [templateImages, setTemplateImages] = useState([]);
  const [savingImages, setSavingImages] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageDragOver, setImageDragOver] = useState(false);
  const [preview, setPreview] = useState("");
  const imageInputRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const json = await api("/api/templates/" + encodeURIComponent(templateId));
      const t = json.template;
      setTemplateKind(t.kind || "normal");
      setInfo({
        name: t.name || "",
        description: t.description || "",
        consistency_rules: json.consistencyText || "",
        default_candidate_count: t.default_candidate_count == null ? "" : clampCandidateCount(t.default_candidate_count),
      });
      setPhrases(parsePhrases(t.phrases));
      setNodes((json.nodes || []).map(fromServer));
      setTemplateImages(json.templateImages || []);
    } catch (error) {
      Toast.error(error.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function saveInfo() {
    setSavingInfo(true);
    try {
      const countRaw = String(info.default_candidate_count).trim();
      const payload = {
        name: info.name,
        description: info.description,
        default_candidate_count: countRaw === "" ? null : clampCandidateCount(countRaw),
      };
      if (templateKind !== "mirror") payload.consistency_rules = info.consistency_rules;
      await api("/api/templates/" + encodeURIComponent(templateId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      Toast.success("模板信息已保存");
    } catch (error) {
      Toast.error(error.message || "保存失败");
    } finally {
      setSavingInfo(false);
    }
  }

  // 保存短语（独立保存，立即对该模板下所有 SKU 的重跑快填生效）
  async function persistPhrases(list) {
    setSavingPhrases(true);
    try {
      await api("/api/templates/" + encodeURIComponent(templateId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrases: list }),
      });
      setPhrases(list);
      Toast.success("短语已保存");
    } catch (error) {
      Toast.error(error.message || "保存失败");
    } finally {
      setSavingPhrases(false);
    }
  }

  function addPhrase() {
    const v = newPhrase.trim();
    if (!v) return;
    if (v.length > MAX_PHRASE_LEN) {
      Toast.warning("单条短语不超过 " + MAX_PHRASE_LEN + " 字");
      return;
    }
    if (phrases.length >= MAX_PHRASES) {
      Toast.warning("最多 " + MAX_PHRASES + " 条短语");
      return;
    }
    if (phrases.includes(v)) {
      Toast.warning("该短语已存在");
      return;
    }
    persistPhrases([...phrases, v]);
    setNewPhrase("");
  }

  function removePhrase(idx) {
    persistPhrases(phrases.filter((_, i) => i !== idx));
  }

  function patchNode(uid, patch) {
    setNodes((prev) => prev.map((n) => (n._uid === uid ? { ...n, ...patch } : n)));
  }

  // 主图为单选：设某节点为主图时，其余取消；主图节点不"依赖已选主图"
  function setMain(uid, value) {
    setNodes((prev) =>
      prev.map((n) => {
        if (n._uid === uid) return { ...n, isMain: value, usesSelectedMain: value ? false : n.usesSelectedMain };
        return value ? { ...n, isMain: false } : n;
      })
    );
  }

  function move(index, dir) {
    setNodes((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function moveImage(index, dir) {
    setTemplateImages((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeImage(id) {
    if (templateImages.length <= 1) {
      Toast.warning("镜像模板至少保留 1 张参考图");
      return;
    }
    const removed = templateImages.find((item) => item.id === id);
    if (removed && removed.url === preview) setPreview("");
    setTemplateImages((prev) => prev.filter((item) => item.id !== id));
  }

  async function saveImages() {
    if (!templateImages.length) {
      Toast.warning("镜像模板至少保留 1 张参考图");
      return;
    }
    setSavingImages(true);
    try {
      const json = await api("/api/templates/" + encodeURIComponent(templateId) + "/images", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: templateImages.map((item) => ({ id: item.id, aspect: item.aspect || "1:1" })) }),
      });
      setTemplateImages(json.templateImages || []);
      Toast.success("参考图设置已保存");
    } catch (error) {
      Toast.error(error.message || "保存失败");
    } finally {
      setSavingImages(false);
    }
  }

  async function uploadImages(fileList) {
    const files = Array.from(fileList || []).filter((file) => (file.type || "").startsWith("image/"));
    if (!files.length) return;
    setUploadingImages(true);
    try {
      const form = new FormData();
      for (const file of files) form.append("file", file);
      const json = await api("/api/templates/" + encodeURIComponent(templateId) + "/images", { method: "POST", body: form });
      setTemplateImages(json.templateImages || []);
      Toast.success("已追加 " + files.length + " 张参考图");
    } catch (error) {
      Toast.error(error.message || "上传失败");
    } finally {
      setUploadingImages(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  function patchImage(id, patch) {
    setTemplateImages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function handleImageDrop(e) {
    e.preventDefault();
    setImageDragOver(false);
    uploadImages(e.dataTransfer?.files);
  }

  function handleImagePaste(e) {
    if (isEditablePasteTarget(e.target)) return;
    const files = imageFilesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    uploadImages(files);
  }

  useEffect(() => {
    if (templateKind !== "mirror") return undefined;
    const onPaste = (e) => {
      if (e.defaultPrevented || isEditablePasteTarget(e.target)) return;
      const files = imageFilesFromClipboard(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      uploadImages(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [templateKind, templateId]);

  function removeNode(uid) {
    setNodes((prev) => prev.filter((n) => n._uid !== uid));
  }

  async function saveNodes() {
    if (!nodes.length) {
      Toast.warning("至少保留一个节点");
      return;
    }
    setSavingNodes(true);
    try {
      const payload = nodes.map((n) => ({
        node_key: n.node_key || undefined,
        label: n.label,
        description: n.description,
        prompt: n.prompt,
        isMain: n.isMain,
        usesSelectedMain: n.usesSelectedMain,
        aspect: n.aspect,
      }));
      const json = await api("/api/templates/" + encodeURIComponent(templateId) + "/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: payload }),
      });
      setNodes((json.nodes || []).map(fromServer));
      Toast.success("节点已保存（对该模板下所有 SKU 实时生效）");
    } catch (error) {
      Toast.error(error.message || "保存失败");
    } finally {
      setSavingNodes(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <AppHeader title="模板设置" backTo={"/templates/" + templateId} />
        <div className="center-box"><Spin size="large" /></div>
      </div>
    );
  }

  return (
    <div className="page">
      <AppHeader
        title={info.name || "模板设置"}
        subtitle={templateKind === "mirror" ? "模板信息、短语与镜像参考图" : "模板信息、短语与详情图节点流程"}
        backTo={"/templates/" + templateId}
      />

      <Card className="panel" title={<span className="panel-title">模板信息</span>}>
        <Form labelPosition="top">
          <Form.Slot label="模板名称">
            <Input value={info.name} onChange={(v) => setInfo((s) => ({ ...s, name: v }))} placeholder="模板名称" />
          </Form.Slot>
          <Form.Slot label="模板说明">
            <TextArea
              value={info.description}
              onChange={(v) => setInfo((s) => ({ ...s, description: v }))}
              autosize={{ minRows: 2, maxRows: 4 }}
              placeholder="适用品类、风格，可留空"
            />
          </Form.Slot>
          {templateKind !== "mirror" && (
            <Form.Slot label="通用一致性要求（自由文本，会原样参与所有节点的生图提示词）">
              <TextArea
                value={info.consistency_rules}
                onChange={(v) => setInfo((s) => ({ ...s, consistency_rules: v }))}
                autosize={{ minRows: 3, maxRows: 8 }}
                placeholder="例如：保持产品 logo、表盘刻度、配色一致"
              />
            </Form.Slot>
          )}
          <Form.Slot label="默认候选张数（每个节点每次生成的候选图数量，留空用全局默认）">
            <Input
              type="number"
              min={1}
              max={MAX_CANDIDATE_COUNT}
              value={info.default_candidate_count}
              onChange={(v) => setInfo((s) => ({ ...s, default_candidate_count: v }))}
              placeholder={`1 ~ ${MAX_CANDIDATE_COUNT}`}
              style={{ maxWidth: 160 }}
            />
          </Form.Slot>
          <Button theme="solid" type="primary" icon={<IconSave />} loading={savingInfo} onClick={saveInfo}>
            保存模板信息
          </Button>
        </Form>
      </Card>

      <Card
        className="panel"
        title={<span className="panel-title">短语设置（{phrases.length}/{MAX_PHRASES}）</span>}
      >
        <Paragraph type="tertiary" style={{ marginBottom: 12 }}>
          这些短语会显示在「重跑修正」输入框下方，点击即可快速填入。最多 {MAX_PHRASES} 条，每条 {MAX_PHRASE_LEN} 字内。对该模板下所有 SKU 生效。
        </Paragraph>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Input
            value={newPhrase}
            onChange={setNewPhrase}
            onEnterPress={addPhrase}
            maxLength={MAX_PHRASE_LEN}
            showClear
            placeholder="输入一条短语，回车或点「添加」"
            disabled={phrases.length >= MAX_PHRASES}
          />
          <Button
            icon={<IconPlus />}
            theme="solid"
            type="primary"
            loading={savingPhrases}
            disabled={!newPhrase.trim() || phrases.length >= MAX_PHRASES}
            onClick={addPhrase}
          >
            添加
          </Button>
        </div>
        {phrases.length === 0 ? (
          <Text type="tertiary" size="small">还没有短语。</Text>
        ) : (
          <div className="phrase-list">
            {phrases.map((p, i) => (
              <Tag
                key={i}
                size="large"
                color="blue"
                closable
                onClose={() => removePhrase(i)}
                className="phrase-tag"
              >
                {p}
              </Tag>
            ))}
          </div>
        )}
      </Card>

      {templateKind === "mirror" ? (
        <Card
          className="panel"
          title={<span className="panel-title"><IconImage /> 镜像参考图（{templateImages.length}）</span>}
          headerExtraContent={
            <>
              <Button icon={<IconPlus />} theme="light" loading={uploadingImages} onClick={() => imageInputRef.current?.click()}>
                追加参考图
              </Button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => uploadImages(e.target.files)}
              />
            </>
          }
        >
          <Paragraph type="tertiary" style={{ marginBottom: 16 }}>
            每张参考图就是一个镜像节点。这里只管理参考图的顺序、比例和增删，不配置节点提示词或主图依赖。可点击追加、拖拽图片，或直接 Ctrl+V 粘贴图片。
          </Paragraph>
          <div
            className={"mirror-image-list" + (imageDragOver ? " dragover" : "")}
            tabIndex={0}
            onDragOver={(e) => { e.preventDefault(); setImageDragOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setImageDragOver(false); }}
            onDrop={handleImageDrop}
            onPaste={handleImagePaste}
          >
            {templateImages.map((img, i) => (
              <div className="mirror-image-row" key={img.id}>
                <div className="node-order">{i + 1}</div>
                <img
                  src={img.url}
                  alt={img.original_name || "参考图"}
                  className="mirror-image-preview"
                  title="点击预览"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreview(img.url)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPreview(img.url);
                    }
                  }}
                />
                <div className="mirror-image-info">
                  <Text strong>镜像图 {String(i + 1).padStart(2, "0")}</Text>
                  <Text type="tertiary" size="small">{img.original_name || "参考图"}</Text>
                  <Text type="quaternary" size="small">key: {img.node_key}</Text>
                </div>
                <Select
                  value={img.aspect || "1:1"}
                  onChange={(value) => patchImage(img.id, { aspect: value })}
                  optionList={MIRROR_ASPECT_OPTIONS}
                  size="small"
                  style={{ width: 120 }}
                />
                <Button icon={<IconArrowUp />} theme="borderless" size="small" disabled={i === 0} onClick={() => moveImage(i, -1)} aria-label="上移" />
                <Button icon={<IconArrowDown />} theme="borderless" size="small" disabled={i === templateImages.length - 1} onClick={() => moveImage(i, 1)} aria-label="下移" />
                <Popconfirm title="删除参考图" content="保存后该参考图会从镜像节点中移除，历史候选图仍保留。" okType="danger" okText="删除" cancelText="取消" onConfirm={() => removeImage(img.id)}>
                  <Button icon={<IconDelete />} theme="borderless" type="danger" size="small" aria-label="删除" />
                </Popconfirm>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <Button theme="solid" type="primary" icon={<IconSave />} loading={savingImages} onClick={saveImages}>
              保存参考图设置
            </Button>
            <Button theme="borderless" onClick={() => navigate("/templates/" + templateId)}>
              返回 SKU 列表
            </Button>
          </div>
        </Card>
      ) : (
        <Card
          className="panel"
          title={<span className="panel-title">节点流程（{nodes.length}）</span>}
          headerExtraContent={
            <Button icon={<IconPlus />} theme="light" onClick={() => setNodes((p) => [...p, blankNode()])}>
              添加节点
            </Button>
          }
        >
          <Paragraph type="tertiary" style={{ marginBottom: 16 }}>
            顺序即生成与导出顺序。标记「主图」的节点产出主图（只能有一个）；标记「依赖已选主图」的节点，需先在主图节点选定一张图后才能生成。
          </Paragraph>

          <div className="node-list">
            {nodes.map((n, i) => (
              <div className="node-row" key={n._uid}>
                <div className="node-row-head">
                  <div className="node-order">{i + 1}</div>
                  <Input
                    value={n.label}
                    onChange={(v) => patchNode(n._uid, { label: v })}
                    placeholder="节点名称"
                    prefix={n.isMain ? <IconStar style={{ color: "var(--semi-color-warning)" }} /> : undefined}
                    style={{ flex: 1 }}
                  />
                  <Select
                    value={n.aspect}
                    onChange={(v) => patchNode(n._uid, { aspect: v })}
                    optionList={ASPECT_OPTIONS}
                    style={{ width: 96 }}
                  />
                  <Button icon={<IconArrowUp />} theme="borderless" size="small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移" />
                  <Button icon={<IconArrowDown />} theme="borderless" size="small" disabled={i === nodes.length - 1} onClick={() => move(i, 1)} aria-label="下移" />
                  <Popconfirm title="删除节点" content="保存后该节点将被软删除，历史图片仍保留。" okType="danger" okText="删除" cancelText="取消" onConfirm={() => removeNode(n._uid)}>
                    <Button icon={<IconDelete />} theme="borderless" type="danger" size="small" aria-label="删除" />
                  </Popconfirm>
                </div>

                <div className="node-row-toggles">
                  <span className="node-toggle">
                    <Switch checked={n.isMain} onChange={(v) => setMain(n._uid, v)} size="small" />
                    <Text size="small">设为主图节点</Text>
                  </span>
                  <span className="node-toggle">
                    <Switch
                      checked={n.usesSelectedMain}
                      onChange={(v) => patchNode(n._uid, { usesSelectedMain: v })}
                      size="small"
                      disabled={n.isMain}
                    />
                    <Text size="small" type={n.isMain ? "quaternary" : undefined}>依赖已选主图</Text>
                  </span>
                  {n.node_key ? <Text type="quaternary" size="small">key: {n.node_key}</Text> : <Text type="tertiary" size="small">（新节点，保存后分配 key）</Text>}
                </div>

                <TextArea
                  value={n.prompt}
                  onChange={(v) => patchNode(n._uid, { prompt: v })}
                  autosize={{ minRows: 2, maxRows: 6 }}
                  placeholder="该节点的生图提示词"
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <Button theme="solid" type="primary" icon={<IconSave />} loading={savingNodes} onClick={saveNodes}>
              保存节点
            </Button>
            <Button theme="borderless" onClick={() => navigate("/templates/" + templateId)}>
              返回 SKU 列表
            </Button>
          </div>
        </Card>
      )}
      {preview ? <Lightbox src={preview} onClose={() => setPreview("")} /> : null}
    </div>
  );
}
