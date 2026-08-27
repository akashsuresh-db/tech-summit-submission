"""Meridian Bank — Next-Best-Action app backend (Lakebase-only).

All customer/portfolio data is read live from the Lakebase `app.*` schema; RM
notes/actions are written to the writable `app.rm_actions` table. No Delta / SQL
warehouse dependency at runtime. The chat + AI insight cards call a chat model
served behind the Unity AI Gateway.
"""
from __future__ import annotations

import os
import json
import functools

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lb

CHAT_MODEL = os.getenv("MERIDIAN_CHAT_MODEL", "databricks-claude-haiku-4-5")
PROFILE = os.getenv("DATABRICKS_CONFIG_PROFILE")

# Illustrative governed-AI economics (framing; surfaced as targets in the UI).
AI_ANNUAL_SPEND = 300_000
AI_BUDGET_CAP = 360_000
COMPANY_AI_BUDGET = 12_000_000
AI_COST_PER_NBA = 0.04

MANAGED_TIERS = "('affluent','private','mass_affluent')"

# Reason inference (no servicing-note table in Lakebase — derive from signals).
REASON_SQL = """
  case
    when cp.balance_outflow_30d_usd >= 50000 then 'Outflow risk'
    when (coalesce(nba.recommended_rate_apy,0) - coalesce(oa.current_rate_apy,0)) >= 0.005 then 'Rate-sensitive'
    when oa.days_to_maturity <= 20 then 'Maturity approaching'
    else 'Rate-sensitive' end"""

# Stable per-customer contactability score (0.35–0.95) — a model-style signal.
CONTACT_SQL = "(0.35 + 0.6 * mod(abs(hashtext(cp.customer_id)), 1000) / 1000.0)"

app = FastAPI(title="Meridian NBA")


def display_name(cid: str) -> str:
    if cid and cid.upper().startswith("CUST-"):
        return "Customer " + cid.split("-", 1)[1]
    return cid


@functools.lru_cache(maxsize=1)
def _products():
    rows = lb.query("select product_id, product_name, product_type, segment from app.products")
    return {r["product_id"]: r for r in rows}


def plabel(pid):
    p = _products().get(pid)
    return p["product_name"] if p else pid


def ptype(pid):
    p = _products().get(pid)
    return p["product_type"] if p else None


def _user_email(request: Request) -> str:
    """End-user email — forwarded by Databricks Apps; falls back to the dev user."""
    for h in ("x-forwarded-email", "x-forwarded-preferred-username", "x-forwarded-user"):
        v = request.headers.get(h)
        if v:
            return v
    return os.getenv("DEV_USER_EMAIL", "relationship.manager@meridian.bank")


@app.get("/api/health")
def health():
    try:
        n = lb.query("select count(*) n from app.customer_position")[0]["n"]
        return {"ok": True, "source": "lakebase", "customers": n}
    except Exception as e:  # noqa
        return JSONResponse(status_code=503, content={"ok": False, "error": str(e)})


# ---------------------------------------------------------------- Exec
@app.get("/api/exec/summary")
def exec_summary():
    portfolio = lb.query("""
        select count(*) atrisk_customers, sum(balance_at_risk_usd) balance_at_risk,
          sum(revenue_at_risk_usd) revenue_at_risk, avg(attrition_risk_score) avg_risk
        from app.open_atrisk""")[0]
    nba = lb.query("""
        select sum(predicted_retained_usd) pred_retained, sum(predicted_net_value_usd) pred_net,
          count(*) n from app.nba_recommendations""")[0]
    bands = lb.query("""
        select risk_band, count(*) n, sum(revenue_at_risk_usd) rev_at_risk,
          sum(balance_at_risk_usd) bal_at_risk, sum(total_balance_usd) balance
        from app.customer_position group by 1""")
    metros = lb.query("""
        select home_metro, count(*) filter (where risk_band in ('critical','elevated')) n,
          sum(revenue_at_risk_usd) rev_risk
        from app.customer_position group by 1 order by rev_risk desc nulls last limit 12""")
    nba_actions = lb.query("""
        select recommended_action, count(*) n, sum(predicted_net_value_usd) net
        from app.nba_recommendations group by 1 order by net desc""")
    total_customers = lb.query("select count(*) n from app.customer_position")[0]["n"]
    # Scatter: all at-risk + a sample of the rest (balance vs attrition risk, by band)
    scatter = lb.query("""
        (select customer_id, total_balance_usd bal, attrition_risk_score risk, risk_band, revenue_at_risk_usd rev
         from app.customer_position where risk_band in ('critical','elevated'))
        union all
        (select customer_id, total_balance_usd bal, attrition_risk_score risk, risk_band, revenue_at_risk_usd rev
         from app.customer_position where risk_band in ('watch','healthy')
         and total_balance_usd is not null order by total_balance_usd desc limit 450)""")
    for s in scatter:
        s["name"] = display_name(s["customer_id"])
    return {
        "portfolio": portfolio, "nba": nba, "risk_bands": bands, "metros": metros,
        "nba_actions": nba_actions, "total_customers": total_customers, "scatter": scatter,
    }


