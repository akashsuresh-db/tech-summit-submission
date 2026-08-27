CREATE OR REFRESH MATERIALIZED VIEW note_churn_flags
AS
SELECT
  servicing_note_text,
  CASE ai_classify(servicing_note_text, ARRAY('churn_signal', 'at_risk', 'healthy'))
    WHEN 'churn_signal' THEN 1.0
    WHEN 'at_risk' THEN 0.6
    ELSE 0.1
  END AS churn_signal_score
FROM (
  SELECT DISTINCT servicing_note_text
  FROM read_files('/Volumes/akash_fevm_ts_catalog/meridian_bank/raw_data/risk_snapshots/')
  WHERE servicing_note_text IS NOT NULL
)
