import { IconLayers, IconArrowLeft } from "@douyinfe/semi-icons";
import { Typography, Button } from "@douyinfe/semi-ui";
import { Link, useNavigate } from "react-router-dom";

const { Title, Text } = Typography;

// 顶部品牌栏。backTo 传入返回路径则显示返回按钮；right 为右侧操作区。
export default function AppHeader({ title, subtitle, right, backTo }) {
  const navigate = useNavigate();
  return (
    <header className="appbar">
      {backTo ? (
        <Button
          icon={<IconArrowLeft />}
          theme="borderless"
          onClick={() => navigate(backTo)}
          aria-label="返回"
          style={{ marginRight: 4 }}
        />
      ) : null}
      <Link className="brand" to="/">
        <span className="brand-mark"><IconLayers size="large" /></span>
        <span className="brand-text">
          <Title heading={5} style={{ margin: 0 }}>{title}</Title>
          {subtitle ? <Text type="tertiary" size="small">{subtitle}</Text> : null}
        </span>
      </Link>
      <span className="appbar-spacer" />
      {right || null}
    </header>
  );
}
