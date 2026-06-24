import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Select,
  Spin,
  Tag,
  TextArea,
  Toast,
  Tooltip,
  Typography,
} from "@douyinfe/semi-ui";
import {
  IconUpload,
  IconRefresh,
  IconBolt,
  IconDownload,
  IconTick,
  IconLock,
  IconImage,
  IconStar,
  IconClose,
} from "@douyinfe/semi-icons";
import { api } from "../api.js";
import AppHeader from "../components/AppHeader.jsx";

const { Title, Paragraph, Text } = Typography;

const ASPECT_OPTIONS = ["1:1", "3:4", "4:3", "16:9", "9:16"].map((v) => ({ value: v, label: v }));

export default function SkuWorkbench() {
  const { skuId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeNode, setActiveNode] = useState("");
  const [busyNodes, setBusyNodes] = useState({}); // nodeKey -> true
  const [analyzing, setAnalyzing] = useState(false);
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [analysisDraft, setAnalysisDraft] = useState(null);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [retry, setRetry] = useState({}); // nodeKey -> { hint, files: File[] }
  const [count, setCount] = useState(4);
  const [preview, setPreview] = useState(""); // 放大预览的图片 src，空串=关闭
  const sourceInputRef = useRef(null);

  const load = useCallback(async () => {
    const json = await api("/api/skus/" + encodeURIComponent(skuId));
    setData(json);
    setCount(json.sku.candidate_count || json.defaults?.candidateCount || 4);
    setActiveNode((prev) => prev || (json.nodes[0] && json.nodes[0].key) || "");
    return json;
  }, [skuId]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => Toast.error(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [load]);

  // 后端正在生图的节点（status=running 且未超时）。刷新后据此恢复 loading。
  // 超过 10 分钟的 running 视为僵尸任务（进程崩溃残留），不再算进行中。
  const RUNNING_TTL = 10 * 60 * 1000;
  const serverBusy = {};
  if (data && Array.isArray(data.tasks)) {
    const nowMs = Date.now();
    for (const t of data.tasks) {
      if (t.status === "running" && nowMs - new Date(t.created_at).getTime() < RUNNING_TTL) {
        serverBusy[t.node_key] = true;
      }
    }
  }
  const hasRunning = Object.keys(serverBusy).length > 0;
  // 节点是否在生图：本次点击发起的（本地） 或 后端 running（刷新恢复）
  const isBusy = (key) => Boolean(busyNodes[key] || serverBusy[key]);

  // 有进行中任务时自动轮询，后台跑完即自动拉到新候选图并解除 loading。
  useEffect(() => {
    if (!hasRunning) return undefined;
    const timer = setInterval(() => {
      load().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [hasRunning, load]);

  if (loading || !data) {
    return (
      <div className="page wb-page">
        <AppHeader title="SKU 工作台" backTo="/" />
        <div className="center-box"><Spin size="large" /></div>
      </div>
    );
  }

  const { sku, template, assets, candidates, nodes } = data;
  // 模板级短语（重跑快填用）
  let phrases = [];
  if (template && template.phrases) {
    try {
      const list = JSON.parse(template.phrases);
      if (Array.isArray(list)) phrases = list.map((s) => String(s)).filter(Boolean);
    } catch { /* 忽略损坏的 JSON */ }
  }
  const sourceAssets = assets.filter((a) => a.role !== "retry" && a.source_type === "upload");
  const analysis = sku.analysis_json ? safeParse(sku.analysis_json) : null;
  const selectedCount = candidates.filter((c) => c.selected).length;
  const mainNode = nodes.find((n) => n.isMain);
  const hasSelectedMain = Boolean(sku.selected_main_asset_id);

  // 候选图按节点分组
  const candByNode = {};
  for (const c of candidates) {
    (candByNode[c.node_key] = candByNode[c.node_key] || []).push(c);
  }

  function nodeState(node) {
    const list = candByNode[node.key] || [];
    const selected = list.find((c) => c.selected);
    if (selected) return { kind: "selected" };
    if (node.usesSelectedMain && !hasSelectedMain) return { kind: "locked" };
    if (list.length) return { kind: "has-candidates" };
    return { kind: "empty" };
  }

  async function uploadSource(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const form = new FormData();
    form.append("role", "source");
    for (const f of files) form.append("file", f);
    try {
      await api("/api/skus/" + skuId + "/upload", { method: "POST", body: form });
      Toast.success("已上传 " + files.length + " 张产品图");
      await load();
    } catch (e) {
      Toast.error(e.message || "上传失败");
    }
    if (sourceInputRef.current) sourceInputRef.current.value = "";
  }

  async function analyze() {
    setAnalyzing(true);
    try {
      await api("/api/skus/" + skuId + "/analyze", { method: "POST" });
      Toast.success("产品分析完成");
      await load();
    } catch (e) {
      Toast.error(e.message || "分析失败");
    } finally {
      setAnalyzing(false);
    }
  }

  // 进入分析编辑态：把现有分析填进草稿（数组转成顿号分隔的字符串便于编辑）
  function startEditAnalysis(a) {
    setAnalysisDraft({
      category: a?.category || "",
      style: a?.style || "",
      material: a?.material || "",
      colors: Array.isArray(a?.colors) ? a.colors.join("、") : "",
      sellingPoints: Array.isArray(a?.sellingPoints) ? a.sellingPoints.join("、") : "",
    });
    setEditingAnalysis(true);
  }

  function splitList(text) {
    return String(text || "")
      .split(/[、,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function saveAnalysis() {
    const d = analysisDraft || {};
    const payload = {
      category: d.category.trim(),
      style: d.style.trim(),
      material: d.material.trim(),
      colors: splitList(d.colors),
      sellingPoints: splitList(d.sellingPoints),
    };
    setSavingAnalysis(true);
    try {
      await api("/api/skus/" + skuId + "/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: payload }),
      });
      Toast.success("产品分析已保存");
      setEditingAnalysis(false);
      setAnalysisDraft(null);
      await load();
    } catch (e) {
      Toast.error(e.message || "保存失败");
    } finally {
      setSavingAnalysis(false);
    }
  }

  async function setAspect(node, aspect) {
    try {
      await api("/api/skus/" + skuId + "/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeKey: node.key, aspect }),
      });
      await load();
    } catch (e) {
      Toast.error(e.message || "保存比例失败");
    }
  }

  async function saveCount(value) {
    setCount(value);
    try {
      await api("/api/skus/" + skuId + "/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: value }),
      });
    } catch (e) {
      Toast.error(e.message || "保存张数失败");
    }
  }

  // 生成单个节点（支持重跑：提示词修正 + 临时参考图）
  async function generate(node) {
    if (node.usesSelectedMain && !hasSelectedMain) {
      Toast.warning("请先在主图节点选定一张主图");
      return;
    }
    if (!sourceAssets.length) {
      Toast.warning("请先上传产品图");
      return;
    }
    const r = retry[node.key] || {};
    setBusyNodes((s) => ({ ...s, [node.key]: true }));
    try {
      let options;
      if (r.files && r.files.length) {
        const form = new FormData();
        form.append("nodeKey", node.key);
        form.append("count", String(count));
        if (r.hint) form.append("retryHint", r.hint);
        for (const f of r.files) form.append("file", f.file);
        options = { method: "POST", body: form };
      } else {
        options = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeKey: node.key, count, retryHint: r.hint || "" }),
        };
      }
      await api("/api/skus/" + skuId + "/generate", options);
      // 提交成功，回收本次重跑图片的临时 URL 并清空
      for (const f of r.files || []) if (f.url) URL.revokeObjectURL(f.url);
      setRetry((s) => ({ ...s, [node.key]: { hint: "", files: [] } }));
      await load();
      Toast.success(node.label + "：已生成候选");
    } catch (e) {
      Toast.error(node.label + "：" + (e.message || "生成失败"));
    } finally {
      setBusyNodes((s) => {
        const next = { ...s };
        delete next[node.key];
        return next;
      });
    }
  }

  async function selectCandidate(node, candidateId) {
    try {
      await api("/api/skus/" + skuId + "/candidates/" + candidateId + "/select", { method: "POST" });
      await load();
      Toast.success(node.label + "：已选定");
    } catch (e) {
      Toast.error(e.message || "选定失败");
    }
  }

  // 一键生成：先主图；主图已选则跑所有依赖节点
  async function runAll() {
    if (!sourceAssets.length) {
      Toast.warning("请先上传产品图");
      return;
    }
    setBatchRunning(true);
    try {
      let targets;
      if (mainNode && !hasSelectedMain) {
        targets = [mainNode];
      } else {
        targets = nodes.filter((n) => !n.isMain);
      }
      let ok = 0;
      for (const node of targets) {
        if (node.usesSelectedMain && !hasSelectedMain) continue;
        setBusyNodes((s) => ({ ...s, [node.key]: true }));
        try {
          await api("/api/skus/" + skuId + "/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nodeKey: node.key, count }),
          });
          ok += 1;
        } catch (e) {
          Toast.error(node.label + "：" + (e.message || "失败"));
        } finally {
          setBusyNodes((s) => {
            const next = { ...s };
            delete next[node.key];
            return next;
          });
        }
      }
      await load();
      if (mainNode && !hasSelectedMain) {
        setActiveNode(mainNode.key);
        Toast.success("主图候选已生成，选定主图后再次点「一键生成」自动跑完详情节点。");
      } else {
        Toast.success("已生成 " + ok + "/" + targets.length + " 个节点。");
      }
    } finally {
      setBatchRunning(false);
    }
  }

  function download() {
    if (!selectedCount) {
      Toast.warning("还没有选定任何最终图");
      return;
    }
    window.location.href = "/api/skus/" + skuId + "/export";
  }

  const node = nodes.find((n) => n.key === activeNode) || nodes[0];

  return (
    <div className="page wb-page">
      <AppHeader
        title={sku.name}
        subtitle={template ? template.name + " · 工作台" : "工作台"}
        backTo={template ? "/templates/" + template.id : "/"}
        right={
          <span style={{ display: "inline-flex", gap: 8 }}>
            <Button icon={<IconBolt />} theme="solid" type="primary" loading={batchRunning} onClick={runAll}>
              一键生成
            </Button>
            <Button icon={<IconDownload />} theme="light" disabled={!selectedCount} onClick={download}>
              下载 zip（{selectedCount}）
            </Button>
          </span>
        }
      />

      {/* 产品图 + 分析 */}
      <Card className="panel" title={<span className="panel-title"><IconImage /> 产品图与分析</span>}>
        <div className="wb-product">
          <div className="wb-thumbs">
            {sourceAssets.map((a) => (
              <img key={a.id} src={a.url} className="wb-thumb" alt="" onClick={() => setPreview(a.url)} />
            ))}
            <button className="wb-upload-trigger" onClick={() => sourceInputRef.current?.click()}>
              <IconUpload />
              <Text size="small" type="tertiary">上传产品图</Text>
            </button>
            <input
              ref={sourceInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => uploadSource(e.target.files)}
            />
          </div>

          <div className="wb-analysis">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text strong>产品分析</Text>
              {!editingAnalysis && (
                <div style={{ display: "inline-flex", gap: 8 }}>
                  {analysis && (
                    <Button size="small" theme="borderless" onClick={() => startEditAnalysis(analysis)}>
                      编辑
                    </Button>
                  )}
                  <Button
                    icon={<IconRefresh />}
                    size="small"
                    theme="light"
                    loading={analyzing}
                    disabled={!sourceAssets.length}
                    onClick={analyze}
                  >
                    {analysis ? "重新分析" : "分析产品"}
                  </Button>
                </div>
              )}
            </div>

            {editingAnalysis ? (
              <div className="wb-analysis-edit">
                <label>品类</label>
                <Input value={analysisDraft.category} onChange={(v) => setAnalysisDraft((s) => ({ ...s, category: v }))} placeholder="产品品类" />
                <label>风格</label>
                <Input value={analysisDraft.style} onChange={(v) => setAnalysisDraft((s) => ({ ...s, style: v }))} placeholder="产品风格" />
                <label>材质</label>
                <Input value={analysisDraft.material} onChange={(v) => setAnalysisDraft((s) => ({ ...s, material: v }))} placeholder="材质信息" />
                <label>颜色（顿号 / 逗号 / 换行分隔多个）</label>
                <TextArea value={analysisDraft.colors} onChange={(v) => setAnalysisDraft((s) => ({ ...s, colors: v }))} autosize={{ minRows: 1, maxRows: 3 }} placeholder="如：黑、银、玫瑰金" />
                <label>核心卖点（顿号 / 逗号 / 换行分隔多个）</label>
                <TextArea value={analysisDraft.sellingPoints} onChange={(v) => setAnalysisDraft((s) => ({ ...s, sellingPoints: v }))} autosize={{ minRows: 2, maxRows: 5 }} placeholder="如：防水、夜光、蓝宝石镜面" />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Button theme="solid" type="primary" size="small" loading={savingAnalysis} onClick={saveAnalysis}>保存</Button>
                  <Button theme="borderless" size="small" onClick={() => { setEditingAnalysis(false); setAnalysisDraft(null); }}>取消</Button>
                </div>
              </div>
            ) : analysis ? (
              <div className="wb-analysis-body">
                {analysis.category && <span><b>品类：</b>{analysis.category}</span>}
                {analysis.style && <span><b>风格：</b>{analysis.style}</span>}
                {analysis.material && <span><b>材质：</b>{analysis.material}</span>}
                {Array.isArray(analysis.colors) && analysis.colors.length > 0 && (
                  <span><b>颜色：</b>{analysis.colors.join("、")}</span>
                )}
                {Array.isArray(analysis.sellingPoints) && analysis.sellingPoints.length > 0 && (
                  <span><b>卖点：</b>{analysis.sellingPoints.join("、")}</span>
                )}
              </div>
            ) : (
              <Text type="tertiary" size="small">
                {sourceAssets.length ? "点「分析产品」让视觉模型提炼品类、材质、卖点，会参与生图提示词。" : "先上传产品图，再分析。"}
              </Text>
            )}
          </div>
        </div>
      </Card>

      {/* 节点导航 + 工作区 */}
      <div className="wb-main">
        <nav className="wb-nav">
          {nodes.map((n) => {
            const st = nodeState(n);
            return (
              <button
                key={n.key}
                className={"wb-nav-item" + (n.key === activeNode ? " active" : "")}
                onClick={() => setActiveNode(n.key)}
              >
                <span className="wb-nav-label">
                  {n.isMain && <IconStar size="small" style={{ color: "var(--semi-color-warning)" }} />}
                  {n.label}
                </span>
                <span className="wb-nav-status">
                  {isBusy(n.key) ? <Spin size="small" /> : <NodeStatusIcon kind={st.kind} />}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="wb-stage">
          {node ? (
            <NodeStage
              key={node.key}
              node={node}
              busy={isBusy(node.key)}
              state={nodeState(node)}
              candidates={candByNode[node.key] || []}
              count={count}
              onCountChange={saveCount}
              onAspect={(a) => setAspect(node, a)}
              onGenerate={() => generate(node)}
              onSelect={(cid) => selectCandidate(node, cid)}
              onPreview={setPreview}
              phrases={phrases}
              retry={retry[node.key] || { hint: "", files: [] }}
              setRetry={(patch) => setRetry((s) => ({ ...s, [node.key]: { ...(s[node.key] || { hint: "", files: [] }), ...patch } }))}
            />
          ) : (
            <Empty description="该模板还没有节点，去模板设置里添加。" />
          )}
        </div>
      </div>

      {preview ? <Lightbox src={preview} onClose={() => setPreview("")} /> : null}
    </div>
  );
}

// 自建放大预览层：全屏遮罩 + 居中大图，点遮罩或按 Esc 关闭。
// 不用 Semi 的 Image 预览，避免 group/isInGroup 等隐藏逻辑导致点击不弹。
function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
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

function NodeStatusIcon({ kind }) {
  if (kind === "selected") return <IconTick style={{ color: "var(--semi-color-success)" }} />;
  if (kind === "locked") return <IconLock style={{ color: "var(--semi-color-text-3)" }} />;
  if (kind === "has-candidates") return <Tag size="small" color="amber">候选</Tag>;
  return <span style={{ width: 14, height: 14, borderRadius: "50%", border: "1px dashed var(--semi-color-border)" }} />;
}

function NodeStage({ node, busy, state, candidates, count, onCountChange, onAspect, onGenerate, onSelect, onPreview, phrases, retry, setRetry }) {
  const [dragOver, setDragOver] = useState(false);
  const selected = candidates.find((c) => c.selected);
  const locked = state.kind === "locked";
  const MAX_RETRY = 5;

  // 粘贴 / 拖拽进来的图片：存 { file, url }，url 创建一次，移除时回收，避免重复 createObjectURL
  function addRetryImages(fileList) {
    const incoming = Array.from(fileList || []).filter((f) => (f.type || "").startsWith("image/"));
    if (!incoming.length) return;
    const cur = retry.files || [];
    const room = MAX_RETRY - cur.length;
    if (room <= 0) {
      Toast.info("每次重跑最多 " + MAX_RETRY + " 张参考图");
      return;
    }
    const accepted = incoming.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (incoming.length > room) Toast.info("最多 " + MAX_RETRY + " 张，多余的已忽略");
    setRetry({ files: [...cur, ...accepted] });
  }
  function removeRetryImage(idx) {
    const cur = retry.files || [];
    const removed = cur[idx];
    if (removed && removed.url) URL.revokeObjectURL(removed.url);
    setRetry({ files: cur.filter((_, i) => i !== idx) });
  }
  function onRetryPaste(e) {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const item of items) {
      if (item.kind === "file" && (item.type || "").startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      e.preventDefault();
      addRetryImages(files);
    }
  }

  return (
    <Card
      className="wb-node-card"
      title={
        <div className="wb-node-head">
          <span className="panel-title">
            {node.isMain && <IconStar style={{ color: "var(--semi-color-warning)" }} />}
            {node.label}
            {node.usesSelectedMain && <Tag size="small" color="blue">依赖主图</Tag>}
          </span>
          <span className="wb-node-ops">
            <Tooltip content="该节点图片比例">
              <Select value={node.aspect} onChange={onAspect} optionList={ASPECT_OPTIONS} size="small" style={{ width: 92 }} />
            </Tooltip>
            <Tooltip content="本次每个节点生成的候选张数（SKU 级）">
              <InputNumber min={1} max={8} value={count} onChange={onCountChange} style={{ width: 110 }} suffix="张" />
            </Tooltip>
            <Button icon={<IconBolt />} theme="solid" type="primary" loading={busy} disabled={locked || busy} onClick={onGenerate}>
              生成候选
            </Button>
          </span>
        </div>
      }
    >
      {node.description && <Paragraph type="tertiary" style={{ marginTop: -4, marginBottom: 12 }}>{node.description}</Paragraph>}

      {locked && (
        <div style={{ marginBottom: 16 }}>
          <Tag color="orange" prefixIcon={<IconLock />}>需先在主图节点选定一张主图，才能生成该节点</Tag>
        </div>
      )}

      {selected && (
        <div className="wb-selected" style={{ marginBottom: 16 }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            <IconTick style={{ color: "var(--semi-color-success)" }} /> 已选定最终图
          </Text>
          <img src={selected.url} className="wb-selected-img" alt="" onClick={() => onPreview(selected.url)} />
        </div>
      )}

      {/* 重跑与提示词放在候选图之前：候选图可能很多，避免每次往下滚 */}
      {/* 重跑：修正提示词 + 临时参考图（粘贴 / 拖拽） */}
      <div className="wb-retry">
        <Collapse keepDOM defaultActiveKey="retry">
          <Collapse.Panel header={<Text type="tertiary" size="small">重跑修正（可选：补充提示词 / 粘贴或拖拽参考图）</Text>} itemKey="retry">
            <div
              className={"wb-retry-box" + (dragOver ? " dragover" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addRetryImages(e.dataTransfer?.files); }}
            >
              {retry.files && retry.files.length > 0 && (
                <div className="wb-retry-thumbs">
                  {retry.files.map((f, i) => (
                    <div className="wb-retry-thumb" key={i}>
                      <img src={f.url} alt="" onClick={() => onPreview(f.url)} />
                      <button className="wb-retry-thumb-x" onClick={() => removeRetryImage(i)} aria-label="移除"><IconClose size="small" /></button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                className="wb-retry-input"
                rows={2}
                placeholder="本次重跑想强调/修正的重点，仅本次生效；可直接粘贴(Ctrl+V)或拖拽图片到此处，最多 5 张"
                value={retry.hint || ""}
                onChange={(e) => setRetry({ hint: e.target.value })}
                onPaste={onRetryPaste}
              />
              <div className="wb-retry-actions">
                <Button icon={<IconRefresh />} size="small" theme="solid" type="primary" loading={busy} disabled={locked || busy} onClick={onGenerate}>
                  按修正重跑
                </Button>
              </div>
            </div>
            {phrases && phrases.length > 0 && (
              <div className="wb-phrases">
                {phrases.map((p, i) => (
                  <button
                    type="button"
                    key={i}
                    className="wb-phrase"
                    title={p}
                    onClick={() => {
                      const cur = (retry.hint || "").trim();
                      setRetry({ hint: cur ? cur + "，" + p : p });
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </Collapse.Panel>
        </Collapse>
      </div>

      {/* 生图提示词预览：整篇文章，按来源用底色分块，hover 看「如何修改」 */}
      {Array.isArray(node.promptSegments) && (
        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <Collapse>
            <Collapse.Panel header={<Text type="tertiary" size="small">查看生图提示词（只读）</Text>} itemKey="prompt">
              <PromptArticle segments={node.promptSegments} />
            </Collapse.Panel>
          </Collapse>
        </div>
      )}

      {candidates.length > 0 ? (
        <>
          <Text type="tertiary" size="small" style={{ display: "block", marginBottom: 8 }}>
            候选图（{candidates.length}）· 点图放大，点「选为最终图」定稿
          </Text>
          <div className="wb-candidates">
            {candidates.map((c) => (
              <div key={c.id} className={"wb-cand" + (c.selected ? " selected" : "")}>
                <img src={c.url} className="wb-cand-img" alt="" onClick={() => onPreview(c.url)} />
                <div className="wb-cand-bar">
                  {c.selected ? (
                    <Tag color="green" prefixIcon={<IconTick />}>最终图</Tag>
                  ) : (
                    <Button size="small" theme="light" onClick={() => onSelect(c.id)}>选为最终图</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        !locked && <Empty image={<IconImage size="extra-large" />} description="还没有候选图，点右上「生成候选」。" style={{ padding: "24px 0" }} />
      )}
    </Card>
  );
}

// 生图提示词预览：把最终拼接的提示词当作一整篇文章，按真实顺序用换行连接，
// 每段来源用底色高亮区分，hover 显示「如何修改」。内容只读。
function PromptArticle({ segments }) {
  const used = (segments || []).filter((s) => s.present && s.text);
  const absent = (segments || []).filter((s) => !(s.present && s.text));
  return (
    <div className="pp">
      <p className="pp-note">
        下面是该节点最终发给生图接口的完整提示词。不同颜色代表不同来源，鼠标悬停任意高亮段可看「如何修改」。内容在此只读。
      </p>
      <div className="pp-article">
        {used.map((s, i) => (
          <span key={i}>
            <span
              className={"pp-seg pp-seg-" + s.kind + (s.editable ? " pp-rw" : " pp-ro")}
              data-tip={(s.editable ? "可改 · " : "只读 · ") + s.label + "：" + (s.hint || "")}
              tabIndex={0}
            >
              {s.text}
            </span>
            {i < used.length - 1 ? "\n" : null}
          </span>
        ))}
      </div>
      {absent.length > 0 && (
        <p className="pp-absent">未参与本次拼接：{absent.map((s) => s.label).join("、")}</p>
      )}
    </div>
  );
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
