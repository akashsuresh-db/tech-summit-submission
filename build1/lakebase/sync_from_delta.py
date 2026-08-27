#!/usr/bin/env python3
"""Build 1 · Lakebase — sync governed UC Delta gold tables → Lakebase Postgres mirrors.

Reads the governed gold tables in akash_fevm_ts_catalog.meridian_bank via a Databricks
SQL warehouse and bulk-loads them into the read-only mirror tables in Lakebase
(app.customer_position / open_atrisk / nba_recommendations / products).

Idempotent: TRUNCATE + reload each mirror. The app never writes these tables.

Usage:
  python lakebase/sync_from_delta.py --profile fe-vm-akash-fevm-ts \
      --warehouse a92bf2222d618a1f \
      --project meridian-bank --branch production --endpoint primary
"""
import argparse, json, subprocess, sys
from databricks import sql as dbsql
import psycopg

CATALOG = "akash_fevm_ts_catalog"
SCHEMA = "meridian_bank"
VOLUME = f"/Volumes/{CATALOG}/{SCHEMA}/raw_data"


def cli_json(args):
    out = subprocess.run(args, capture_output=True, text=True)
    return json.loads(out.stdout)


def pg_conn(profile, project, branch, endpoint):
    base = f"projects/{project}/branches/{branch}"
    host = cli_json(["databricks", "postgres", "list-endpoints", base,
                     "-p", profile, "-o", "json"])[0]["status"]["hosts"]["host"]
    token = cli_json(["databricks", "postgres", "generate-database-credential",
                      f"{base}/endpoints/{endpoint}", "-p", profile, "-o", "json"])["token"]
    email = cli_json(["databricks", "current-user", "me", "-p", profile, "-o", "json"])["userName"]
    return psycopg.connect(host=host, port=5432, dbname="databricks_postgres",
                           user=email, password=token, sslmode="require", autocommit=True)


def wh(profile, warehouse):
    host = cli_json(["databricks", "auth", "env", "-p", profile]).get("env", {}).get(
        "DATABRICKS_HOST") if False else None
    prof = cli_json(["databricks", "current-user", "me", "-p", profile, "-o", "json"])
    hostname = subprocess.run(["databricks", "auth", "describe", "-p", profile, "-o", "json"],
                              capture_output=True, text=True).stdout
    hostname = json.loads(hostname)["details"]["host"].replace("https://", "").rstrip("/")
    token = cli_json(["databricks", "auth", "token", "-p", profile])["access_token"]
    return dbsql.connect(server_hostname=hostname,
                         http_path=f"/sql/1.0/warehouses/{warehouse}",
                         access_token=token)


# (mirror table, source SELECT, target columns in COPY order)
TABLES = {
    "customer_position": (
        f"""SELECT customer_id, tier, tenure_years, home_metro, customer_lat, customer_lng,
               profile_summary, attrition_risk_score, balance_outflow_30d_usd,
               CAST(churn_signal_score AS DOUBLE) churn_signal_score, total_balance_usd,
               deposit_balance_usd, affected_deposit_balance_usd, min_days_to_maturity,
               CAST(product_count AS INT) product_count, balance_at_risk_usd,
               revenue_at_risk_usd, risk_band
        FROM {CATALOG}.{SCHEMA}.gold_customer_position""",
        ["customer_id","tier","tenure_years","home_metro","customer_lat","customer_lng",
         "profile_summary","attrition_risk_score","balance_outflow_30d_usd","churn_signal_score",
         "total_balance_usd","deposit_balance_usd","affected_deposit_balance_usd",
         "min_days_to_maturity","product_count","balance_at_risk_usd","revenue_at_risk_usd","risk_band"],
    ),
    "open_atrisk": (
        f"""SELECT customer_id, attrition_risk_score, balance_at_risk_usd, revenue_at_risk_usd,
               atrisk_product_id, atrisk_balance_usd, days_to_maturity, current_rate_apy,
               candidate_cross_sell_product_id
        FROM {CATALOG}.{SCHEMA}.gold_open_atrisk""",
        ["customer_id","attrition_risk_score","balance_at_risk_usd","revenue_at_risk_usd",
         "atrisk_product_id","atrisk_balance_usd","days_to_maturity","current_rate_apy",
         "candidate_cross_sell_product_id"],
    ),
    "nba_recommendations": (
        f"""SELECT customer_id, recommended_action, recommended_offer_product_id,
               CAST(recommended_rate_apy AS DOUBLE) recommended_rate_apy,
               predicted_retained_usd, predicted_net_value_usd, action_ranking,
               CAST(scored_at AS STRING) scored_at
        FROM {CATALOG}.{SCHEMA}.gold_nba_recommendations""",
        ["customer_id","recommended_action","recommended_offer_product_id","recommended_rate_apy",
         "predicted_retained_usd","predicted_net_value_usd","action_ranking","scored_at"],
    ),
    "products": (
        f"""SELECT product_id, product_name, product_type, segment,
               CAST(rate_apy AS DOUBLE) rate_apy, CAST(min_balance_usd AS DOUBLE) min_balance_usd,
               description, COALESCE(is_active, true) is_active
        FROM read_files('{VOLUME}/products', format=>'parquet')""",
        ["product_id","product_name","product_type","segment","rate_apy","min_balance_usd",
         "description","is_active"],
    ),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--warehouse", required=True)
    ap.add_argument("--project", default="meridian-bank")
    ap.add_argument("--branch", default="production")
    ap.add_argument("--endpoint", default="primary")
    a = ap.parse_args()

    wconn = wh(a.profile, a.warehouse)
    pconn = pg_conn(a.profile, a.project, a.branch, a.endpoint)

    for tbl, (query, cols) in TABLES.items():
        with wconn.cursor() as wc:
            wc.execute(query)
            rows = wc.fetchall()
        with pconn.cursor() as pc:
            pc.execute(f"TRUNCATE app.{tbl}")
            collist = ",".join(cols)
            with pc.copy(f"COPY app.{tbl} ({collist}) FROM STDIN") as cp:
                for r in rows:
                    cp.write_row([None if v is None else v for v in r])
            pc.execute(f"SELECT count(*) FROM app.{tbl}")
            n = pc.fetchone()[0]
        print(f"  synced app.{tbl:22} <- {len(rows):>6} rows  (now {n} in PG)")

    wconn.close(); pconn.close()
    print("Sync complete.")


if __name__ == "__main__":
    main()
