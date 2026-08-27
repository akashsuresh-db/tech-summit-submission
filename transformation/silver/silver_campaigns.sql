CREATE OR REFRESH MATERIALIZED VIEW silver_campaigns
AS
SELECT
  rc.campaign_id,
  rc.customer_id,
  c.tier,
  c.tenure_years,
  rc.product_id,
  p.product_name,
  p.product_type,
  rc.action_type,
  rc.offered_product_id,
  rc.balance_at_risk_usd,
  rc.initiated_date,
  rc.days_to_resolve,
  rc.retained,
  rc.retained_revenue_usd,
  rc.margin_impact_usd,
  rc.cost_usd
FROM read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/retention_campaigns/') rc
JOIN read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/customers/') c
  ON rc.customer_id = c.customer_id
LEFT JOIN read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/products/') p
  ON rc.product_id = p.product_id