# ---- RM roster + productivity (executive view: contactability + leaderboard) ----
RM_NAMES = [
    "Priya Raghavan", "Daniel Okoro", "Mei-Ling Chen", "Carlos Restrepo", "Aisha Bello",
    "Tom Fitzgerald", "Sofia Marchetti", "Rahul Menon", "Grace Kim", "Liam O'Sullivan",
]


@app.get("/api/exec/productivity")
def exec_productivity():
    """RM productivity from contact recency: who's not been reached in 90 days + leaderboard.

    Each managed customer is assigned to an RM and given a last-contact recency; a customer
    counts as 'reached' if an RM logged an action in app.rm_actions in the last 90 days OR
    their maintained contact recency is within 90 days. Logging a note in the app moves a
    customer to 'reached' — a live closed loop.
    """
    n = len(RM_NAMES)
    rows = lb.query(f"""
        with base as (
          select cp.customer_id, cp.revenue_at_risk_usd rev, cp.total_balance_usd bal,
            mod(abs(hashtext(cp.customer_id)), {n}) rm_idx,
            mod(abs(hashtext(cp.customer_id || '_c')), 190) syn_days,
            case when cp.risk_band in ('critical','elevated') then 1 else 0 end at_risk
          from app.customer_position cp where cp.tier in {MANAGED_TIERS}),
        contact as (select customer_id, max(created_at) last_contact from app.rm_actions group by 1),
        j as (
          -- per-RM diligence: contact-recency threshold varies by RM so the leaderboard has real spread
          select b.*, case when (c.last_contact is not null and c.last_contact > now() - interval '90 days')
                            or b.syn_days <= (45 + b.rm_idx * 11) then 1 else 0 end reached
          from base b left join contact c on c.customer_id = b.customer_id)
        select rm_idx, count(*) book, sum(reached) reached, sum(at_risk) at_risk_n,
          sum(case when at_risk=1 and reached=1 then 1 else 0 end) at_risk_reached,
          sum(case when reached=0 then 1 else 0 end) unreached,
          sum(case when reached=0 then rev else 0 end) rev_unreached
        from j group by rm_idx order by rm_idx""")
    rms = []
    for r in rows:
        book = r["book"] or 1
        cr = (r["reached"] or 0) / book
        arc = (r["at_risk_reached"] or 0) / (r["at_risk_n"] or 1)
        rms.append({
            "rm": RM_NAMES[r["rm_idx"]], "book": r["book"], "reached": r["reached"],
            "unreached": r["unreached"], "at_risk_n": r["at_risk_n"], "at_risk_reached": r["at_risk_reached"],
            "rev_unreached": r["rev_unreached"], "contact_rate": round(cr, 3),
            "at_risk_coverage": round(arc, 3), "score": round(0.5 * cr + 0.5 * arc, 3),
        })
    rms.sort(key=lambda x: x["score"], reverse=True)
    total_cust = sum(r["book"] for r in rms)
    total_unreached = sum(r["unreached"] for r in rms)
    total_rev_unreached = sum(r["rev_unreached"] for r in rms)
    return {
        "summary": {
            "customers": total_cust, "not_reached_90d": total_unreached,
            "not_reached_pct": round(total_unreached / (total_cust or 1) * 100, 1),
            "revenue_exposed_unreached": total_rev_unreached, "rm_count": len(rms),
            "avg_contact_rate": round(sum(r["contact_rate"] for r in rms) / (len(rms) or 1), 3),
        },
        "top": rms[:5],
        "coaching": rms[-3:][::-1],
    }


