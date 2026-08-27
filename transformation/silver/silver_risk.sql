CREATE OR REFRESH MATERIALIZED VIEW silver_risk
CLUSTER BY (snapshot_date)
AS
SELECT
  c.customer_id,
  c.customer_display_name,
  c.tier,
  c.tenure_years,
  c.home_metro,
  c.customer_lat,
  c.customer_lng,
  r.snapshot_date,
  r.attrition_risk_score,
  r.balance_outflow_30d_usd,
  r.servicing_note_text,
  COALESCE(n.churn_signal_score, 0.1) AS churn_signal_score
FROM read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/risk_snapshots/') r
JOIN read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/customers/') c
  ON r.customer_id = c.customer_id
LEFT JOIN note_churn_flags n
  ON r.servicing_note_text = n.servicing_note_text
