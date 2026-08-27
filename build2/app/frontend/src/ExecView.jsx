import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, LabelList,
  PieChart, Pie, Legend, ScatterChart, Scatter,
} from "recharts";
import { Tile, usd, usdFull, getJSON } from "./lib.jsx";

const BAND_COLOR = { critical: "#f87171", elevated: "#fbbf24", watch: "#60a5fa", healthy: "#34d399" };
const ACTION_LABEL = { retention_offer: "Retention offer", cross_sell: "Cross-sell", rm_outreach: "RM outreach" };
const tip = { background: "#141b2e", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, fontSize: 12 };
const Card = ({ title, cap, children, style }) => (
  <div className="card" style={style}>{cap && <div className="cap">{cap}</div>}{title && <h3>{title}</h3>}{children}</div>);

export default function ExecView({ data }) {
  const { portfolio, nba, risk_bands, metros, nba_actions, scatter, total_customers } = data;
  const [prod, setProd] = useState(null);
  const [ins, setIns] = useState(null);
  useEffect(() => {
    getJSON("/api/exec/productivity").then(setProd).catch(() => {});
    getJSON("/api/exec/insights").then((d) => setIns(d.insights)).catch(() => setIns([]));
  }, []);

  const offerCost = (nba.pred_retained || 0) - (nba.pred_net || 0);
  const bridge = [
    { name: "Predicted\nretained", base: 0, delta: nba.pred_retained, color: "#34d399", total: nba.pred_retained },
    { name: "Retention\noffer cost", base: nba.pred_net, delta: offerCost, color: "#f87171", total: -offerCost },
    { name: "Net value\ncreated", base: 0, delta: nba.pred_net, color: "#2dd4bf", total: nba.pred_net },
  ];
  // Book by VALUE (balance under management) per risk band, not customer count
  const bands = ["critical", "elevated", "watch", "healthy"].map((b) => risk_bands.find((x) => x.risk_band === b)).filter(Boolean)
    .map((x) => ({ name: x.risk_band, value: x.balance, count: x.n, rev: x.rev_at_risk }));
  const metroData = metros.slice(0, 9).map((m) => ({ name: m.home_metro, rev: m.rev_risk }));
  const actionData = nba_actions.map((a) => ({ name: ACTION_LABEL[a.recommended_action] || a.recommended_action, net: a.net, n: a.n }));
  const scatterData = scatter.map((s) => ({ x: s.bal, y: s.risk, band: s.risk_band, name: s.name }));

  return (
    <>
      <div className="persona-hint">
        <b>Executive view · Yusuf Demirel (EVP Banking).</b>{" "}
        A competitor rate promotion pushed our most valuable maturing-CD customers into attrition risk. Here is the exposure, what acting on it is worth, and how productively the RM team is covering the book.
      </div>

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <Tile label="Revenue at risk" accent="red" target={portfolio.revenue_at_risk} render={(v) => usd(v)}
          foot={`${portfolio.atrisk_customers} customers · ${usd(portfolio.balance_at_risk)} balance`} />
        <Tile label="NBA net value (predicted)" accent="emerald" target={nba.pred_net} render={(v) => usd(v)}
          foot={`across ${nba.n} live recommendations`} ms={1300} />
        <Tile label="Customers scored" accent="teal" target={total_customers} render={(v) => Math.round(v).toLocaleString()}
          foot={`${portfolio.atrisk_customers} flagged at risk`} ms={1500} />
        <Tile label="Not reached in 90 days" accent="amber" target={prod ? prod.summary.not_reached_90d : 0}
          render={(v) => Math.round(v).toLocaleString()}
          foot={prod ? `${prod.summary.not_reached_pct}% of book · ${usd(prod.summary.revenue_exposed_unreached)} exposed` : "loading…"} ms={1700} />
      </div>

      {/* Executive AI insights */}
      <Card cap="AI insights · for the executive" style={{ marginBottom: 18 }}>
        <div className="row" style={{ marginTop: -8, marginBottom: 4 }}>
          <div className="cap" style={{ marginBottom: 0 }}>What to act on</div>
          <span className="gw-chip">⚡ Unity AI Gateway</span>
        </div>
        {!ins ? <div className="mini" style={{ padding: 10 }}>Generating executive insights…</div> : (
          <div className="grid cols-3" style={{ marginTop: 8 }}>
            {ins.map((c, i) => (
              <div key={i} className="insight">
                <div className="row"><div className="ititle">{c.title}</div><div className="iimpact">{c.impact}</div></div>
                <div className="mini" style={{ margin: "8px 0 10px" }}>{c.insight}</div>
                <div className="iplay">▸ {c.play}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* RM productivity leaderboard */}
      {prod && <Leaderboard prod={prod} />}

      {/* Scatter */}
      <Card cap="Who is at risk · every customer by balance and attrition risk" title="Customer balance vs attrition risk" style={{ marginBottom: 18 }}>
        <ResponsiveContainer width="100%" height={340}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
            <XAxis type="number" dataKey="x" tickFormatter={(v) => usd(v)} tick={{ fill: "#5c6785", fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: "total balance →", position: "bottom", fill: "#5c6785", fontSize: 11 }} />
            <YAxis type="number" dataKey="y" domain={[0, 1]} tickFormatter={(v) => Math.round(v * 100)} tick={{ fill: "#5c6785", fontSize: 11 }}
              axisLine={false} tickLine={false} width={36} label={{ value: "attrition risk", angle: -90, position: "insideLeft", fill: "#5c6785", fontSize: 11 }} />
            <Tooltip contentStyle={tip} cursor={{ strokeDasharray: "3 3" }} content={<ScTip />} />
            {["healthy", "watch", "elevated", "critical"].map((band) => (
              <Scatter key={band} name={band} data={scatterData.filter((d) => d.band === band)} fill={BAND_COLOR[band]} fillOpacity={0.55} />
            ))}
            <Legend formatter={(v) => <span style={{ color: "#8a97b4", fontSize: 12, textTransform: "capitalize" }}>{v}</span>} />
          </ScatterChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid cols-3">
        <Card cap="For Yusuf · what acting on the book is worth" title="Value bridge">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bridge} margin={{ top: 24, right: 8, left: 4, bottom: 18 }} barCategoryGap="24%">
              <XAxis dataKey="name" tick={{ fill: "#8a97b4", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tickFormatter={(v) => usd(v)} tick={{ fill: "#5c6785", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(_, __, p) => [usdFull(Math.abs(p.payload.total)), "impact"]} />
              <Bar dataKey="base" stackId="a" fill="transparent" />
              <Bar dataKey="delta" stackId="a" radius={[6, 6, 6, 6]}>
                {bridge.map((b, i) => <Cell key={i} fill={b.color} />)}
                <LabelList dataKey="total" position="top" formatter={(v) => (v < 0 ? "−" : "") + usd(Math.abs(v))} fill="#eef2fb" fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card cap="Where the value sits" title="Book by risk band · by value">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={bands} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none">
                {bands.map((b, i) => <Cell key={i} fill={BAND_COLOR[b.name]} />)}
              </Pie>
              <Tooltip contentStyle={tip} formatter={(v, n, p) => [`${usd(v)} balance · ${p.payload.count.toLocaleString()} customers`, p.payload.name]} />
              <Legend formatter={(v) => <span style={{ color: "#8a97b4", fontSize: 12, textTransform: "capitalize" }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card cap="Prescribed plays" title="Predicted value by action">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={actionData} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fill: "#8a97b4", fontSize: 12 }} axisLine={false} tickLine={false} width={92} />
              <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v, n, p) => [`${usd(p.payload.net)} · ${p.payload.n} customers`, p.payload.name]} />
              <Bar dataKey="net" radius={[0, 6, 6, 0]} barSize={26}>
                {actionData.map((_, i) => <Cell key={i} fill={["#34d399", "#a78bfa", "#60a5fa"][i % 3]} />)}
                <LabelList dataKey="net" position="right" formatter={(v) => usd(v)} fill="#eef2fb" fontSize={12} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </>
  );
}

function Leaderboard({ prod }) {
  const Row = ({ r, rank, tone }) => (
    <div className="lb-row">
      <span className={`lb-rank ${tone}`}>{rank}</span>
      <span className="lb-name">{r.rm}</span>
      <span className="lb-book mini">{r.book.toLocaleString()} book · {r.at_risk_n} at-risk</span>
      <div className="lb-bar"><div style={{ width: `${Math.round(r.contact_rate * 100)}%`, background: tone === "good" ? "linear-gradient(90deg,#34d399,#2dd4bf)" : "linear-gradient(90deg,#fbbf24,#f87171)" }} /></div>
      <span className="lb-pct">{Math.round(r.contact_rate * 100)}%</span>
    </div>
  );
  return (
    <Card cap="RM productivity · are we reaching the book?" title="Relationship-manager leaderboard" style={{ marginBottom: 18 }}>
      <div className="mini" style={{ margin: "-6px 0 14px" }}>
        Ranked by 90-day contact rate and at-risk coverage. <b>{prod.summary.not_reached_90d.toLocaleString()}</b> customers
        ({prod.summary.not_reached_pct}%) haven't been reached in 90 days — <b>{usd(prod.summary.revenue_exposed_unreached)}</b> of at-risk revenue exposed.
      </div>
      <div className="grid cols-2" style={{ gap: 22 }}>
        <div>
          <div className="lb-head">★ Top performers</div>
          {prod.top.map((r, i) => <Row key={i} r={r} rank={i + 1} tone="good" />)}
        </div>
        <div>
          <div className="lb-head warn">▲ Needs coaching</div>
          {prod.coaching.map((r, i) => <Row key={i} r={r} rank={prod.summary.rm_count - i} tone="bad" />)}
        </div>
      </div>
    </Card>
  );
}

function ScTip({ payload }) {
  if (!payload || !payload.length) return null;
  const d = payload[0].payload;
  return <div style={tip}><div style={{ padding: "8px 11px" }}><div style={{ fontWeight: 700 }}>{d.name}</div>
    <div className="mini">{usdFull(d.x)} balance · risk {Math.round(d.y * 100)} · {d.band}</div></div></div>;
}
