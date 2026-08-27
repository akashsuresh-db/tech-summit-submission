import React, { useEffect, useMemo, useState } from "react";
import { getJSON, usd, usdFull, apy, RiskGauge } from "./lib.jsx";

const bandOf = (r) => (r >= 0.85 ? "critical" : r >= 0.6 ? "elevated" : r >= 0.35 ? "watch" : "healthy");
const CAT = {
  at_risk: { label: "At risk", cls: "cat-risk" },
  cross_sell: { label: "Cross-sell", cls: "cat-xsell" },
  grow: { label: "Grow", cls: "cat-grow" },
};
const SORTS = [
  { id: "priority", label: "Smart priority" },
  { id: "revenue", label: "Revenue at risk" },
  { id: "opportunity", label: "Total opportunity" },
  { id: "contactability", label: "Contactability" },
];
const VALUE_BANDS = [
  { id: "any", label: "Any value", min: 0 },
  { id: "10k", label: "≥ $10K", min: 10000 },
  { id: "25k", label: "≥ $25K", min: 25000 },
];

export default function Customer360({ focusId }) {
  const [data, setData] = useState(null);
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState("priority");
  const [valBand, setValBand] = useState("any");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState(focusId || null);

  useEffect(() => {
    getJSON(`/api/rm/funnel?category=${cat}&sort=${sort}&limit=600`).then((d) => {
      setData(d);
      if (!sel && d.rows.length) setSel((focusId && d.rows.find((r) => r.customer_id === focusId)?.customer_id) || d.rows[0].customer_id);
    });
  }, [cat, sort]);

  const rows = useMemo(() => {
    if (!data) return [];
    const s = search.toLowerCase();
    const minV = VALUE_BANDS.find((v) => v.id === valBand).min;
    return data.rows.filter((r) =>
      (!s || r.name.toLowerCase().includes(s) || (r.home_metro || "").toLowerCase().includes(s)) &&
      ((r.rev_risk || 0) >= minV || (r.nba_net || 0) >= minV || minV === 0));
  }, [data, search, valBand]);

  const counts = data?.counts || {};
  const chips = [
    { id: "all", label: "All", n: (counts.at_risk || 0) + (counts.cross_sell || 0) + (counts.grow || 0) },
    { id: "at_risk", label: "At risk", n: counts.at_risk || 0 },
    { id: "cross_sell", label: "Cross-sell", n: counts.cross_sell || 0 },
    { id: "grow", label: "Grow", n: counts.grow || 0 },
  ];

  return (
    <div className="cockpit">
      <div>
        <div className="persona-hint" style={{ marginTop: 0 }}>
          <b>Your funnel.</b> Every managed relationship, ranked by where value and reachability meet.
        </div>
        <div className="cat-chips">
          {chips.map((c) => (
            <button key={c.id} className={`cat-chip ${cat === c.id ? "on" : ""}`} onClick={() => setCat(c.id)}>
              {c.label} <span className="cn">{c.n.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="funnel-controls">
          <select className="sel" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>Sort · {s.label}</option>)}
          </select>
          <select className="sel" value={valBand} onChange={(e) => setValBand(e.target.value)}>
            {VALUE_BANDS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <input className="search" placeholder="Search name or metro…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="mini" style={{ margin: "2px 0 10px 2px" }}><b>{rows.length}</b> shown</div>
        <div className="queue">
          {rows.map((c) => (
            <button key={c.customer_id} className={`queue-item ${c.customer_id === sel ? "sel" : ""}`} onClick={() => setSel(c.customer_id)}>
              <div className="qtop">
                <span className="qname">{c.name}</span>
                <span className={`cat-badge ${CAT[c.category].cls}`}>{CAT[c.category].label}</span>
              </div>
              <div className="qmeta">
                <span>{c.tier} · {c.home_metro}</span>
                <span className={c.category === "at_risk" ? "qrev" : "qopp"}>
                  {c.category === "at_risk" ? `${usd(c.rev_risk)} at risk` : c.nba_net ? `${usd(c.nba_net)} upside` : usd(c.balance)}
                </span>
              </div>
              <div className="contact-row">
                <span className="mini">reachability</span>
                <div className="contact-bar"><div style={{ width: `${Math.round((c.contactability || 0) * 100)}%` }} /></div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>{sel ? <Detail customerId={sel} /> : <div className="card loading">Select a customer.</div>}</div>
    </div>
  );
}

function Detail({ customerId }) {
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); getJSON(`/api/rm/customer/${customerId}`).then(setD); }, [customerId]);
  if (!d) return <div className="card loading">Loading customer 360…</div>;
  const { position: p, atrisk: ar, nba, notes } = d;
  const signal = freshSignal(p, ar, nba);

  return (
    <>
      <div className="card">
        <div className="row">
          <div className="gauge-wrap">
            <RiskGauge value={p.risk} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 750, letterSpacing: "-0.4px" }}>{p.name}</div>
              <div className="mini" style={{ marginTop: 4 }}>
                <span className={`badge ${p.risk_band}`} style={{ marginRight: 8 }}>{p.risk_band}</span>
                {p.tier} · {p.home_metro} · {p.tenure_years}-yr tenure · {usdFull(p.total_balance_usd)} relationship
              </div>
              <div className="mini" style={{ marginTop: 8, color: "var(--faint)", maxWidth: 520 }}>{p.profile_summary}</div>
            </div>
          </div>
        </div>
        {signal && (
          <div className="note-flag" style={{ marginTop: 14 }}>
            ⚡ Risk has climbed to {Math.round(p.risk * 100)} — fresh signal detected: {signal}. Worth a call now.
          </div>
        )}
      </div>

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="cap">Relationship snapshot</div>
          <div className="stat-grid">
            <Stat label="Total balance" value={usdFull(p.total_balance_usd)} />
            <Stat label="Deposits" value={usdFull(p.deposit_balance_usd)} />
            <Stat label="Products held" value={p.product_count ?? "—"} />
            <Stat label="Balance moved out (30d)" value={usd(p.balance_outflow_30d_usd)} accent={p.balance_outflow_30d_usd > 20000 ? "red" : null} />
          </div>
          {ar && (
            <div className="atrisk-prod">
              <div className="cap" style={{ marginBottom: 8 }}>Product at risk</div>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 700 }}>{ar.atrisk_product_name}</div>
                  <div className="mini">{usdFull(ar.atrisk_balance_usd)} · {apy(ar.current_rate_apy)}{ar.days_to_maturity != null ? ` · matures in ${ar.days_to_maturity} days` : ""}</div>
                </div>
                <span className="badge critical">at risk</span>
              </div>
            </div>
          )}
        </div>

        {nba ? (
          <div className="nba">
            <div className="kicker">Next best action</div>
            <div className="headline">{actionHeadline(nba, ar)}</div>
            {ar && nba.offer_rate != null && ar.current_rate_apy != null && (
              <div className="rate-move">
                <span className="from">{apy(ar.current_rate_apy)}</span><span className="arrow">→</span>
                <span className="to">{apy(nba.offer_rate)}</span>
                <span className="mini" style={{ marginLeft: 8 }}>on {usd(ar.atrisk_balance_usd)} balance</span>
              </div>
            )}
            <div className="row">
              <div><div className="mini">Predicted retained</div><div style={{ fontSize: 22, fontWeight: 800, color: "#34d399" }}>{usdFull(nba.pred_retained)}</div></div>
              <div><div className="mini">Predicted net value</div><div style={{ fontSize: 22, fontWeight: 800, color: "#2dd4bf" }}>{usdFull(nba.pred_net)}</div></div>
              {ar?.xsell_label && <div><div className="mini">Then grow with</div><div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa", marginTop: 6 }}>{ar.xsell_label}</div></div>}
            </div>
          </div>
        ) : <div className="card"><div className="cap">Next best action</div><div className="mini">Healthy relationship — nurture and look for growth.</div></div>}
      </div>

      <Recommendations customerId={p.customer_id} />
      <NotesPanel customerId={p.customer_id} notes={notes} nba={nba} ar={ar} />
    </>
  );
}

