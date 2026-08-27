CREATE OR REFRESH MATERIALIZED VIEW silver_holdings
CLUSTER BY (customer_id)
AS
SELECT
  c.customer_id,
  c.customer_display_name,
  c.tier,
  c.tenure_years,
  c.home_metro,
  c.customer_lat,
  c.customer_lng,
  h.account_id,
  h.product_id,
  p.product_name,
  p.product_type,
  p.segment,
  h.balance_usd,
  h.maturity_date,
  h.rate_apy,
  h.status,
  CASE
    WHEN h.maturity_date IS NOT NULL THEN datediff(h.maturity_date, current_date())
    ELSE NULL
  END AS days_to_maturity
FROM read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/holdings/') h
JOIN read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/customers/') c
  ON h.customer_id = c.customer_id
JOIN read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/products/') p
  ON h.product_id = p.product_id
