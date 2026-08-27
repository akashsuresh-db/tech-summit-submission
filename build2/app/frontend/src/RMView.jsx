import React, { useState } from "react";
import BookView from "./BookView.jsx";
import Customer360 from "./Customer360.jsx";
import Copilot from "./Copilot.jsx";

const TABS = [
  { id: "book", label: "My Book" },
  { id: "funnel", label: "Funnel & Customer 360" },
];

export default function RMView() {
  const [tab, setTab] = useState("book");
  return (
    <>
      <div className="subtabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === "book" ? <BookView /> : <Customer360 />}
      <Copilot />
    </>
  );
}