function Recommendations({ customerId }) {
  const [recs, setRecs] = useState(null);
  const [src, setSrc] = useState("");
  const [pick, setPick] = useState(0);
  useEffect(() => {
    setRecs(null);
    getJSON(`/api/rm/recommendations/${customerId}`).then((d) => { setRecs(d.recommendations); setSrc(d.source); setPick(0); }).catch(() => setRecs([]));
  }, [customerId]);
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="row"><div className="cap" style={{ marginBottom: 0 }}>Recommended products · pick the best fit</div>
        <span className="gw-chip">⚡ Lakebase Search{src === "fallback" ? " (fallback)" : " · hybrid"}</span></div>
      <div className="mini" style={{ margin: "4px 0 12px" }}>Ranked by hybrid vector + keyword search over the product catalog — retrieval stays in Lakebase.</div>
      {!recs ? <div className="mini" style={{ padding: 10 }}>Searching the catalog…</div> : (
        <div className="rec-grid">
          {recs.map((r, i) => (
            <button key={i} className={`rec-card ${i === pick ? "sel" : ""}`} onClick={() => setPick(i)}>
              <div className="row"><span className="rec-name">{r.product_name}</span>{i === 0 && <span className="badge healthy">top match</span>}</div>
              <div className="mini" style={{ margin: "4px 0 8px" }}>{r.product_type} · {r.segment}{r.rate_apy ? ` · ${(r.rate_apy * 100).toFixed(2)}% APY` : ""}</div>
              <div className="mini rec-desc">{r.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesPanel({ customerId, notes, nba, ar }) {
  const [list, setList] = useState(notes);
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setList(notes); }, [notes, customerId]);

  const suggest = () => {
    const bits = ["Discussed retention.", ];
    if (ar) bits.unshift(`Reviewed ${ar.atrisk_product_name} (${usdFull(ar.atrisk_balance_usd)}) maturing${ar.days_to_maturity != null ? ` in ${ar.days_to_maturity} days` : ""}.`);
    if (nba && ar) bits.push(`Proposed rate match to ${apy(nba.offer_rate)}; predicted retained ${usdFull(nba.pred_retained)}.`);
    setText(bits.join(" "));
  };

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/rm/note", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, note: text.trim(), action_type: "rm_outreach" }),
      });
      const d = await r.json();
      if (r.ok) {
        setList([{ id: d.id, drafted_note: text.trim(), status: "approved", approved_by: d.approved_by, created_at: d.created_at, action_type: "rm_outreach" }, ...list]);
        setText(""); setConfirming(false);
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="row"><div className="cap" style={{ marginBottom: 0 }}>Interaction summary · RM notes</div>
        <button className="btn" style={{ padding: "6px 12px" }} onClick={suggest}>✦ Draft from context</button></div>
      <textarea className="note-input" placeholder="Log this interaction — what was discussed, what you'll do next…"
        value={text} onChange={(e) => setText(e.target.value)} rows={3} />
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={!text.trim()} onClick={() => setConfirming(true)}>Save note</button>
        <span className="mini" style={{ alignSelf: "center", color: "var(--faint)" }}>Saved to the operational record (Lakebase) after your approval.</span>
      </div>

      {list.length > 0 && (
        <div className="notes-list">
          {list.map((n) => (
            <div key={n.id} className="note-item">
              <div className="row">
                <span className="badge healthy">{n.status}</span>
                <span className="mini">{n.approved_by} · {fmtDate(n.created_at)}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 13.5 }}>{n.drafted_note}</div>
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <div className="modal-wrap" onClick={() => !saving && setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="cap">Approve before saving</div>
            <h3 style={{ margin: "4px 0 12px" }}>Save this interaction note?</h3>
            <div className="note-preview">{text}</div>
            <div className="mini" style={{ margin: "12px 0", color: "var(--faint)" }}>
              This writes to the operational record with your name and a timestamp, and appears on this customer immediately.
            </div>
            <div className="actions">
              <button className="btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Approve & save"}</button>
              <button className="btn" onClick={() => setConfirming(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return <div className="stat"><div className="mini">{label}</div><div className={`sval ${accent ? "a-" + accent : ""}`}>{value}</div></div>;
}
function actionHeadline(nba, ar) {
  if (nba.action === "retention_offer") return "Save the relationship with a rate match before maturity";
  if (nba.action === "cross_sell") return `Grow with ${ar?.xsell_label || "a qualifying product"}`;
  return "Relationship-manager outreach";
}
function freshSignal(p, ar, nba) {
  if (p.balance_outflow_30d_usd >= 50000) return `${usd(p.balance_outflow_30d_usd)} in balances moved out this month`;
  if (ar && nba && nba.offer_rate != null && ar.current_rate_apy != null && (nba.offer_rate - ar.current_rate_apy) >= 0.005)
    return `their rate is ${((nba.offer_rate - ar.current_rate_apy) * 100).toFixed(2)}% below what the market now offers`;
  if (ar && ar.days_to_maturity != null && ar.days_to_maturity <= 20) return `a ${usd(ar.atrisk_balance_usd)} balance matures in ${ar.days_to_maturity} days`;
  if (p.churn_signal_score >= 0.8) return "recent servicing interactions point to churn intent";
  if (p.risk_band === "critical" || p.risk_band === "elevated") return "attrition-risk model flagged this relationship";
  return null;
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
}