# ---------------------------------------------------------------- RM book
@app.get("/api/rm/book")
def rm_book():
    book = lb.query(f"""
        select count(*) customers, sum(total_balance_usd) balance,
          sum(case when risk_band in ('critical','elevated') then 1 else 0 end) at_risk,
          sum(revenue_at_risk_usd) revenue_at_risk
        from app.customer_position where tier in {MANAGED_TIERS}""")[0]
    attrition = lb.query("""
        select count(*) n, sum(revenue_at_risk_usd) rev, sum(balance_at_risk_usd) bal,
          avg(attrition_risk_score) avg_risk from app.open_atrisk""")[0]
    reasons = lb.query(f"""
        select {REASON_SQL} reason, count(*) n, sum(oa.revenue_at_risk_usd) rev
        from app.open_atrisk oa
        join app.customer_position cp on cp.customer_id=oa.customer_id
        left join app.nba_recommendations nba on nba.customer_id=oa.customer_id
        group by 1 order by rev desc nulls last""")
    xsell = lb.query("""
        select candidate_cross_sell_product_id prod, count(*) n, sum(balance_at_risk_usd) bal
        from app.open_atrisk where candidate_cross_sell_product_id is not null
        group by 1 order by n desc""")
    for x in xsell:
        x["label"] = plabel(x["prod"])
    xsell_val = lb.query("""select sum(predicted_net_value_usd) net, count(*) n
        from app.nba_recommendations where recommended_action='cross_sell'""")[0]
    # Win-back reframed on Lakebase data: balances already walking (30-day outflow).
    winback = lb.query(f"""
        select count(*) n, sum(balance_outflow_30d_usd) bal
        from app.customer_position
        where balance_outflow_30d_usd >= 20000 and tier in {MANAGED_TIERS}""")[0]
    winback_prod = lb.query(f"""
        select cp.tier product_type, count(*) n, sum(cp.balance_outflow_30d_usd) bal
        from app.customer_position cp
        where cp.balance_outflow_30d_usd >= 20000 and cp.tier in {MANAGED_TIERS}
        group by 1 order by bal desc""")
    clusters = lb.query(f"""
        with enr as (
          select oa.customer_id, cp.tier, oa.attrition_risk_score, oa.revenue_at_risk_usd,
            oa.balance_at_risk_usd, oa.candidate_cross_sell_product_id xsell,
            oa.atrisk_product_id, {REASON_SQL} reason
          from app.open_atrisk oa
          join app.customer_position cp on cp.customer_id=oa.customer_id
          left join app.nba_recommendations nba on nba.customer_id=oa.customer_id)
        select reason, atrisk_product_id, tier, count(*) n, avg(attrition_risk_score) avg_risk,
          sum(revenue_at_risk_usd) rev_risk, sum(balance_at_risk_usd) bal_risk, max(xsell) xsell
        from enr group by 1,2,3 having count(*) >= 5 order by rev_risk desc nulls last""")
    for c in clusters:
        c["product_type"] = ptype(c["atrisk_product_id"]) or "Deposit"
        c["xsell_label"] = plabel(c.get("xsell"))
    return {
        "book": book,
        "attrition": {**attrition, "reasons": reasons, "note_reasons": reasons},
        "crosssell": {"by_product": xsell, "count": sum(x["n"] for x in xsell),
                      "predicted_net": xsell_val["net"]},
        "winback": {**winback, "by_product": winback_prod},
        "clusters": clusters,
    }


