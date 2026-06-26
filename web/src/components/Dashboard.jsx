import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Typography, DatePicker, Skeleton, Tooltip, Spin } from "@douyinfe/semi-ui";
import {
  IconImage,
  IconHistogram,
  IconLayers,
  IconLineChartStroked,
} from "@douyinfe/semi-icons";
import { api } from "../api.js";

const { Title, Text } = Typography;

function money(n) {
  return "¥" + Number(n || 0).toFixed(2);
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// YYYY-MM-DD → 本地 Date（用于回显 DatePicker）
function parseDate(s) {
  if (typeof s !== "string") return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// 单张统计卡：图标徽章 + 张数 + 花费
function StatCard({ icon, tone, label, count, cost }) {
  return (
    <Card className="dash-stat" bodyStyle={{ padding: 18 }}>
      <div className={"dash-stat-icon tone-" + tone}>{icon}</div>
      <div className="dash-stat-body">
        <Text type="tertiary" size="small">{label}</Text>
        <div className="dash-stat-num">
          <span className="dash-stat-count">{count ?? 0}</span>
          <span className="dash-stat-unit">张</span>
        </div>
        <Text type="tertiary" size="small">花费 {money(cost)}</Text>
      </div>
    </Card>
  );
}

// 轻量 SVG 柱状趋势图（零依赖）。柱高映射每日张数，hover 显示张数 + 花费。
function TrendChart({ trend }) {
  const max = Math.max(1, ...trend.map((d) => d.count));
  const W = 720;
  const H = 180;
  const padX = 8;
  const padTop = 12;
  const padBottom = 26;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const n = trend.length || 1;
  const slot = innerW / n;
  const barW = Math.max(4, Math.min(28, slot * 0.6));

  return (
    <div className="dash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="生图趋势">
        {/* 基线 */}
        <line
          x1={padX}
          y1={padTop + innerH}
          x2={W - padX}
          y2={padTop + innerH}
          stroke="var(--semi-color-border)"
          strokeWidth="1"
        />
        {trend.map((d, i) => {
          const h = d.count > 0 ? Math.max(2, (d.count / max) * innerH) : 0;
          const x = padX + slot * i + (slot - barW) / 2;
          const y = padTop + innerH - h;
          // 只在首、中、尾标注日期，避免拥挤
          const showLabel = n <= 10 || i === 0 || i === n - 1 || i === Math.floor(n / 2);
          return (
            <g key={d.date}>
              <Tooltip content={`${d.date}　${d.count} 张　${money(d.cost)}`} position="top">
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="2"
                  className="dash-bar"
                />
              </Tooltip>
              {showLabel ? (
                <text
                  x={padX + slot * i + slot / 2}
                  y={H - 8}
                  textAnchor="middle"
                  className="dash-bar-label"
                >
                  {d.date.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Dashboard({ refreshKey = 0 }) {
  const [loading, setLoading] = useState(true);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [data, setData] = useState(null);
  const [range, setRange] = useState(null); // [Date, Date] | null（null = 默认近 14 天）

  const load = useCallback(async (rng) => {
    const isRange = Array.isArray(rng) && rng[0] && rng[1];
    if (isRange) setRangeLoading(true);
    else setLoading(true);
    try {
      let path = "/api/dashboard";
      if (isRange) {
        path += `?from=${fmtDate(rng[0])}&to=${fmtDate(rng[1])}`;
      }
      const json = await api(path);
      setData(json);
      // 默认加载（未显式选区间）时，用后端返回的 from/to 回显到 DatePicker
      if (!isRange && json?.from && json?.to) {
        const f = parseDate(json.from);
        const t = parseDate(json.to);
        if (f && t) setRange([f, t]);
      }
    } catch (e) {
      // 静默失败不阻塞首页其它内容
    } finally {
      setLoading(false);
      setRangeLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function onRangeChange(value) {
    setRange(value || null);
    load(value || null);
  }

  const trend = useMemo(() => data?.trend || [], [data]);
  const totalInRange = useMemo(
    () => trend.reduce((acc, d) => ({ count: acc.count + d.count, cost: acc.cost + d.cost }), { count: 0, cost: 0 }),
    [trend]
  );

  if (loading && !data) {
    return (
      <div className="dashboard">
        <div className="dash-stats">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="dash-stat" bodyStyle={{ padding: 18 }}>
              <Skeleton placeholder={<Skeleton.Paragraph rows={2} />} loading active />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="dashboard">
      <div className="dash-stats">
        <StatCard
          tone="primary"
          icon={<IconImage size="large" />}
          label="今日生图"
          count={data.today.count}
          cost={data.today.cost}
        />
        <StatCard
          tone="success"
          icon={<IconHistogram size="large" />}
          label="近 7 天"
          count={data.last7.count}
          cost={data.last7.cost}
        />
        <StatCard
          tone="tertiary"
          icon={<IconLayers size="large" />}
          label="累计"
          count={data.total.count}
          cost={data.total.cost}
        />
      </div>

      <Card
        className="dash-trend panel"
        bodyStyle={{ padding: 18 }}
        title={
          <span className="panel-title">
            <IconLineChartStroked /> 生图趋势
          </span>
        }
        headerExtraContent={
          <DatePicker
            type="dateRange"
            density="compact"
            value={range}
            onChange={onRangeChange}
            placeholder={["开始", "结束"]}
            style={{ width: 300 }}
          />
        }
      >
        <div className="dash-trend-summary">
          <Text type="tertiary" size="small">
            {data.from} ~ {data.to}　共 {totalInRange.count} 张　花费 {money(totalInRange.cost)}
          </Text>
          <Text type="quaternary" size="small">花费按生成时单价快照统计（当前单价 {money(data.unitPrice)}/张）</Text>
        </div>
        <Spin spinning={rangeLoading}>
          <TrendChart trend={trend} />
        </Spin>
      </Card>
    </div>
  );
}
