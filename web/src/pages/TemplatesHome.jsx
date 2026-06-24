import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Empty,
  Form,
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
  const formApi = useRef(null);

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

  async function handleCreate(values) {
    // 固定空白创建（后端会预置一个主图首节点）
    const payload = { name: values.name, description: values.description };
    setSubmitting(true);
    try {
      const json = await api("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // 新建后进入节点设置页，先配置节点流程
      navigate("/templates/" + json.template.id + "/settings");
    } catch (error) {
      Toast.error(error.message || "创建失败");
      setSubmitting(false);
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

  const modeOptions = [
    { value: "watch", label: "内置「手表」预设（12 个节点）" },
    { value: "blank", label: "从空白创建" },
    ...templates.map((t) => ({ value: "copy:" + t.id, label: "复制：" + t.name })),
  ];

  return (
    <div className="page">
      <AppHeader
        title="电商图片工作流"
        subtitle="模板 · SKU 主图与详情图生成台"
      />

      <div className="hero">
        <Title heading={3} style={{ margin: 0 }}>详情图模板</Title>
        <Paragraph type="tertiary" style={{ marginTop: 6 }}>
          每个模板是一套详情图节点流程，模板下可以创建多个 SKU。先建模板，再进入模板里建 SKU。
        </Paragraph>
      </div>

      <Card className="panel" title={<span className="panel-title"><IconPlus /> 新建模板</span>}>
        <Form
          getFormApi={(a) => (formApi.current = a)}
          onSubmit={handleCreate}
        >
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
          <Button
            theme="solid"
            type="primary"
            htmlType="submit"
            loading={submitting}
            style={{ marginTop: 8 }}
          >
            创建模板
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
                  <Tag color="grey">{t.node_count} 节点 · {t.sku_count} SKU</Tag>
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
                    节点设置
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
