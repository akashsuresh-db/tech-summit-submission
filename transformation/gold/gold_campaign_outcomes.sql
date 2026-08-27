CREATE OR REFRESH MATERIALIZED VIEW gold_campaign_outcomes
AS
WITH latest_risk AS (
  SELECT customer_id, attrition_risk_score
  FROM silver_risk
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY snapshot_date DESC) = 1
)
SELECT
  sc.campaign_id,
  sc.customer_id,
  sc.action_type,
  sc.balance_at_risk_usd,
  sc.tier,
  sc.tenure_years,
  lr.attrition_risk_score AS attrition_risk_at_action,
  sc.days_to_resolve,
  sc.product_type,
  sc.retained,
  sc.retained_revenue_usd,
  sc.margin_impact_usd,
  sc.cost_usd
FROM silver_campaigns sc
LEFT JOIN latest_risk lr ON sc.customer_id = lr.customer_id
