CREATE OR REFRESH MATERIALIZED VIEW gold_customer_position
CLUSTER BY (risk_band, tier)
AS
WITH latest_risk AS (
  SELECT *
  FROM silver_risk
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY snapshot_date DESC) = 1
),
holdings_agg AS (
  SELECT
    customer_id,
    SUM(CASE WHEN status = 'active' THEN balance_usd ELSE 0 END) AS total_balance_usd,
    SUM(CASE WHEN status = 'active' AND segment = 'deposit' THEN balance_usd ELSE 0 END) AS deposit_balance_usd,
    SUM(CASE WHEN status = 'active' AND product_id IN ('PROD-DEP-2001', 'PROD-DEP-2002', 'PROD-DEP-2003') THEN balance_usd ELSE 0 END) AS affected_deposit_balance_usd,
    MIN(CASE WHEN product_id IN ('PROD-DEP-2001', 'PROD-DEP-2002', 'PROD-DEP-2003') AND status = 'active' AND days_to_maturity IS NOT NULL THEN days_to_maturity END) AS min_days_to_maturity,
    COUNT(CASE WHEN status = 'active' THEN 1 END) AS product_count
  FROM silver_holdings
  GROUP BY customer_id
),
dominant_seg AS (
  SELECT customer_id, segment
  FROM (
    SELECT
      customer_id,
      segment,
      ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY SUM(balance_usd) DESC) AS rn
    FROM silver_holdings
    WHERE status = 'active'
    GROUP BY customer_id, segment
  )
  WHERE rn = 1
),
raw_cust AS (
  SELECT customer_id, profile_summary
  FROM read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/customers/')
)
SELECT
  r.customer_id,
  r.customer_display_name,
  r.tier,
  r.tenure_years,
  r.home_metro,
  r.customer_lat,
  r.customer_lng,
  rc.profile_summary,
  h.total_balance_usd,
  h.deposit_balance_usd,
  h.affected_deposit_balance_usd,
  h.min_days_to_maturity,
  r.attrition_risk_score,
  r.balance_outflow_30d_usd,
  r.churn_signal_score,
  h.product_count,
  CASE WHEN r.attrition_risk_score >= 0.6 THEN h.affected_deposit_balance_usd ELSE 0 END AS balance_at_risk_usd,
  CASE WHEN r.attrition_risk_score >= 0.6
    THEN h.affected_deposit_balance_usd * 0.025 + GREATEST(0, r.tenure_years * 40)
    ELSE 0
  END AS revenue_at_risk_usd,
  CASE
    WHEN r.attrition_risk_score >= 0.75 AND h.affected_deposit_balance_usd > 0 THEN 'critical'
    WHEN r.attrition_risk_score >= 0.6 THEN 'elevated'
    WHEN r.attrition_risk_score >= 0.4 THEN 'watch'
    ELSE 'healthy'
  END AS risk_band,
  COALESCE(ds.segment, 'deposit') AS segment
FROM latest_risk r
JOIN holdings_agg h ON r.customer_id = h.customer_id
LEFT JOIN dominant_seg ds ON r.customer_id = ds.customer_id
LEFT JOIN raw_cust rc ON r.customer_id = rc.customer_id