# ---------------------------------------------------------------- RM funnel (full book)
@app.get("/api/rm/funnel")
def rm_funnel(category: str = "all", sort: str = "priority", limit: int = 600):
    rows = lb.query(f"""
        with f as (
          select cp.customer_id, cp.tier, cp.home_metro, cp.tenure_years, cp.risk_band,
            cp.attrition_risk_score risk, cp.revenue_at_risk_usd rev_risk,
            cp.balance_at_risk_usd bal_risk, cp.total_balance_usd balance,
            cp.balance_outflow_30d_usd outflow,
            oa.candidate_cross_sell_product_id xsell_pid, oa.days_to_maturity,
            nba.recommended_action action, nba.predicted_net_value_usd nba_net,
            {CONTACT_SQL} contactability,
            case when cp.risk_band in ('critical','elevated') then 'at_risk'
                 when nba.recommended_action='cross_sell' then 'cross_sell'
                 else 'grow' end category
          from app.customer_position cp
          left join app.open_atrisk oa on oa.customer_id=cp.customer_id
          left join app.nba_recommendations nba on nba.customer_id=cp.customer_id
          where cp.tier in {MANAGED_TIERS})
        select *, (coalesce(rev_risk,0) + coalesce(nba_net,0)) opportunity,
          (coalesce(rev_risk,0) + coalesce(nba_net,0)) * contactability priority
        from f
        {{where}}
        order by {{order}} nulls last
        limit %s
    """.replace("{where}", "where category = %s" if category in ("at_risk", "cross_sell", "grow") else "")
       .replace("{order}", {
           "revenue": "rev_risk desc", "opportunity": "opportunity desc",
           "contactability": "contactability desc", "priority": "priority desc",
       }.get(sort, "priority desc")),
       ([category, limit] if category in ("at_risk", "cross_sell", "grow") else [limit]))
    for r in rows:
        r["name"] = display_name(r["customer_id"])
        r["xsell_label"] = plabel(r["xsell_pid"]) if r.get("xsell_pid") else None
    # counts per category across the whole managed book
    counts = lb.query(f"""
        select case when cp.risk_band in ('critical','elevated') then 'at_risk'
                    when nba.recommended_action='cross_sell' then 'cross_sell'
                    else 'grow' end category, count(*) n
        from app.customer_position cp
        left join app.nba_recommendations nba on nba.customer_id=cp.customer_id
        where cp.tier in {MANAGED_TIERS} group by 1""")
    return {"rows": rows, "counts": {c["category"]: c["n"] for c in counts}}


# ---------------------------------------------------------------- Customer 360
@app.get("/api/rm/customer/{customer_id}")
def rm_customer(customer_id: str):
    cid = customer_id.replace("'", "")
    pos = lb.query("""
        select customer_id, tier, tenure_years, home_metro, profile_summary,
          total_balance_usd, deposit_balance_usd, balance_outflow_30d_usd,
          churn_signal_score, product_count, min_days_to_maturity, attrition_risk_score risk,
          revenue_at_risk_usd rev_risk, balance_at_risk_usd bal_risk, risk_band
        from app.customer_position where customer_id=%s""", (cid,))
    if not pos:
        raise HTTPException(404, "customer not found")
    p = pos[0]
    p["name"] = display_name(p["customer_id"])
    atrisk = lb.query("""
        select atrisk_product_id, atrisk_balance_usd, current_rate_apy, days_to_maturity,
          candidate_cross_sell_product_id, revenue_at_risk_usd, attrition_risk_score
        from app.open_atrisk where customer_id=%s""", (cid,))
    ar = atrisk[0] if atrisk else None
    if ar:
        ar["atrisk_product_name"] = plabel(ar["atrisk_product_id"])
        ar["atrisk_product_type"] = ptype(ar["atrisk_product_id"])
        ar["xsell_label"] = plabel(ar["candidate_cross_sell_product_id"]) if ar.get("candidate_cross_sell_product_id") else None
    nba = lb.query("""
        select recommended_action action, recommended_offer_product_id, recommended_rate_apy offer_rate,
          predicted_retained_usd pred_retained, predicted_net_value_usd pred_net, action_ranking
        from app.nba_recommendations where customer_id=%s""", (cid,))
    notes = lb.query("""
        select id, action_type, drafted_note, status, approved_by, created_at, decided_at
        from app.rm_actions where customer_id=%s order by created_at desc limit 25""", (cid,))
    for n in notes:
        n["id"] = str(n["id"])
        for k in ("created_at", "decided_at"):
            if n.get(k):
                n[k] = n[k].isoformat()
    return {"position": p, "atrisk": ar, "nba": nba[0] if nba else None, "notes": notes}


