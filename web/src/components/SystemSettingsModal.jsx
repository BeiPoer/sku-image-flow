import { useEffect, useRef, useState } from "react";
import { Modal, Form, Banner, Typography, Toast } from "@douyinfe/semi-ui";
import { api } from "../api.js";

const { Text } = Typography;
const MAX_CANDIDATE_COUNT = 4;

function clampCandidateCount(value, fallback = MAX_CANDIDATE_COUNT) {
  const parsed = Number.parseInt(String(value), 10);
  const fallbackParsed = Number.parseInt(String(fallback), 10);
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackParsed;
  if (!Number.isFinite(base) || base < 1) return 1;
  return Math.max(1, Math.min(MAX_CANDIDATE_COUNT, base));
}

// 系统设置弹窗：配置生图 API（URL / Key）、图像模型、默认候选数与生图单价。
// 配置保存在后端 app_config 表，运行时覆盖 .env。
export default function SystemSettingsModal({ visible, onCancel, onSaved }) {
  const formApi = useRef(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ hasApiKey: false, apiKeyTail: "" });

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    api("/api/config")
      .then((json) => {
        if (!alive) return;
        const c = json.config || {};
        setMeta({ hasApiKey: !!c.hasApiKey, apiKeyTail: c.apiKeyTail || "" });
        formApi.current?.setValues({
          openaiBaseUrl: c.openaiBaseUrl || "",
          openaiApiKey: "",
          imageModel: c.imageModel || "",
          defaultCandidates: clampCandidateCount(c.defaultCandidates),
          unitPrice: c.unitPrice ?? 0,
        });
      })
      .catch((e) => Toast.error(e.message || "读取配置失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [visible]);

  async function handleOk() {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      return; // 校验未通过
    }
    setSaving(true);
    try {
      await api("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      Toast.success("系统设置已保存");
      onSaved?.();
      onCancel?.();
    } catch (e) {
      Toast.error(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const keyPlaceholder = meta.hasApiKey
    ? `已配置 ••••${meta.apiKeyTail}，留空则不修改`
    : "尚未配置，请填写 API Key";

  return (
    <Modal
      title="系统设置"
      visible={visible}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      maskClosable={false}
      width={520}
    >
      <Banner
        type="info"
        bordered
        closeIcon={null}
        description="API Key 仅保存在本机数据库，不会回显明文。单价用于统计花费，会在每次生图时快照记录。"
        style={{ marginBottom: 16 }}
      />
      <Form
        getFormApi={(a) => (formApi.current = a)}
        labelPosition="top"
        disabled={loading}
      >
        <Form.Input
          field="openaiBaseUrl"
          label="API URL"
          placeholder="例如 https://api.openai.com/v1"
          rules={[{ required: true, message: "请填写 API URL" }]}
        />
        <Form.Input
          field="openaiApiKey"
          label="API Key"
          mode="password"
          autoComplete="new-password"
          placeholder={keyPlaceholder}
          extraText={<Text type="tertiary" size="small">留空表示沿用已保存的 Key</Text>}
        />
        <Form.Input
          field="imageModel"
          label="图像模型"
          placeholder="例如 gpt-image-2"
          rules={[{ required: true, message: "请填写图像模型" }]}
        />
        <Form.InputNumber
          field="defaultCandidates"
          label="默认候选数"
          min={1}
          max={MAX_CANDIDATE_COUNT}
          step={1}
          precision={0}
          style={{ width: "100%" }}
        />
        <Form.InputNumber
          field="unitPrice"
          label="生图单价（每张）"
          min={0}
          step={0.01}
          precision={2}
          prefix="¥"
          style={{ width: "100%" }}
          extraText={<Text type="tertiary" size="small">用于仪表盘统计花费，按张计</Text>}
        />
      </Form>
    </Modal>
  );
}
