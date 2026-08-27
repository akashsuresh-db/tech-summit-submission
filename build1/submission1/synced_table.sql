-- Build 1 · Lakebase — query against the synced Unity Catalog table (app.customer_position),
-- a read-only mirror of akash_fevm_ts_catalog.meridian_bank.gold_customer_position synced into
-- Lakebase for low-latency serving. Top critical at-risk customers by revenue at risk.
SELECT customer_id, tier, tenure_years, risk_band,
       ROUND(attrition_risk_score::numeric, 3) AS attrition_risk,
       ROUND(balance_at_risk_usd::numeric)      AS balance_at_risk_usd,
       ROUND(revenue_at_risk_usd::numeric)      AS revenue_at_risk_usd
FROM app.customer_position
WHERE risk_band = 'critical'
ORDER BY revenue_at_risk_usd DESC
LIMIT 10;