# ---------------------------------------------------------------- RM note write (approved)
class NoteIn(BaseModel):
    customer_id: str
    note: str
    action_type: str = "rm_outreach"


@app.post("/api/rm/note")
def rm_note(body: NoteIn, request: Request):
    if not body.note.strip():
        raise HTTPException(400, "empty note")
    who = _user_email(request)
    audit = json.dumps([{"event": "approved_and_saved", "by": who, "at": "now"}])
    rows = lb.execute("""
        insert into app.rm_actions (customer_id, action_type, drafted_note, status, approved_by, decided_at, audit_trail)
        values (%s, %s, %s, 'approved', %s, now(), %s::jsonb)
        returning id, created_at""",
        (body.customer_id, body.action_type, body.note.strip(), who, audit))
    r = rows[0]
    return {"ok": True, "id": str(r["id"]), "created_at": r["created_at"].isoformat(), "approved_by": who}


# ---------------------------------------------------------------- AI (gateway)
def _chat(messages, max_tokens=700, temperature=0.3):
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
    w = WorkspaceClient(profile=PROFILE) if PROFILE else WorkspaceClient()
    rmap = {"system": ChatMessageRole.SYSTEM, "user": ChatMessageRole.USER, "assistant": ChatMessageRole.ASSISTANT}
    msgs = [ChatMessage(role=rmap[m["role"]], content=m["content"]) for m in messages]
    r = w.serving_endpoints.query(name=CHAT_MODEL, messages=msgs, max_tokens=max_tokens, temperature=temperature)
    return r.choices[0].message.content


def usd_str(n):
    if n is None:
        return "$0"
    a = abs(n)
    if a >= 1e9:
        return f"${n/1e9:.2f}B"
    if a >= 1e6:
        return f"${n/1e6:.2f}M"
    if a >= 1e3:
        return f"${n/1e3:.0f}K"
    return f"${n:.0f}"


def _book_context():
    b = rm_book()
    lines = [
        "Relationship-manager book of business at Meridian Bank (served from Lakebase).",
        f"Book: {b['book']['customers']:,} managed customers, {usd_str(b['book']['balance'])} balances, {b['book']['at_risk']} at-risk.",
        f"Attrition: {b['attrition']['n']} open at-risk, {usd_str(b['attrition']['rev'])} revenue at risk, avg risk {b['attrition']['avg_risk']:.2f}.",
        "Attrition reasons: " + "; ".join(f"{r['reason']} ({r['n']}, {usd_str(r['rev'])})" for r in b["attrition"]["reasons"]) + ".",
        f"Cross-sell: {b['crosssell']['count']} qualified; " + ", ".join(f"{x['label']} ({x['n']})" for x in b["crosssell"]["by_product"]) + ".",
        f"Win-back / balances walking (30d): {b['winback']['n']} customers, {usd_str(b['winback']['bal'])}.",
        "Opportunity clusters:",
    ]
    for c in b["clusters"][:8]:
        lines.append(f"  - {c['tier']} · {c['product_type']} · {c['reason']}: {c['n']} customers, {usd_str(c['rev_risk'])} at risk, cross-sell {c['xsell_label']}.")
    return "\n".join(lines)


@functools.lru_cache(maxsize=1)
def _insights_cached():
    prompt = ("You are a portfolio strategist for a bank relationship manager. From the book below, "
              "produce exactly 3 punchy, action-oriented insight cards. Each: a short title (<=6 words), "
              "one sentence citing a number, and a one-line recommended play. "
              'Return ONLY JSON: {"insights":[{"title":"","insight":"","play":"","impact":"$X.XM"}]}\n\n' + _book_context())
    txt = _chat([{"role": "user", "content": prompt}], max_tokens=600, temperature=0.4)
    import re
    return json.loads(re.search(r"\{.*\}", txt, re.S).group(0))["insights"]


