Build 3 · Unity AI Gateway — submission3

gateway_service.txt        The model-service + inference-table creation script (endpoint
                           meridian-nba-gateway: external model -> databricks-gpt-5-5,
                           AI Gateway with inference table + PII guardrail + rate-limit budget).
app_inference_table.json   Export of the app's inference table: routed 200 calls, HTTP 429
                           budget/rate-limit blocks, and guardrail (PII) blocks — the gateway
                           actually handling calls, not just config.
gateway_usage.lvdash.json  Usage rollup the Unity Gateway dashboard shows: calls by status,
                           by requester, budget blocks, latency.
execution_proof.txt        Committed inference-table rows proving the gateway actually handled
                           and BLOCKED calls: a routed 200 (app SP), a 429 budget/rate-limit block,
                           and an input_guardrail block — all enforced by the gateway, not the app.
agent_thread.txt           Steps 6–8: route the coding agent + Slack MCP through the same
                           gateway (runs in the ucode/coding-agent environment).

LIVE + EVIDENCED: app routed through gateway, inference-table tracing, guardrail block (PII),
budget/rate-limit block (429). App: https://meridian-nba-7474646051057767.aws.databricksapps.com
