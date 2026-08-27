import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, Cell, BarChart, Bar, LabelList,
} from "recharts";
import { getJSON, usd, usdFull, Tile } from "./lib.jsx";

const REASON_COLOR = { "Rate-sensitive": "#fbbf24", "Outflow risk": "#f87171", "Maturity approaching": "#60a5fa" };
const tip = { background: "#141b2e", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, fontSize: 12 };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ") : s);

export default function BookView() {
  const [book, setBook] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { getJSON("/api/rm/book").then(setBook).catch((e) => setErr(String(e))); }, []);
  if (err) return <div className="card loading" style={{ color: "#f87171" }}>Book error: {err}</div>;
  if (!book) return <div className="card loading">Loading your book of business…</div>;
  const { book: b, attrition, crosssell, winback, clusters } = book;

  return (
    <>
      <div className="persona-hint">
        <b>Relationship Manager · your book of business.</b>{" "}
        Where the risk is, where the growth is, and the cohorts you can act on together.
      </div>

      {/* Summary tiles */}
      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <Tile label="Book under management" accent="teal" target={b.balance} render={(v) => usd(v)}
          foot={`${b.customers.toLocaleString()} managed relationships`} />
        <Tile label="Attrition · revenue at risk" accent="red" target={attrition.rev} render={(v) => usd(v)}
          foot={`${attrition.n} at risk · avg ${Math.round(attrition.avg_risk * 100)}`} ms={1300} />
        <Tile label="Cross-sell pipeline" accent="violet" target={crosssell.count} render={(v) => Math.round(v).toLocaleString()}
          foot={`qualified across ${crosssell.by_product.length} products`} ms={1500} />
        <Tile label="Balances walking · 30 days" accent="amber" target={winback.bal} render={(v) => usd(v)}
          foot={`${winback.n.toLocaleString()} customers draining balances`} ms={1700} />
      </div>

      {/* AI insights — directly beneath the summary */}
      <InsightCards />

      {/* Opportunity clusters */}
      <ClusterPanel clusters={clusters} />

      {/* Breakdowns */}
      <div className="grid cols-3">
        <AttritionBreakdown attrition={attrition} />
        <CrossSellCard crosssell={crosssell} />
        <WinBackCard winback={winback} />
      </div>
    </>
  );
}

