import React from "react";

// Lightweight markdown renderer (ported from fna_control_tower's AIChatPanel):
// headings, bullet + numbered lists, tables, and inline **bold** / *italic* / `code`.

function renderInline(text, keyBase = "") {
  const parts = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={keyBase + k++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={keyBase + k++}>{m[3]}</em>);
    else if (m[4]) parts.push(<code key={keyBase + k++} className="md-code">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

function parseTable(lines) {
  const isRow = (l) => l.trim().startsWith("|") && l.trim().endsWith("|");
  const isSep = (l) => /^\|[\s\-|:]+\|$/.test(l.trim());
  if (!isRow(lines[0])) return null;
  const cells = (l) => l.trim().slice(1, -1).split("|").map((c) => c.trim());
  const headers = cells(lines[0]);
  const start = lines.length > 1 && isSep(lines[1]) ? 2 : 1;
  const rows = lines.slice(start).filter(isRow).map(cells);
  return rows.length ? { headers, rows } : null;
}

export default function Markdown({ text }) {
  if (!text) return null;
  const lines = String(text).split("\n");
  const els = [];
  let i = 0, k = 0;
  const isTable = (l) => l.trim().startsWith("|") && l.trim().endsWith("|");
  const isHead = (l) => /^#{1,4}\s/.test(l.trim());
  const isBullet = (l) => /^[-*•]\s/.test(l.trim());
  const isNum = (l) => /^\d+[.)]\s/.test(l.trim());

  while (i < lines.length) {
    const raw = lines[i], trim = raw.trim();
    if (!trim) { i++; continue; }

    if (isTable(raw)) {
      const t = [];
      while (i < lines.length && (isTable(lines[i]) || /^\|[\s\-|:]+\|$/.test(lines[i].trim()))) {
        if (lines[i].trim()) t.push(lines[i]);
        i++;
      }
      const p = parseTable(t);
      if (p) els.push(
        <div key={k++} className="md-table-wrap"><table className="md-table">
          <thead><tr>{p.headers.map((h, x) => <th key={x}>{renderInline(h, `h${x}`)}</th>)}</tr></thead>
          <tbody>{p.rows.map((r, ri) => <tr key={ri}>{p.headers.map((_, ci) => <td key={ci}>{renderInline(r[ci] ?? "", `c${ri}${ci}`)}</td>)}</tr>)}</tbody>
        </table></div>);
      continue;
    }
    if (isHead(trim)) {
      const lvl = trim.match(/^#+/)[0].length;
      els.push(<div key={k++} className={`md-h md-h${lvl}`}>{renderInline(trim.replace(/^#+\s/, ""), `H${k}`)}</div>);
      i++; continue;
    }
    if (isBullet(trim) || isNum(trim)) {
      const items = [];
      const ordered = isNum(trim);
      while (i < lines.length && (isBullet(lines[i].trim()) || isNum(lines[i].trim()))) {
        items.push(lines[i].trim().replace(/^([-*•]|\d+[.)])\s/, ""));
        i++;
      }
      els.push(ordered
        ? <ol key={k++} className="md-list">{items.map((it, x) => <li key={x}>{renderInline(it, `o${k}${x}`)}</li>)}</ol>
        : <ul key={k++} className="md-list">{items.map((it, x) => <li key={x}>{renderInline(it, `u${k}${x}`)}</li>)}</ul>);
      continue;
    }
    // paragraph — gather until a block boundary
    const para = [];
    while (i < lines.length && lines[i].trim() && !isTable(lines[i]) && !isHead(lines[i].trim()) && !isBullet(lines[i].trim()) && !isNum(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    els.push(<p key={k++} className="md-p">{renderInline(para.join(" "), `p${k}`)}</p>);
  }
  return <div className="md">{els}</div>;
}
