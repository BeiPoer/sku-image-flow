import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  IconChevronRight,
  IconImage,
} from "@douyinfe/semi-icons";
import { api } from "../api.js";
import AppHeader from "../components/AppHeader.jsx";

const { Title, Paragraph, Text } = Typography;

// SKU 状态 → 展示文案与配色
const STATUS_META = {
  draft: { label: "草稿", color: "grey" },
  uploaded: { label: "已上传", color: "blue" },
  analyzed: { label: "已分析（历史）", color: "grey" },
  main_generated: { label: "主图候选已出", color: "amber" },
  main_selected: { label: "主图已定", color: "violet" },
  details_generated: { label: "详情图生成中", color: "teal" },
};

function statusTag(status) {
  const meta = STATUS_META[status] || { label: status || "未知", color: "grey" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export default function TemplateSkus() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const formApi = useRef(null);
  const isMirror = template?.kind === "mirror";

  async function load() {
    setLoading(true);
    try {
      const [tpl, list] = await Promise.all([
        api("/api/templates/" + encodeURIComponent(templateId)),
        api("/api/templates/" + encodeURIComponent(templateId) + "/skus"),
      ]);
      setTemplate(tpl.template);
      setNodeCount((tpl.nodes || []).length);
      setSkus(list.skus || []);
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

  async function handleCreate(values) {
    setSubmitting(true);
    try {
      const json = await api("/api/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          notes: values.notes || "",
          templateId,
        }),
      });
      // 直接进工作台，上传产品图 / 生成都在工作台进行
      navigate("/skus/" + json.sku.id);
    } catch (error) {
      Toast.error(error.message || "创建失败");
      setSubmitting(false);
    }
  }

  async function handleDelete(sku) {
    setDeletingId(sku.id);
    try {
      await api("/api/skus/" + encodeURIComponent(sku.id), { method: "DELETE" });
      Toast.success("已删除「" + sku.name + "」");
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
        title={template ? template.name : "模板"}
        subtitle={isMirror ? "SKU 列表 · 镜像复刻图生成台" : "SKU 列表 · 主图与详情图生成台"}
        backTo="/"
        right={
          <Button
            icon={<IconSetting />}
            theme="borderless"
            onClick={() => navigate("/templates/" + templateId + "/settings")}
          >
            模板设置
          </Button>
        }
      />

      <div className="hero">
        <Title heading={3} style={{ margin: 0 }}>{template ? template.name : "加载中…"}</Title>
        <Paragraph type="tertiary" style={{ marginTop: 6 }}>
          {template?.description || (isMirror ? "这套镜像模板的 SKU 会复用同一组参考图节点。" : "这套模板的 SKU 都复用同一组详情图节点流程。")}
        </Paragraph>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <Tag color={isMirror ? "violet" : "grey"}>{isMirror ? "镜像模板" : "普通模板"}</Tag>
          <Tag color="grey">{nodeCount} 个{isMirror ? "镜像节点" : "节点"}</Tag>
        </div>
      </div>

      <Card className="panel" title={<span className="panel-title"><IconPlus /> 新建 SKU</span>}>
        <Form
          getFormApi={(a) => (formApi.current = a)}
          onSubmit={handleCreate}
        >
          <Form.Input
            field="name"
            label="SKU 名称"
            placeholder="例如 SKU123 / 某某型号"
            rules={[{ required: true, message: "请填写 SKU 名称" }]}
          />
          <Form.TextArea
            field="notes"
            label={isMirror ? "SKU 全局提示词" : "补充备注"}
            placeholder={isMirror ? "会参与该 SKU 下所有镜像节点生成，可留空" : "产品的零散信息，会参与生图提示词拼接，可留空"}
            autosize={{ minRows: 2, maxRows: 4 }}
          />
          <Button
            theme="solid"
            type="primary"
            htmlType="submit"
            loading={submitting}
            style={{ marginTop: 8 }}
          >
            创建并进入工作台
          </Button>
        </Form>
      </Card>

      <Card
        className="panel"
        title={
          <span className="panel-title">
            <IconImage /> SKU 列表 <Tag color="grey" style={{ marginLeft: 4 }}>{skus.length}</Tag>
          </span>
        }
        headerExtraContent={
          <Button icon={<IconRefresh />} theme="borderless" onClick={load} aria-label="刷新" />
        }
      >
        {loading ? (
          <div className="center-box"><Spin size="large" /></div>
        ) : skus.length === 0 ? (
          <Empty description="还没有 SKU，先在上方新建一个吧。" style={{ padding: "40px 0" }} />
        ) : (
          <div className="card-grid">
            {skus.map((s) => (
              <Card key={s.id} className="tpl-card" bodyStyle={{ padding: 0 }}>
                <a className="sku-cover" href={"/skus/" + s.id} onClick={(e) => { e.preventDefault(); navigate("/skus/" + s.id); }}>
                  {s.cover_url ? (
                    <img src={s.cover_url} alt={s.name} loading="lazy" />
                  ) : (
                    <span className="sku-cover-empty"><IconImage size="extra-large" /></span>
                  )}
                </a>
                <div className="sku-body">
                  <div
                    className="tpl-name sku-name-link"
                    onClick={() => navigate("/skus/" + s.id)}
                  >
                    <span>{s.name}</span>
                    <IconChevronRight className="tpl-go" />
                  </div>
                  <div className="tpl-meta">
                    {statusTag(s.status)}
                    <Text type="quaternary" size="small">
                      {new Date(s.updated_at).toLocaleString()}
                    </Text>
                  </div>
                  <div className="tpl-actions">
                    <Button
                      theme="borderless"
                      size="small"
                      onClick={() => navigate("/skus/" + s.id)}
                    >
                      进入工作台
                    </Button>
                    <Popconfirm
                      title="删除 SKU"
                      content={"确定删除「" + s.name + "」？已生成的图片也会一并清除。"}
                      okType="danger"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => handleDelete(s)}
                    >
                      <Button
                        icon={<IconDelete />}
                        theme="borderless"
                        type="danger"
                        size="small"
                        loading={deletingId === s.id}
                      />
                    </Popconfirm>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