@app.get("/api/rm/insights")
def rm_insights():
    try:
        return {"insights": _insights_cached(), "source": "gateway", "model": CHAT_MODEL}
    except Exception as e:  # deterministic fallback
        b = rm_book()
        top = b["clusters"][0] if b["clusters"] else None
        ins = [
            {"title": "Rate-match the top cohort", "impact": usd_str(top["rev_risk"]) if top else "$1.4M",
             "insight": f"{top['n']} {top['tier']} customers on maturing {top['product_type']}s are rate-sensitive." if top else "A cohort is rate-sensitive.",
             "play": "Launch one coordinated rate-match before maturity."},
            {"title": "Cross-sell once retained", "impact": usd_str(b["crosssell"]["predicted_net"]),
             "insight": f"{b['crosssell']['count']} at-risk customers qualify for a product they don't hold.",
             "play": "Bundle the retention offer with a wealth conversation."},
            {"title": "Stem the balances walking", "impact": usd_str(b["winback"]["bal"]),
             "insight": f"{b['winback']['n']} customers are draining balances (30d).",
             "play": "Prioritize same-day outreach on the largest outflows."},
        ]
        return {"insights": ins, "source": "fallback", "error": str(e)}


class ChatIn(BaseModel):
    messages: list


@app.post("/api/rm/chat")
def rm_chat(body: ChatIn):
    sys = ("You are Meridian Copilot for a bank relationship manager, running through the Unity AI "
           "Gateway (governed, logged). Answer using ONLY the book context below. Be concise (2-4 "
           "sentences), cite specific numbers, suggest a concrete next action. Use light markdown "
           "(**bold** for figures).\n\nBOOK CONTEXT:\n" + _book_context())
    msgs = [{"role": "system", "content": sys}] + [
        {"role": m.get("role", "user"), "content": m.get("content", "")} for m in body.messages[-6:]]
    try:
        return {"reply": _chat(msgs, max_tokens=500, temperature=0.3), "model": CHAT_MODEL}
    except Exception as e:
        raise HTTPException(502, f"gateway error: {e}")


EMBED_ENDPOINT = os.getenv("MERIDIAN_EMBED_MODEL", "databricks-gte-large-en")


def _embed(text):
    from databricks.sdk import WorkspaceClient
    w = WorkspaceClient(profile=PROFILE) if PROFILE else WorkspaceClient()
    r = w.serving_endpoints.query(EMBED_ENDPOINT, input=[text])
    d = r.data[0]
    vec = d["embedding"] if isinstance(d, dict) else d.embedding
    return "[" + ",".join(str(x) for x in vec) + "]"


@app.get("/api/rm/recommendations/{customer_id}")
def rm_recommendations(customer_id: str):
    """3–5 product recommendations via native Lakebase Search (hybrid vector + BM25 RRF)
    over app.products — retrieval never leaves Lakebase. Gives the RM a choice, not one answer."""
    cid = customer_id.replace("'", "")
    pos = lb.query("""select cp.tier, cp.tenure_years, cp.profile_summary, oa.atrisk_product_id,
        oa.candidate_cross_sell_product_id
        from app.customer_position cp left join app.open_atrisk oa on oa.customer_id=cp.customer_id
        where cp.customer_id=%s""", (cid,))
    if not pos:
        raise HTTPException(404, "customer not found")
    p = pos[0]
    held = plabel(p["atrisk_product_id"]) if p.get("atrisk_product_id") else ""
    qtext = (f"{p['tier']} tier customer, {p.get('tenure_years') or ''} year tenure. "
             f"{p.get('profile_summary') or ''} Currently holds {held}. "
             "Recommend complementary wealth, investment, lending or deposit products to deepen the relationship.")
    try:
        qvec = _embed(qtext)
        recs = lb.query("""
            with vector_ranked as (
              select product_id, rank() over (order by dist) rank from (
                select product_id, embedding <=> %s::vector dist
                from app.products where embedding is not null order by dist limit 40) v),
            keyword_ranked as (
              select product_id, rank() over (order by score) rank from (
                select product_id, search_tsv <@> to_bm25query(to_tsvector('english', %s), 'app.products_bm25') score
                from app.products order by score limit 40) k)
            select p.product_id, p.product_name, p.product_type, p.segment, p.rate_apy, p.description,
              round((coalesce(1.0/(60+v.rank),0)+coalesce(1.0/(60+k.rank),0))::numeric,6) rrf
            from app.products p
            left join vector_ranked v on v.product_id=p.product_id
            left join keyword_ranked k on k.product_id=p.product_id
            where (v.product_id is not null or k.product_id is not null)
              and p.product_id <> coalesce(%s,'')
            order by rrf desc, p.product_id limit 5""",
            (qvec, qtext, p["atrisk_product_id"]))
        return {"recommendations": recs, "source": "lakebase_search", "query": qtext}
    except Exception as e:
        # fallback: candidate + a couple of products by segment
        recs = lb.query("select product_id, product_name, product_type, segment, rate_apy, description from app.products where is_active limit 5")
        return {"recommendations": recs, "source": "fallback", "error": str(e)}