function InsightCards() {
  const [ins, setIns] = useState(null);
  const [src, setSrc] = useState("");
  useEffect(() => { getJSON("/api/rm/insights").then((d) => { setIns(d.insights); setSrc(d.source); }).catch(() => setIns([])); }, []);
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row" style={{ marginBottom: 4 }}>
        <div className="cap" style={{ marginBottom: 0 }}>Interaction summary · AI insights</div>
        <span className="gw-chip">⚡ Unity AI Gateway{src === "fallback" ? " (cached)" : ""}</span>
      </div>
      {!ins ? <div className="mini" style={{ padding: 14 }}>Generating insights from your book…</div> : (
        <div className="grid cols-3" style={{ marginTop: 10 }}>
          {ins.map((c, i) => (
            <div key={i} className="insight">
              <div className="row"><div className="ititle">{c.title}</div><div className="iimpact">{c.impact}</div></div>
              <div className="mini" style={{ margin: "8px 0 10px" }}>{c.insight}</div>
              <div className="iplay">▸ {c.play}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClusterPanel({ clusters }) {
  const ranked = useMemo(() => clusters.filter((c) => c.rev_risk > 1000).sort((a, b) => b.rev_risk - a.rev_risk).slice(0, 10), [clusters]);
  const [sel, setSel] = useState(0);
  const c = ranked[sel];
  const scatter = ranked.map((k, i) => ({
    x: Math.round(k.avg_risk * 100), y: k.rev_risk, z: k.n, reason: k.reason,
    name: `${cap(k.tier)} · ${k.product_type} · ${k.reason}`, idx: i,
  }));
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="cap">Act together · cohorts sharing a reason + product + opportunity</div>
      <h3 style={{ marginBottom: 14 }}>Opportunity clusters — {ranked.length} cohorts you can action as one campaign</h3>
      <div className="grid cols-2" style={{ gap: 22 }}>
        <ResponsiveContainer width="100%" height={330}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 28, left: 8 }}>
            <XAxis type="number" dataKey="x" domain={[60, 100]} tick={{ fill: "#5c6785", fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: "avg attrition risk →", position: "bottom", fill: "#5c6785", fontSize: 11 }} />
            <YAxis type="number" dataKey="y" tickFormatter={(v) => usd(v)} tick={{ fill: "#5c6785", fontSize: 11 }} axisLine={false} tickLine={false} width={52}
              label={{ value: "revenue at risk", angle: -90, position: "insideLeft", fill: "#5c6785", fontSize: 11 }} />
            <ZAxis type="number" dataKey="z" range={[220, 2200]} />
            <Tooltip contentStyle={tip} cursor={{ strokeDasharray: "3 3" }} content={<CTip />} />
            <Scatter data={scatter} onClick={(p) => setSel(p.idx)}>
              {scatter.map((s, i) => <Cell key={i} fill={REASON_COLOR[s.reason] || "#60a5fa"} fillOpacity={i === sel ? 0.95 : 0.5}
                stroke={i === sel ? "#eef2fb" : "transparent"} strokeWidth={2} style={{ cursor: "pointer" }} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div>
          <div className="legend" style={{ marginTop: 0, marginBottom: 12 }}>
            <span><i style={{ background: "#fbbf24" }} />Rate-sensitive</span>
            <span><i style={{ background: "#f87171" }} />Outflow risk</span>
            <span><i style={{ background: "#60a5fa" }} />Maturity</span>
            <span style={{ color: "var(--faint)" }}>size = customers</span>
          </div>
          <div className="cluster-list">
            {ranked.map((k, i) => (
              <button key={i} className={`cluster-item ${i === sel ? "sel" : ""}`} onClick={() => setSel(i)}>
                <span className="cdot" style={{ background: REASON_COLOR[k.reason] || "#60a5fa" }} />
                <span className="cbody"><b>{cap(k.tier)} · {k.product_type} · {k.reason}</b>
                  <span className="mini">{k.n} customers · {usd(k.rev_risk)} at risk · → {k.xsell_label}</span></span>
              </button>
            ))}
          </div>
          {c && (
            <div className="combined-play">
              <div className="kicker" style={{ color: "#2dd4bf" }}>Combined play</div>
              <div style={{ fontSize: 15, fontWeight: 700, margin: "6px 0" }}>One campaign for {c.n} {cap(c.tier)} customers on {c.product_type}</div>
              <div className="mini">All {c.reason.toLowerCase()} — {usd(c.rev_risk)} at risk on {usd(c.bal_risk)} balance. Rate-match now, then grow with <b>{c.xsell_label}</b>.</div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn primary">Launch campaign for {c.n}</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function CTip({ payload }) {
  if (!payload || !payload.length) return null;
  const d = payload[0].payload;
  return <div style={tip}><div style={{ padding: "8px 11px" }}><div style={{ fontWeight: 700 }}>{d.name}</div>
    <div className="mini">{d.z} customers · {usdFull(d.y)} at risk · avg risk {d.x}</div></div></div>;
}

function AttritionBreakdown({ attrition }) {
  const data = attrition.reasons.map((r) => ({ name: r.reason, n: r.n, rev: r.rev }));
  return (
    <div className="card">
      <div className="cap">Attrition · why they're leaving</div>
      <h3 style={{ marginBottom: 12 }}>{attrition.n} at risk · {usd(attrition.rev)}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, left: 8, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tick={{ fill: "#8a97b4", fontSize: 12 }} axisLine={false} tickLine={false} width={128} />
          <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v, n, p) => [`${p.payload.n} customers · ${usd(p.payload.rev)}`, ""]} />
          <Bar dataKey="n" radius={[0, 5, 5, 0]} barSize={22}>
            {data.map((d, i) => <Cell key={i} fill={REASON_COLOR[d.name] || "#f87171"} />)}
            <LabelList dataKey="n" position="right" fill="#eef2fb" fontSize={12} fontWeight={700} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function CrossSellCard({ crosssell }) {
  return (
    <div className="card">
      <div className="cap">Cross-sell · grow the relationship</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#a78bfa", letterSpacing: "-1px" }}>{crosssell.count.toLocaleString()}</div>
      <div className="mini" style={{ marginBottom: 12 }}>qualified opportunities</div>
      {crosssell.by_product.map((x, i) => (
        <div key={i} className="row" style={{ padding: "5px 0" }}><span className="mini">{x.label}</span><b className="mini">{x.n}</b></div>
      ))}
    </div>
  );
}
function WinBackCard({ winback }) {
  return (
    <div className="card">
      <div className="cap">Balances walking · act to recover</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#fbbf24", letterSpacing: "-1px" }}>{usd(winback.bal)}</div>
      <div className="mini" style={{ marginBottom: 12 }}>{winback.n.toLocaleString()} customers draining balances (30d)</div>
      {winback.by_product.map((x, i) => (
        <div key={i} className="row" style={{ padding: "5px 0" }}><span className="mini" style={{ textTransform: "capitalize" }}>{cap(x.product_type)}</span><b className="mini">{x.n.toLocaleString()} · {usd(x.bal)}</b></div>
      ))}
    </div>
  );
}
