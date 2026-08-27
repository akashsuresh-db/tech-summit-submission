CREATE OR REFRESH MATERIALIZED VIEW gold_nba_recommendations
AS
WITH candidates AS (
  SELECT
    customer_id,
    attrition_risk_score,
    candidate_cross_sell_product_id,
    current_rate_apy,
    GREATEST(COALESCE(atrisk_balance_usd, 0), COALESCE(balance_at_risk_usd, 0)) AS eff_bal,
    -- retention_offer
    GREATEST(COALESCE(atrisk_balance_usd, 0), COALESCE(balance_at_risk_usd, 0)) * 0.025 * 3 * LEAST(0.9, 0.45 + attrition_risk_score * 0.4) AS ret_retained,
    GREATEST(COALESCE(atrisk_balance_usd, 0), COALESCE(balance_at_risk_usd, 0)) * GREATEST(0.001, 0.0385 - COALESCE(current_rate_apy, 0.03)) AS ret_cost,
    -- cross_sell
    GREATEST(COALESCE(atrisk_balance_usd, 0), COALESCE(balance_at_risk_usd, 0)) * 0.025 * 3 * GREATEST(0.1, 0.6 - attrition_risk_score * 0.5) + 1200 AS xs_retained,
    -- rm_outreach
    GREATEST(COALESCE(atrisk_balance_usd, 0), COALESCE(balance_at_risk_usd, 0)) * 0.025 * 3 * GREATEST(0.05, 0.4 - attrition_risk_score * 0.35) AS rm_retained
  FROM gold_open_atrisk
),
scored AS (
  SELECT
    customer_id,
    attrition_risk_score,
    candidate_cross_sell_product_id,
    current_rate_apy,
    eff_bal,
    ret_retained,
    ret_cost,
    0.0 AS ret_margin,
    ret_retained - ret_cost AS ret_net,
    xs_retained,
    50.0 AS xs_cost,
    0.0 AS xs_margin,
    xs_retained - 50.0 AS xs_net,
    rm_retained,
    40.0 AS rm_cost,
    0.0 AS rm_margin,
    rm_retained - 40.0 AS rm_net,
    CASE
      WHEN (ret_retained - ret_cost) >= (xs_retained - 50.0)
        AND (ret_retained - ret_cost) >= (rm_retained - 40.0) THEN 'retention_offer'
      WHEN (xs_retained - 50.0) >= (rm_retained - 40.0) THEN 'cross_sell'
      ELSE 'rm_outreach'
    END AS recommended_action
  FROM candidates
)
SELECT
  customer_id,
  recommended_action,
  CASE WHEN recommended_action = 'cross_sell' THEN candidate_cross_sell_product_id END AS recommended_offer_product_id,
  CASE WHEN recommended_action = 'retention_offer' THEN 0.0385 END AS recommended_rate_apy,
  CASE recommended_action
    WHEN 'retention_offer' THEN ret_retained
    WHEN 'cross_sell' THEN xs_retained
    ELSE rm_retained
  END AS predicted_retained_usd,
  CASE recommended_action
    WHEN 'retention_offer' THEN ret_net
    WHEN 'cross_sell' THEN xs_net
    ELSE rm_net
  END AS predicted_net_value_usd,
  to_json(
    array(
      named_struct('action', 'retention_offer', 'retained_usd', ret_retained, 'net_usd', ret_net, 'cost_usd', ret_cost),
      named_struct('action', 'cross_sell', 'retained_usd', xs_retained, 'net_usd', xs_net, 'cost_usd', xs_cost),
      named_struct('action', 'rm_outreach', 'retained_usd', rm_retained, 'net_usd', rm_net, 'cost_usd', rm_cost)
    )
  ) AS action_ranking,
  current_timestamp() AS scored_at
FROM scored
