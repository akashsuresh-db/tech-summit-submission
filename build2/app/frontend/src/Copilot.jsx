import React, { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown.jsx";

const SUGGESTED = [
  "Which cohort should I prioritise this week?",
  "Where is my biggest cross-sell opportunity?",
  "Summarise my attrition risk in one line.",
];

export default function Copilot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([
    { role: "assistant", content: "I'm your **Meridian Copilot**, grounded in your live book. Ask me where to focus — I'll cite the numbers." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef();
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy, open]);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...msgs, { role: "user", content: q }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/rm/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((_, idx) => idx > 0) }),
      });
      const d = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: r.ok ? d.reply : `Gateway error: ${d.detail || "unavailable"}` }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Couldn't reach the gateway. Try again." }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button className={`copilot-fab ${open ? "hide" : ""}`} onClick={() => setOpen(true)} aria-label="Open Copilot">
        <span className="fab-spark">✦</span>
        <span>Ask Copilot</span>
      </button>

      {open && (
        <div className="copilot-pop">
          <div className="cp-head">
            <div>
              <div className="cp-title">Meridian Copilot</div>
              <div className="cp-sub">⚡ via Unity AI Gateway</div>
            </div>
            <button className="cp-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <div className="cp-body">
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
              </div>
            ))}
            {busy && <div className="bubble assistant typing"><span /><span /><span /></div>}
            <div ref={endRef} />
          </div>
          <div className="suggest">
            {SUGGESTED.map((s, i) => <button key={i} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>)}
          </div>
          <div className="chat-input">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your book…"
              onKeyDown={(e) => e.key === "Enter" && send()} disabled={busy} autoFocus />
            <button className="btn primary" onClick={() => send()} disabled={busy}>Send</button>
          </div>
        </div>
      )}
    </>
  );
}
