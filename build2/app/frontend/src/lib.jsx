import React, { useEffect, useRef, useState } from "react";

export async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export const usd = (n, d = 0) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(d ? 1 : 0)}K`;
  return `$${n.toFixed(d)}`;
};
export const usdFull = (n) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const pct = (n, d = 0) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
export const apy = (n) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`);

// Animated count-up. `render` maps the animated number to a string.
export function useCountUp(target, ms = 1100) {
  const [v, setV] = useState(0);
  const raf = useRef();
  useEffect(() => {
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setV(target * e);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

export function Tile({ label, target, render, foot, accent, ms }) {
  const v = useCountUp(target, ms);
  return (
    <div className={`card tile accent-${accent}`}>
      <div className="label">{label}</div>
      <div className="value">{render(v)}</div>
      <div className="foot">{foot}</div>
    </div>
  );
}

const RISK_COLOR = (r) => (r >= 0.85 ? "#f87171" : r >= 0.6 ? "#fbbf24" : r >= 0.35 ? "#60a5fa" : "#34d399");

export function RiskGauge({ value, size = 116 }) {
  const v = useCountUp(value, 900);
  const R = size / 2 - 9;
  const C = 2 * Math.PI * R;
  const off = C * (1 - v);
  const col = RISK_COLOR(value);
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={R} stroke="rgba(255,255,255,0.08)" strokeWidth="9" fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={R} stroke={col} strokeWidth="9" fill="none"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset 0.2s", filter: `drop-shadow(0 0 6px ${col}88)` }}
        />
      </svg>
      <div className="num" style={{ color: col }}>{Math.round(v * 100)}</div>
    </div>
  );
}

export { RISK_COLOR };
