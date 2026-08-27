#!/usr/bin/env python3
"""Build 1 · Lakebase — Reverse Lakehouse Sync (Postgres -> Delta, SCD Type 2).

Streams changes in the writable Lakebase table app.rm_actions back into a governed
Unity Catalog Delta table (akash_fevm_ts_catalog.meridian_bank.rm_actions_history),
keeping full SCD Type 2 history + appended system-metadata columns.

The Lakebase Autoscaling tier does not (yet) offer a managed Postgres->Delta synced
table, so this job implements the same contract as code (per the Build-1 brief:
"define the sync as code with Databricks Asset Bundles or Terraform, not UI-only").
It is deployed as a scheduled Databricks job via databricks.yml (job: rm_actions_reverse_sync).

SCD2 semantics:
  - effective_from / effective_to / is_current version each row by business key `id`.
  - A changed row closes its current version (is_current=false, effective_to=now) and
    inserts a new current version.
  - System metadata appended: _synced_at, _source, _row_hash, _operation.

Usage:
  python lakebase/reverse_sync_scd2.py --profile fe-vm-akash-fevm-ts --warehouse a92bf2222d618a1f
"""
import argparse, json, subprocess
from databricks import sql as dbsql
import psycopg

TARGET = "akash_fevm_ts_catalog.meridian_bank.rm_actions_history"
BUSINESS_COLS = ["id","customer_id","action_type","offered_product_id","rate_apy",
                 "drafted_note","predicted_retained_usd","status","approved_by",
                 "outreach_channel","followup_due_at","decided_at"]


def cli_json(a):
    return json.loads(subprocess.run(a, capture_output=True, text=True).stdout)


def pg_rows(profile, project, branch, endpoint):
    base = f"projects/{project}/branches/{branch}"
    host = cli_json(["databricks","postgres","list-endpoints",base,"-p",profile,"-o","json"])[0]["status"]["hosts"]["host"]
    token = cli_json(["databricks","postgres","generate-database-credential",f"{base}/endpoints/{endpoint}","-p",profile,"-o","json"])["token"]
    email = cli_json(["databricks","current-user","me","-p",profile,"-o","json"])["userName"]
    with psycopg.connect(host=host, port=5432, dbname="databricks_postgres", user=email,
                         password=token, sslmode="require") as c, c.cursor() as cur:
        cur.execute(f"SELECT {','.join(BUSINESS_COLS)}, "
                    f"md5(ROW({','.join(BUSINESS_COLS[1:])})::text) AS _row_hash FROM app.rm_actions")
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def wh(profile, warehouse):
    d = cli_json(["databricks","auth","describe","-p",profile,"-o","json"])
    hostname = d["details"]["host"].replace("https://","").rstrip("/")
    token = cli_json(["databricks","auth","token","-p",profile])["access_token"]
    return dbsql.connect(server_hostname=hostname, http_path=f"/sql/1.0/warehouses/{warehouse}", access_token=token)


def sqlval(v):
    if v is None: return "NULL"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--warehouse", required=True)
    ap.add_argument("--project", default="meridian-bank")
    ap.add_argument("--branch", default="production")
    ap.add_argument("--endpoint", default="primary")
    a = ap.parse_args()

    rows = pg_rows(a.profile, a.project, a.branch, a.endpoint)
    print(f"read {len(rows)} rows from Lakebase app.rm_actions")
    conn = wh(a.profile, a.warehouse); cur = conn.cursor()

    # 1) target table with SCD2 + system-metadata columns
    cur.execute(f"""CREATE TABLE IF NOT EXISTS {TARGET} (
        id STRING, customer_id STRING, action_type STRING, offered_product_id STRING,
        rate_apy DOUBLE, drafted_note STRING, predicted_retained_usd DOUBLE, status STRING,
        approved_by STRING, outreach_channel STRING, followup_due_at TIMESTAMP, decided_at TIMESTAMP,
        effective_from TIMESTAMP, effective_to TIMESTAMP, is_current BOOLEAN,
        _row_hash STRING, _synced_at TIMESTAMP, _source STRING, _operation STRING
    ) USING DELTA TBLPROPERTIES (delta.enableChangeDataFeed = true)""")

    # 2) stage the current Postgres snapshot as a temp view
    values = []
    for r in rows:
        vals = [sqlval(r[c]) for c in BUSINESS_COLS] + [sqlval(r["_row_hash"])]
        values.append("(" + ",".join(vals) + ")")
    cols_ddl = ",".join(BUSINESS_COLS + ["_row_hash"])
    cur.execute(f"CREATE OR REPLACE TEMP VIEW rm_actions_stage ({cols_ddl}) AS VALUES {','.join(values)}")

    # 3a) close changed current versions
    cur.execute(f"""MERGE INTO {TARGET} t
        USING rm_actions_stage s ON t.id = s.id AND t.is_current = true
        WHEN MATCHED AND t._row_hash <> s._row_hash THEN
          UPDATE SET t.is_current = false, t.effective_to = current_timestamp()""")
    # 3b) insert new + changed rows as the new current version
    set_cols = ",".join(BUSINESS_COLS)
    src_cols = ",".join("s." + c for c in BUSINESS_COLS)
    cur.execute(f"""MERGE INTO {TARGET} t
        USING rm_actions_stage s ON t.id = s.id AND t.is_current = true
        WHEN NOT MATCHED THEN INSERT ({set_cols}, effective_from, effective_to, is_current,
                                      _row_hash, _synced_at, _source, _operation)
        VALUES ({src_cols}, current_timestamp(), NULL, true,
                s._row_hash, current_timestamp(), 'lakebase:app.rm_actions', 'upsert')""")

    cur.execute(f"SELECT count(*) total, sum(CASE WHEN is_current THEN 1 ELSE 0 END) current_versions FROM {TARGET}")
    total, current = cur.fetchone()
    print(f"{TARGET}: {total} total version rows, {current} current")
    cur.close(); conn.close()


if __name__ == "__main__":
    main()
