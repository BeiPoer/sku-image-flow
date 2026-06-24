import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  Card,
  Collapse,
  Empty,
  Image,
  ImagePreview,
  InputNumber,
  Select,
  Spin,
  Tag,
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
  IconPlus,
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
  const [batchRunning, setBatchRunning] = useState(false);
  const [retry, setRetry] = useState({}); // nodeKey -> { hint, files: File[] }
  const [count, setCount] = useState(4);
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

  if (loading || !data) {
    return (
      <div className="page wb-page">
        <AppHeader title="SKU 工作台" backTo="/" />
        <div className="center-box"><Spin size="large" /></div>
      </div>
    );
  }

  const { sku, template, assets, candidates, nodes } = data;
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
        for (const f of r.files) form.append("file", f);
        options = { method: "POST", body: form };
      } else {
        options = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeKey: node.key, count, retryHint: r.hint || "" }),
        };
      }
      await api("/api/skus/" + skuId + "/generate", options);
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
            <ImagePreview>
              {sourceAssets.map((a) => (
                <Image key={a.id} src={a.url} width={92} height={92} className="wb-thumb" />
              ))}
            </ImagePreview>
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
            {analysis ? (
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
                  {busyNodes[n.key] ? <Spin size="small" /> : <NodeStatusIcon kind={st.kind} />}
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
              busy={Boolean(busyNodes[node.key])}
              state={nodeState(node)}
              candidates={candByNode[node.key] || []}
              count={count}
              onCountChange={saveCount}
              onAspect={(a) => setAspect(node, a)}
              onGenerate={() => generate(node)}
              onSelect={(cid) => selectCandidate(node, cid)}
              retry={retry[node.key] || { hint: "", files: [] }}
              setRetry={(patch) => setRetry((s) => ({ ...s, [node.key]: { ...(s[node.key] || { hint: "", files: [] }), ...patch } }))}
            />
          ) : (
            <Empty description="该模板还没有节点，去节点设置里添加。" />
          )}
        </div>
      </div>
    </div>
  );
}

function NodeStatusIcon({ kind }) {
  if (kind === "selected") return <IconTick style={{ color: "var(--semi-color-success)" }} />;
  if (kind === "locked") return <IconLock style={{ color: "var(--semi-color-text-3)" }} />;
  if (kind === "has-candidates") return <Tag size="small" color="amber">候选</Tag>;
  return <span style={{ width: 14, height: 14, borderRadius: "50%", border: "1px dashed var(--semi-color-border)" }} />;
}

function NodeStage({ node, busy, state, candidates, count, onCountChange, onAspect, onGenerate, onSelect, retry, setRetry }) {
  const retryFileRef = useRef(null);
  const selected = candidates.find((c) => c.selected);
  const locked = state.kind === "locked";

  function addRetryFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length) setRetry({ files: [...(retry.files || []), ...files].slice(0, 5) });
    if (retryFileRef.current) retryFileRef.current.value = "";
  }
  function removeRetryFile(idx) {
    setRetry({ files: retry.files.filter((_, i) => i !== idx) });
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
            <Button icon={<IconBolt />} theme="solid" type="primary" loading={busy} disabled={locked} onClick={onGenerate}>
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
          <Image src={selected.url} width={220} className="wb-selected-img" />
        </div>
      )}

      {candidates.length > 0 ? (
        <>
          <Text type="tertiary" size="small" style={{ display: "block", marginBottom: 8 }}>
            候选图（{candidates.length}）· 点图放大，点「选为最终图」定稿
          </Text>
          <ImagePreview>
            <div className="wb-candidates">
              {candidates.map((c) => (
                <div key={c.id} className={"wb-cand" + (c.selected ? " selected" : "")}>
                  <Image src={c.url} width="100%" height={180} className="wb-cand-img" />
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
          </ImagePreview>
        </>
      ) : (
        !locked && <Empty image={<IconImage size="extra-large" />} description="还没有候选图，点右上「生成候选」。" style={{ padding: "24px 0" }} />
      )}

      {/* 重跑：修正提示词 + 临时参考图 */}
      <div className="wb-retry">
        <Collapse keepDOM>
          <Collapse.Panel header={<Text type="tertiary" size="small">重跑修正（可选：补充提示词 / 上传修正参考图）</Text>} itemKey="retry">
            <div className="wb-retry-box">
              {retry.files && retry.files.length > 0 && (
                <div className="wb-retry-thumbs">
                  {retry.files.map((f, i) => (
                    <div className="wb-retry-thumb" key={i}>
                      <img src={URL.createObjectURL(f)} alt="" />
                      <button className="wb-retry-thumb-x" onClick={() => removeRetryFile(i)} aria-label="移除"><IconClose size="small" /></button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                className="wb-retry-input"
                rows={2}
                placeholder="本次重跑想强调/修正的重点，仅本次生成生效"
                value={retry.hint || ""}
                onChange={(e) => setRetry({ hint: e.target.value })}
              />
              <div className="wb-retry-actions">
                <Button icon={<IconPlus />} size="small" theme="borderless" onClick={() => retryFileRef.current?.click()}>
                  添加参考图
                </Button>
                <input ref={retryFileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addRetryFiles(e.target.files)} />
                <Button icon={<IconRefresh />} size="small" theme="solid" type="primary" loading={busy} disabled={locked} onClick={onGenerate}>
                  按修正重跑
                </Button>
              </div>
            </div>
          </Collapse.Panel>
        </Collapse>
      </div>

      {/* 生图提示词预览 */}
      {Array.isArray(node.promptSegments) && (
        <div style={{ marginTop: 16 }}>
          <Collapse>
            <Collapse.Panel header={<Text type="tertiary" size="small">生图提示词预览</Text>} itemKey="prompt">
              <div className="wb-prompt">
                {node.promptSegments
                  .filter((seg) => seg.present && seg.text)
                  .map((seg, i) => (
                    <div key={i}>
                      <div className="wb-prompt-seg-head">
                        <Text strong size="small">{seg.label}</Text>
                        {seg.editable && <Tag size="small" color="blue">可在设置里改</Tag>}
                      </div>
                      <pre className="wb-prompt-text">{seg.text}</pre>
                    </div>
                  ))}
              </div>
            </Collapse.Panel>
          </Collapse>
        </div>
      )}
    </Card>
  );
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