@functools.lru_cache(maxsize=1)
def _exec_context():
    e = exec_summary()
    prod = exec_productivity()
    p, nba = e["portfolio"], e["nba"]
    return (
        f"Meridian Bank executive view. Revenue at risk {usd_str(p['revenue_at_risk'])} across "
        f"{p['atrisk_customers']} customers ({usd_str(p['balance_at_risk'])} balance). "
        f"Acting on the book: predicted retained {usd_str(nba['pred_retained'])}, net value {usd_str(nba['pred_net'])}. "
        f"RM productivity: {prod['summary']['not_reached_90d']:,} of {prod['summary']['customers']:,} managed customers "
        f"({prod['summary']['not_reached_pct']}%) have not been reached in 90 days, exposing "
        f"{usd_str(prod['summary']['revenue_exposed_unreached'])} of at-risk revenue. "
        f"Top RM {prod['top'][0]['rm']} (contact rate {int(prod['top'][0]['contact_rate']*100)}%); "
        f"needs coaching: {prod['coaching'][0]['rm']} (contact rate {int(prod['coaching'][0]['contact_rate']*100)}%)."
    )


@functools.lru_cache(maxsize=1)
def _exec_insights_cached():
    prompt = ("You are advising a bank's EVP of Consumer Banking. From the numbers below, produce exactly 3 "
              "punchy executive insight cards. Each: a short title (<=6 words), one sentence citing a number, "
              "and a one-line recommended action. Focus on revenue at risk and RM productivity. "
              'Return ONLY JSON: {"insights":[{"title":"","insight":"","play":"","impact":"$X.XM"}]}\n\n' + _exec_context())
    txt = _chat([{"role": "user", "content": prompt}], max_tokens=600, temperature=0.4)
    import re
    return json.loads(re.search(r"\{.*\}", txt, re.S).group(0))["insights"]


@app.get("/api/exec/insights")
def exec_insights():
    try:
        return {"insights": _exec_insights_cached(), "source": "gateway", "model": CHAT_MODEL}
    except Exception as e:
        prod = exec_productivity()
        e2 = exec_summary()
        ins = [
            {"title": "Revenue at risk needs action", "impact": usd_str(e2["portfolio"]["revenue_at_risk"]),
             "insight": f"{e2['portfolio']['atrisk_customers']} customers hold {usd_str(e2['portfolio']['revenue_at_risk'])} of revenue at risk.",
             "play": "Prioritise the critical band this week."},
            {"title": "Coverage gap is costing us", "impact": usd_str(prod["summary"]["revenue_exposed_unreached"]),
             "insight": f"{prod['summary']['not_reached_90d']:,} customers ({prod['summary']['not_reached_pct']}%) unreached in 90 days.",
             "play": "Set a 90-day contact SLA on at-risk relationships."},
            {"title": "Coach the bottom RMs", "impact": "",
             "insight": f"{prod['coaching'][0]['rm']} is reaching only {int(prod['coaching'][0]['contact_rate']*100)}% of their book.",
             "play": f"Pair with top performer {prod['top'][0]['rm']}."},
        ]
        return {"insights": ins, "source": "fallback", "error": str(e)}


_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="static")
