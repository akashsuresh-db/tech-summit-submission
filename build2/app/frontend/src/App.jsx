import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getJSON } from "./lib.jsx";
import ExecView from "./ExecView.jsx";
import RMView from "./RMView.jsx";

const PERSONAS = [
  { id: "exec", label: "Executive" },
  { id: "rm", label: "Relationship Manager" },
];

function PersonaToggle({ persona, setPersona }) {
  const refs = useRef({});
  const [pill, setPill] = useState({ left: 5, width: 0 });
  useLayoutEffect(() => {
    const el = refs.current[persona];
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [persona]);
  return (
    <div className="toggle">
      <div className="pill" style={{ left: pill.left, width: pill.width }} />
      {PERSONAS.map((p) => (
        <button key={p.id} ref={(e) => (refs.current[p.id] = e)}
          className={persona === p.id ? "active" : ""} onClick={() => setPersona(p.id)}>
          <span className="dot" />{p.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [persona, setPersona] = useState("exec");
  const [exec, setExec] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getJSON("/api/exec/summary").then(setExec).catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo">M</div>
          <div>
            <h1>Meridian Bank · Next-Best-Action</h1>
            <div className="sub">Real-time customer 360 · governed AI · one platform</div>
          </div>
        </div>
        <PersonaToggle persona={persona} setPersona={setPersona} />
      </div>

      {err && <div className="card loading" style={{ color: "#f87171" }}>Backend error: {err}</div>}

      {persona === "exec" ? (
        exec ? <ExecView data={exec} /> : <div className="card loading">Loading portfolio…</div>
      ) : (
        <RMView />
      )}

      <div className="ribbon">
        Served live from <b>Lakebase</b> (project meridian-bank · schema app) · Databricks Apps · Unity Gateway.
        &nbsp;Portfolio, book & NBA figures are live from Lakebase; governed-AI economics are illustrative targets from the challenge brief.
      </div>
    </div>
  );
}
