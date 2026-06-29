import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Collapsible,
  Empty,
  Form,
  RadioGroup,
  Radio,
  Select,
  Popconfirm,
  Spin,
  Tag,
  Toast,
  Typography,
} from "@douyinfe/semi-ui";
import {
  IconPlus,
  IconRefresh,
  IconSetting,
  IconDelete,
  IconCopy,
  IconChevronRight,
  IconChevronDown,
  IconLayers,
  IconImage,
} from "@douyinfe/semi-icons";
import { api } from "../api.js";
import AppHeader from "../components/AppHeader.jsx";
import Dashboard from "../components/Dashboard.jsx";
import SystemSettingsModal from "../components/SystemSettingsModal.jsx";
import { imageFilesFromClipboard, isEditablePasteTarget } from "../utils/clipboardImages.js";

const { Title, Paragraph, Text } = Typography;
const MIRROR_ASPECT_RATIOS = {
  "1:1": { width: 1, height: 1 },
  "3:4": { width: 3, height: 4 },
  "4:3": { width: 4, height: 3 },
  "16:9": { width: 16, height: 9 },
  "9:16": { width: 9, height: 16 }
};
const MIRROR_ASPECT_OPTIONS = ["1:1", "3:4", "4:3", "16:9", "9:16"].map((value) => ({
  value,
  label: aspectLabel(value)
}));

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

function stripExtension(name) {
  return String(name || "mirror").replace(/\.[^.]+$/, "") || "mirror";
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("大图加载失败，请换一张图片重试"));
    img.src = src;
  });
}

async function sliceMirrorImage(file, sourceUrl, aspect) {
  const ratio = MIRROR_ASPECT_RATIOS[aspect] || MIRROR_ASPECT_RATIOS["9:16"];
  const img = await loadImage(sourceUrl);
  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;
  if (!width || !height) throw new Error("大图尺寸无效");

  const targetHeight = (width * ratio.height) / ratio.width;
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) throw new Error("所选比例无效");
  const sliceHeightPx = Math.max(1, Math.round(targetHeight));

  const baseName = stripExtension(file.name);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持图片切片");

  const starts = [];
  for (let start = 0; start < height; start += sliceHeightPx) {
    starts.push(start);
  }
  if (starts.length > 50) {
    throw new Error(`切片后会得到 ${starts.length} 张图片，超过了 50 张限制`);
  }

  const files = [];
  let padded = false;
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const drawHeight = Math.min(sliceHeightPx, height - start);
    if (drawHeight <= 0) continue;
    canvas.width = width;
    canvas.height = sliceHeightPx;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, sliceHeightPx);
    if (drawHeight < sliceHeightPx) padded = true;
    ctx.drawImage(img, 0, start, width, drawHeight, 0, 0, width, drawHeight);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("切片导出失败"));
      }, "image/png");
    });
    const suffix = String(index + 1).padStart(2, "0");
    const slicedFile = new File([blob], `${baseName}_${suffix}.png`, { type: blob.type || "image/png" });
    files.push({ file: slicedFile, url: URL.createObjectURL(blob) });
  }

  if (!files.length) throw new Error("没有生成任何切片");

  return {
    files,
    summary: {
      count: files.length,
      width,
      height,
      targetHeight: sliceHeightPx,
      exact: height % sliceHeightPx === 0,
      padded
    }
  };
}

