CREATE OR REFRESH MATERIALIZED VIEW gold_open_atrisk
AS
WITH atrisk_customers AS (
  SELECT *
  FROM gold_customer_position
  WHERE risk_band IN ('critical', 'elevated', 'watch')
),
affected_holdings AS (
  SELECT
    customer_id,
    product_id AS atrisk_product_id,
    balance_usd AS atrisk_balance_usd,
    days_to_maturity,
    rate_apy AS current_rate_apy,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY balance_usd DESC) AS rn
  FROM silver_holdings
  WHERE product_id IN ('PROD-DEP-2001', 'PROD-DEP-2002', 'PROD-DEP-2003')
    AND status = 'active'
),
held_segments AS (
  SELECT customer_id, collect_set(segment) AS segments_held
  FROM silver_holdings
  WHERE status = 'active'
  GROUP BY customer_id
)
SELECT
  a.customer_id,
  a.customer_display_name,
  a.tier,
  a.tenure_years,
  a.home_metro,
  a.customer_lat,
  a.customer_lng,
  a.attrition_risk_score,
  a.balance_at_risk_usd,
  a.revenue_at_risk_usd,
  a.risk_band,
  ah.atrisk_product_id,
  ah.atrisk_balance_usd,
  ah.days_to_maturity,
  ah.current_rate_apy,
  0.0385 - COALESCE(ah.current_rate_apy, 0.03) AS rate_gap,
  CASE
    WHEN NOT array_contains(hs.segments_held, 'investment') THEN 'PROD-INV-3001'
    WHEN NOT array_contains(hs.segments_held, 'lending') THEN 'PROD-CRD-4001'
    ELSE 'PROD-LN-5001'
  END AS candidate_cross_sell_product_id
FROM atrisk_customers a
LEFT JOIN affected_holdings ah
  ON a.customer_id = ah.customer_id AND ah.rn = 1
LEFT JOIN held_segments hs
  ON a.customer_id = hs.customer_id
