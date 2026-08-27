-- Live view backing the RM at-risk funnel (served from Lakebase, low latency).
-- Trigger: attrition scoring writes app.open_atrisk; the app renders this ranked queue.
SELECT cp.customer_id, cp.tier, cp.home_metro, cp.risk_band,
       ROUND(cp.attrition_risk_score::numeric,3) AS attrition_risk,
       ROUND(cp.revenue_at_risk_usd::numeric)     AS revenue_at_risk_usd,
       ROUND(cp.balance_at_risk_usd::numeric)      AS balance_at_risk_usd,
       oa.atrisk_product_id, oa.days_to_maturity,
       nba.recommended_action,
       ROUND(nba.predicted_net_value_usd::numeric) AS predicted_net_value_usd
FROM app.customer_position cp
JOIN app.open_atrisk oa          ON oa.customer_id = cp.customer_id
JOIN app.nba_recommendations nba ON nba.customer_id = cp.customer_id
ORDER BY cp.revenue_at_risk_usd DESC
LIMIT 25;