export default function TemplatesHome() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [copyingId, setCopyingId] = useState("");
  const [createKind, setCreateKind] = useState("normal");
  const [mirrorCreateMode, setMirrorCreateMode] = useState("files");
  const [mirrorFiles, setMirrorFiles] = useState([]);
  const [mirrorDragOver, setMirrorDragOver] = useState(false);
  const [mirrorSliceSource, setMirrorSliceSource] = useState(null);
  const [mirrorSliceAspect, setMirrorSliceAspect] = useState("9:16");
  const [mirrorSliceFiles, setMirrorSliceFiles] = useState([]);
  const [mirrorSliceBusy, setMirrorSliceBusy] = useState(false);
  const [mirrorSliceDragOver, setMirrorSliceDragOver] = useState(false);
  const [mirrorSliceSummary, setMirrorSliceSummary] = useState(null);
  const [preview, setPreview] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashRefresh, setDashRefresh] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const formApi = useRef(null);
  const mirrorInputRef = useRef(null);
  const mirrorSliceInputRef = useRef(null);
  const mirrorFilesRef = useRef([]);
  const mirrorSliceSourceRef = useRef(null);
  const mirrorSliceFilesRef = useRef([]);
  const mirrorSliceJobRef = useRef(0);

  async function load() {
    setLoading(true);
    try {
      const json = await api("/api/templates");
      setTemplates(json.templates || []);
    } catch (error) {
      Toast.error(error.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    mirrorFilesRef.current = mirrorFiles;
  }, [mirrorFiles]);

  useEffect(() => {
    mirrorSliceFilesRef.current = mirrorSliceFiles;
  }, [mirrorSliceFiles]);

  useEffect(() => {
    mirrorSliceSourceRef.current = mirrorSliceSource;
  }, [mirrorSliceSource]);

  useEffect(() => () => {
    for (const item of mirrorFilesRef.current) URL.revokeObjectURL(item.url);
    for (const item of mirrorSliceFilesRef.current) URL.revokeObjectURL(item.url);
    if (mirrorSliceSourceRef.current?.url) URL.revokeObjectURL(mirrorSliceSourceRef.current.url);
  }, []);

  function closePreviewIfUsing(urlOrUrls) {
    const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
    setPreview((current) => (current && urls.includes(current) ? "" : current));
  }

  function replaceMirrorSliceFiles(nextFiles) {
    const prev = mirrorSliceFilesRef.current;
    closePreviewIfUsing(prev.map((item) => item.url));
    for (const item of prev) URL.revokeObjectURL(item.url);
    mirrorSliceFilesRef.current = nextFiles;
    setMirrorSliceFiles(nextFiles);
  }

  function setMirrorSliceSourceSafe(nextSource) {
    const prev = mirrorSliceSourceRef.current;
    if (prev?.url && prev.url !== nextSource?.url) {
      closePreviewIfUsing(prev.url);
      URL.revokeObjectURL(prev.url);
    }
    mirrorSliceSourceRef.current = nextSource;
    setMirrorSliceSource(nextSource);
  }

  async function rebuildMirrorSlicePreview(sourceFile, sourceUrl, aspect) {
    const jobId = mirrorSliceJobRef.current + 1;
    mirrorSliceJobRef.current = jobId;
    setMirrorSliceBusy(true);
    setMirrorSliceSummary(null);
    try {
      const result = await sliceMirrorImage(sourceFile, sourceUrl, aspect);
      if (mirrorSliceJobRef.current !== jobId) {
        for (const item of result.files) URL.revokeObjectURL(item.url);
        return;
      }
      replaceMirrorSliceFiles(result.files);
      const { count, width, height, targetHeight, exact } = result.summary;
      setMirrorSliceSummary({
        count,
        width,
        height,
        targetHeight,
        exact,
        note: result.summary.padded
          ? "尾部不足一个完整切片，最后一张已用白色填充以保持比例一致"
          : (exact ? "已按所选比例完整切片" : "已按所选比例完成切片")
      });
    } catch (error) {
      if (mirrorSliceJobRef.current !== jobId) return;
      replaceMirrorSliceFiles([]);
      setMirrorSliceSummary(null);
      Toast.error(error.message || "大图切片失败");
    } finally {
      if (mirrorSliceJobRef.current === jobId) {
        setMirrorSliceBusy(false);
      }
    }
  }

  async function handleCreate(values) {
    const name = values.name?.trim();
    if (!name) {
      Toast.warning("请填写模板名称");
      return;
    }
    const mirrorCreateFiles = mirrorCreateMode === "slice" ? mirrorSliceFiles : mirrorFiles;
    if (createKind === "mirror" && !mirrorCreateFiles.length) {
      Toast.warning(mirrorCreateMode === "slice" ? "请先导入大图并完成切片" : "镜像模板至少需要上传 1 张参考图");
      return;
    }
    if (createKind === "mirror" && mirrorCreateMode === "slice" && mirrorSliceBusy) {
      Toast.warning("大图切片中，请稍后再创建");
      return;
    }
    setSubmitting(true);
    try {
      let json;
      if (createKind === "mirror") {
        const form = new FormData();
        form.append("name", name);
        form.append("description", values.description || "");
        for (const item of mirrorCreateFiles) form.append("file", item.file);
        json = await api("/api/templates/mirror", { method: "POST", body: form });
      } else {
        json = await api("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: values.description }),
        });
      }
      navigate("/templates/" + json.template.id + "/settings");
    } catch (error) {
      Toast.error(error.message || "创建失败");
      setSubmitting(false);
    }
  }

  function addMirrorFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((file) => (file.type || "").startsWith("image/"));
    if (!incoming.length) return;
    setMirrorFiles((prev) => {
      const room = 50 - prev.length;
      if (room <= 0) {
        Toast.info("镜像模板最多 50 张参考图");
        return prev;
      }
      if (incoming.length > room) Toast.info("最多 50 张，多余的已忽略");
      return [...prev, ...incoming.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))];
    });
    if (mirrorInputRef.current) mirrorInputRef.current.value = "";
  }

  function removeMirrorFile(index) {
    setMirrorFiles((prev) => {
      const item = prev[index];
      if (item?.url) URL.revokeObjectURL(item.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleMirrorDrop(e) {
    e.preventDefault();
    setMirrorDragOver(false);
    addMirrorFiles(e.dataTransfer?.files);
  }

  function handleMirrorFilesPaste(e) {
    if (isEditablePasteTarget(e.target)) return;
    const files = imageFilesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    addMirrorFiles(files);
  }

  useEffect(() => {
    if (createKind !== "mirror") {
      setMirrorDragOver(false);
      setMirrorSliceDragOver(false);
      setMirrorSliceBusy(false);
      mirrorSliceJobRef.current += 1;
    }
  }, [createKind]);

  function clearMirrorSliceSource() {
    mirrorSliceJobRef.current += 1;
    setMirrorSliceSourceSafe(null);
    replaceMirrorSliceFiles([]);
    setMirrorSliceSummary(null);
    setMirrorSliceBusy(false);
    if (mirrorSliceInputRef.current) mirrorSliceInputRef.current.value = "";
  }

  async function handleMirrorSliceFileList(fileList) {
    const incoming = Array.from(fileList || []).filter((file) => (file.type || "").startsWith("image/"));
    if (!incoming.length) return;
    const file = incoming[0];
    if (incoming.length > 1) Toast.info("大图切片一次只需要 1 张图片，已忽略多余文件");
    clearMirrorSliceSource();
    const nextSource = { file, url: URL.createObjectURL(file), name: file.name || "大图" };
    setMirrorSliceSourceSafe(nextSource);
    if (mirrorSliceInputRef.current) mirrorSliceInputRef.current.value = "";
    await rebuildMirrorSlicePreview(file, nextSource.url, mirrorSliceAspect);
  }

  function handleMirrorSliceDrop(e) {
    e.preventDefault();
    setMirrorSliceDragOver(false);
    handleMirrorSliceFileList(e.dataTransfer?.files);
  }

  function handleMirrorSlicePaste(e) {
    if (isEditablePasteTarget(e.target)) return;
    const files = imageFilesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    handleMirrorSliceFileList(files);
  }

  useEffect(() => {
    if (!createOpen || createKind !== "mirror") return undefined;
    const onPaste = (e) => {
      if (e.defaultPrevented || isEditablePasteTarget(e.target)) return;
      const files = imageFilesFromClipboard(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      if (mirrorCreateMode === "slice") {
        handleMirrorSliceFileList(files);
      } else {
        addMirrorFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [createOpen, createKind, mirrorCreateMode, mirrorSliceAspect]);

  async function handleMirrorSliceAspectChange(value) {
    setMirrorSliceAspect(value);
    const source = mirrorSliceSourceRef.current;
    if (!source?.file) return;
    await rebuildMirrorSlicePreview(source.file, source.url, value);
  }

  function handlePreviewKey(e, url) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPreview(url);
    }
  }

  async function handleCopy(tpl) {
    setCopyingId(tpl.id);
    try {
      const json = await api("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tpl.name + " 副本", description: tpl.description, copyFrom: tpl.id }),
      });
      Toast.success("已复制「" + tpl.name + "」");
      await load();
      navigate("/templates/" + json.template.id + "/settings");
    } catch (error) {
      Toast.error(error.message || "复制失败");
    } finally {
      setCopyingId("");
    }
  }

  async function handleDelete(tpl) {
    setDeletingId(tpl.id);
    try {
      await api("/api/templates/" + encodeURIComponent(tpl.id), { method: "DELETE" });
      Toast.success("已删除「" + tpl.name + "」");
      await load();
    } catch (error) {
      Toast.error(error.message || "删除失败");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="page">
      <AppHeader
        title="电商图片工作流"
        subtitle="模板 · SKU 主图与详情图生成台"
        right={
          <Button
            icon={<IconSetting />}
            theme="borderless"
            onClick={() => setSettingsOpen(true)}
          >
            系统设置
          </Button>
        }
      />

      <Dashboard refreshKey={dashRefresh} />

      <SystemSettingsModal
        visible={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onSaved={() => setDashRefresh((k) => k + 1)}
      />

      <div className="hero">
        <Title heading={3} style={{ margin: 0 }}>详情图模板</Title>
        <Paragraph type="tertiary" style={{ marginTop: 6 }}>
          普通模板用节点提示词组织详情图流程；镜像模板可直接多图上传，也可以导入一张大图后按比例横向切成多个复刻节点。
        </Paragraph>
      </div>

      <Card
        className="panel create-card"
        title={
          <div
            className="panel-title"
            style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", width: "100%" }}
            onClick={() => setCreateOpen((v) => !v)}
          >
            <IconPlus /> 新建模板
            <span style={{ flex: 1 }} />
            <Button
              icon={createOpen ? <IconChevronDown /> : <IconChevronRight />}
              theme="borderless"
              onClick={(e) => { e.stopPropagation(); setCreateOpen((v) => !v); }}
              aria-label={createOpen ? "收起" : "展开"}
            >
              {createOpen ? "收起" : "展开"}
            </Button>
          </div>
        }
      >
        <Collapsible isOpen={createOpen} keepDOM>
        <Form
          getFormApi={(a) => (formApi.current = a)}
          onSubmit={handleCreate}
        >
          <Form.Slot label="模板类型">
            <RadioGroup value={createKind} onChange={(e) => setCreateKind(e.target.value)} type="button" buttonSize="middle">
              <Radio value="normal">普通模板</Radio>
              <Radio value="mirror">镜像模板</Radio>
            </RadioGroup>
          </Form.Slot>
          <Form.Input
            field="name"
            label="模板名称"
            placeholder="例如 手表 / 服装 / 数码"
            rules={[{ required: true, message: "请填写模板名称" }]}
          />
          <Form.TextArea
            field="description"
            label="模板说明"
            placeholder="这套模板适用的品类、风格，可留空"
            autosize={{ minRows: 2, maxRows: 4 }}
          />
          {createKind === "mirror" && (
            <>
              <Form.Slot label="创建方式">
                <RadioGroup
                  value={mirrorCreateMode}
                  onChange={(e) => setMirrorCreateMode(e.target.value)}
                  type="button"
                  buttonSize="middle"
                >
                  <Radio value="files">多图上传</Radio>
                  <Radio value="slice">大图切片</Radio>
                </RadioGroup>
              </Form.Slot>
              {mirrorCreateMode === "files" ? (
                <Form.Slot label="镜像参考图">
                  <div
                    className={"mirror-create" + (mirrorDragOver ? " dragover" : "")}
                    tabIndex={0}
                    onDragOver={(e) => { e.preventDefault(); setMirrorDragOver(true); }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMirrorDragOver(false); }}
                    onDrop={handleMirrorDrop}
                    onPaste={handleMirrorFilesPaste}
                  >
                    <div className="mirror-create-grid">
                      {mirrorFiles.map((item, index) => (
                        <div className="mirror-thumb" key={item.url}>
                          <img src={item.url} alt="" />
                          <button type="button" className="mirror-thumb-x" onClick={() => removeMirrorFile(index)}>×</button>
                        </div>
                      ))}
                      <button type="button" className="mirror-upload-trigger" onClick={() => mirrorInputRef.current?.click()}>
                        <IconImage />
                        <Text size="small" type="tertiary">上传参考图</Text>
                      </button>
                    </div>
                    <input
                      ref={mirrorInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => addMirrorFiles(e.target.files)}
                    />
                    <Text type="tertiary" size="small">每张参考图会成为一个镜像节点，顺序按上传顺序。可点击上传、拖拽图片，或直接 Ctrl+V 粘贴图片。</Text>
                  </div>
                </Form.Slot>
              ) : (
                <Form.Slot label="大图切片">
                  <div
                    className={"mirror-slice-panel" + (mirrorSliceDragOver ? " dragover" : "")}
                    tabIndex={0}
                    onDragOver={(e) => { e.preventDefault(); setMirrorSliceDragOver(true); }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMirrorSliceDragOver(false); }}
                    onDrop={handleMirrorSliceDrop}
                    onPaste={handleMirrorSlicePaste}
                  >
                    <div className="mirror-slice-top">
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Select
                          value={mirrorSliceAspect}
                          onChange={handleMirrorSliceAspectChange}
                          optionList={MIRROR_ASPECT_OPTIONS}
                          style={{ width: 140 }}
                        />
                        <Button
                          icon={<IconImage />}
                          theme="light"
                          loading={mirrorSliceBusy}
                          onClick={() => mirrorSliceInputRef.current?.click()}
                        >
                          导入大图
                        </Button>
                        <Button
                          theme="borderless"
                          type="tertiary"
                          disabled={!mirrorSliceSource && !mirrorSliceFiles.length}
                          onClick={clearMirrorSliceSource}
                        >
                          清空切片
                        </Button>
                      </div>
                      <Text type="tertiary" size="small">按所选比例自上而下横向切割，宽度保持不变。也支持 Ctrl+V 粘贴大图。</Text>
                    </div>
                    <input
                      ref={mirrorSliceInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => handleMirrorSliceFileList(e.target.files)}
                    />
                    {mirrorSliceSource ? (
                      <div className="mirror-slice-source">
                        <img
                          src={mirrorSliceSource.url}
                          alt={mirrorSliceSource.name || "源大图"}
                          className="mirror-slice-source-preview"
                          title="点击预览"
                          role="button"
                          tabIndex={0}
                          onClick={() => setPreview(mirrorSliceSource.url)}
                          onKeyDown={(e) => handlePreviewKey(e, mirrorSliceSource.url)}
                        />
                        <div className="mirror-slice-source-meta">
                          <Text strong>源大图：{mirrorSliceSource.name}</Text>
                          <Text type="tertiary" size="small">
                            切片后会生成 {mirrorSliceFiles.length || "?"} 个镜像节点，节点顺序与切片顺序一致。
                          </Text>
                          {mirrorSliceSummary ? (
                            <div className="mirror-slice-summary">
                              <Tag color="blue">切片数 {mirrorSliceSummary.count}</Tag>
                              <Tag color="grey">{mirrorSliceSummary.width} × {mirrorSliceSummary.height}</Tag>
                              <Tag color="grey">单片高 {Math.round(mirrorSliceSummary.targetHeight)} px</Tag>
                              <Text type="quaternary" size="small">{mirrorSliceSummary.note}</Text>
                            </div>
                          ) : (
                            <Text type="tertiary" size="small">请选择大图并等待切片结果。</Text>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Text type="tertiary" size="small">选择 1 张大图后，系统会按当前比例自动切成多个小图。</Text>
                    )}
                    {mirrorSliceFiles.length ? (
                      <div className="mirror-slice-list">
                        {mirrorSliceFiles.map((item, index) => (
                          <div
                            className="mirror-slice-thumb"
                            key={item.url}
                            title="点击预览"
                            role="button"
                            tabIndex={0}
                            onClick={() => setPreview(item.url)}
                            onKeyDown={(e) => handlePreviewKey(e, item.url)}
                          >
                            <img src={item.url} alt={"切片 " + (index + 1)} />
                            <div className="mirror-slice-index">{String(index + 1).padStart(2, "0")}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Form.Slot>
              )}
            </>
          )}
          <Button
            theme="solid"
            type="primary"
            htmlType="submit"
            loading={submitting}
            style={{ marginTop: 8 }}
          >
            {createKind === "mirror" ? "创建镜像模板" : "创建普通模板"}
          </Button>
        </Form>
        </Collapsible>
      </Card>

      <Card
        className="panel"
        title={
          <span className="panel-title">
            <IconLayers /> 模板列表 <Tag color="grey" style={{ marginLeft: 4 }}>{templates.length}</Tag>
          </span>
        }
        headerExtraContent={
          <Button
            icon={<IconRefresh />}
            theme="borderless"
            onClick={load}
            aria-label="刷新"
          />
        }
      >
        {loading ? (
          <div className="center-box"><Spin size="large" /></div>
        ) : templates.length === 0 ? (
          <Empty description="还没有模板，先在上方新建一个吧。" style={{ padding: "40px 0" }} />
        ) : (
          <div className="card-grid">
            {templates.map((t) => (
              <Card key={t.id} className="tpl-card" bodyStyle={{ padding: 16 }}>
                <a className="tpl-link" href={"/templates/" + t.id} onClick={(e) => { e.preventDefault(); navigate("/templates/" + t.id); }}>
                  <div className="tpl-name">
                    <span>{t.name}</span>
                    <IconChevronRight className="tpl-go" />
                  </div>
                  <Paragraph type="tertiary" ellipsis={{ rows: 2 }} className="tpl-notes">
                    {t.description || "无说明"}
                  </Paragraph>
                </a>
                <div className="tpl-meta">
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <Tag color={t.kind === "mirror" ? "violet" : "grey"}>{t.kind === "mirror" ? "镜像模板" : "普通模板"}</Tag>
                    <Tag color="grey">{t.node_count} {t.kind === "mirror" ? "镜像节点" : "节点"} · {t.sku_count} SKU</Tag>
                  </span>
                  <Text type="quaternary" size="small">
                    {new Date(t.updated_at).toLocaleString()}
                  </Text>
                </div>
                <div className="tpl-actions">
                  <Button
                    icon={<IconSetting />}
                    theme="borderless"
                    size="small"
                    onClick={() => navigate("/templates/" + t.id + "/settings")}
                  >
                    模板设置
                  </Button>
                  <Button
                    icon={<IconCopy />}
                    theme="borderless"
                    size="small"
                    loading={copyingId === t.id}
                    onClick={() => handleCopy(t)}
                  >
                    复制
                  </Button>
                  <Popconfirm
                    title="删除模板"
                    content={"确定删除「" + t.name + "」？模板下若还有 SKU 将无法删除。"}
                    okType="danger"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => handleDelete(t)}
                  >
                    <Button
                      icon={<IconDelete />}
                      theme="borderless"
                      type="danger"
                      size="small"
                      loading={deletingId === t.id}
                    />
                  </Popconfirm>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
      {preview ? <Lightbox src={preview} onClose={() => setPreview("")} /> : null}
    </div>
  );
}

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
