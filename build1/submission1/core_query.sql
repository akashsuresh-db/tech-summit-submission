SELECT cp.customer_id, cp.tier, cp.tenure_years,
       ROUND(cp.revenue_at_risk_usd::numeric)   AS revenue_at_risk_usd,
       ROUND(cp.balance_at_risk_usd::numeric)    AS balance_at_risk_usd,
       oa.atrisk_product_id, oa.days_to_maturity,
       nba.recommended_action,
       ROUND(nba.predicted_retained_usd::numeric) AS predicted_retained_usd
FROM app.customer_position cp
JOIN app.open_atrisk oa          ON oa.customer_id = cp.customer_id
JOIN app.nba_recommendations nba ON nba.customer_id = cp.customer_id
WHERE cp.risk_band = 'critical'
ORDER BY cp.revenue_at_risk_usd DESC
LIMIT 15;
