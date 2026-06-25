import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Empty,
  Form,
  RadioGroup,
  Radio,
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
  IconLayers,
  IconImage,
} from "@douyinfe/semi-icons";
import { api } from "../api.js";
import AppHeader from "../components/AppHeader.jsx";

const { Title, Paragraph, Text } = Typography;

export default function TemplatesHome() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [copyingId, setCopyingId] = useState("");
  const [createKind, setCreateKind] = useState("normal");
  const [mirrorFiles, setMirrorFiles] = useState([]);
  const [mirrorDragOver, setMirrorDragOver] = useState(false);
  const formApi = useRef(null);
  const mirrorInputRef = useRef(null);
  const mirrorFilesRef = useRef([]);

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

  useEffect(() => () => {
    for (const item of mirrorFilesRef.current) URL.revokeObjectURL(item.url);
  }, []);

  async function handleCreate(values) {
    const name = values.name?.trim();
    if (!name) {
      Toast.warning("请填写模板名称");
      return;
    }
    if (createKind === "mirror" && !mirrorFiles.length) {
      Toast.warning("镜像模板至少需要上传 1 张参考图");
      return;
    }
    setSubmitting(true);
    try {
      let json;
      if (createKind === "mirror") {
        const form = new FormData();
        form.append("name", name);
        form.append("description", values.description || "");
        for (const item of mirrorFiles) form.append("file", item.file);
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
      />

      <div className="hero">
        <Title heading={3} style={{ margin: 0 }}>详情图模板</Title>
        <Paragraph type="tertiary" style={{ marginTop: 6 }}>
          普通模板用节点提示词组织详情图流程；镜像模板用参考图自动形成复刻节点。
        </Paragraph>
      </div>

      <Card className="panel" title={<span className="panel-title"><IconPlus /> 新建模板</span>}>
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
            <Form.Slot label="镜像参考图">
              <div
                className={"mirror-create" + (mirrorDragOver ? " dragover" : "")}
                onDragOver={(e) => { e.preventDefault(); setMirrorDragOver(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMirrorDragOver(false); }}
                onDrop={handleMirrorDrop}
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
                <Text type="tertiary" size="small">每张参考图会成为一个镜像节点，顺序按上传顺序。可点击上传，也可把图片拖到这里。</Text>
              </div>
            </Form.Slot>
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
    </div>
  );
}
