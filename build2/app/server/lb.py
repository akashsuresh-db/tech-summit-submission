"""Lakebase (Postgres) access for the Meridian app — pure-Python pg8000 driver.

Single source of truth for data: the `app.*` schema on the shared Meridian Bank
Lakebase (project meridian-bank / branch production / endpoint primary). No Delta
/ SQL-warehouse dependency at runtime.

pg8000 (pure Python) is used instead of psycopg[binary] so the Databricks Apps
build never has to compile / download a large binary wheel through the flaky proxy.

Auth:
  * Local dev  — Databricks CLI profile; Postgres user is the caller's email.
  * Deployed   — the app service principal via the SDK; Postgres user is the SP id.
Password is a short-lived OAuth credential (POST /api/2.0/postgres/credentials),
cached and refreshed before expiry.
"""
from __future__ import annotations

import os
import ssl
import json
import time
import threading
import subprocess

import pg8000.dbapi

PROJECT = os.getenv("LAKEBASE_PROJECT", "meridian-bank")
BRANCH = os.getenv("LAKEBASE_BRANCH", "production")
ENDPOINT = os.getenv("LAKEBASE_ENDPOINT", "primary")
DBNAME = os.getenv("LAKEBASE_DB", "databricks_postgres")
PROFILE = os.getenv("DATABRICKS_CONFIG_PROFILE")
FALLBACK_HOST = "ep-gentle-wind-d2ydzmm4.database.us-east-1.cloud.databricks.com"
BRANCH_PATH = f"projects/{PROJECT}/branches/{BRANCH}"
ENDPOINT_PATH = f"{BRANCH_PATH}/endpoints/{ENDPOINT}"

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE  # sslmode=require: encrypt, don't verify

_lock = threading.Lock()
_conn = None
_exp = 0.0


def _cli_json(args):
    out = subprocess.run(["databricks", *args, "-p", PROFILE, "-o", "json"],
                         capture_output=True, text=True)
    return json.loads(out.stdout)


def _creds():
    if PROFILE:
        host = _cli_json(["postgres", "list-endpoints", BRANCH_PATH])[0]["status"]["hosts"]["host"]
        token = _cli_json(["postgres", "generate-database-credential", ENDPOINT_PATH])["token"]
        user = _cli_json(["current-user", "me"])["userName"]
        return host, user, token
    from databricks.sdk import WorkspaceClient
    w = WorkspaceClient()
    try:
        eps = w.api_client.do("GET", f"/api/2.0/postgres/{BRANCH_PATH}/endpoints")
        eps = eps if isinstance(eps, list) else eps.get("endpoints", eps.get("value", []))
        host = eps[0]["status"]["hosts"]["host"]
    except Exception:
        host = FALLBACK_HOST
    token = w.api_client.do("POST", "/api/2.0/postgres/credentials", body={"endpoint": ENDPOINT_PATH})["token"]
    user = os.getenv("DATABRICKS_CLIENT_ID") or w.current_user.me().user_name
    return host, user, token


def _connect():
    host, user, token = _creds()
    c = pg8000.dbapi.connect(user=user, host=host, port=5432, database=DBNAME,
                             password=token, ssl_context=_SSL)
    c.autocommit = True
    return c


def _get_conn():
    global _conn, _exp
    with _lock:
        now = time.time()
        if _conn is None or now > _exp:
            try:
                if _conn is not None:
                    _conn.close()
            except Exception:
                pass
            _conn = _connect()
            _exp = now + 45 * 60
        return _conn


def _rows(cur):
    cols = [d[0] for d in cur.description] if cur.description else []
    return [dict(zip(cols, r)) for r in cur.fetchall()] if cols else []


def _run(sql, params, want_rows):
    for attempt in (1, 2):
        try:
            conn = _get_conn()
            cur = conn.cursor()
            try:
                cur.execute(sql, params or ())
                return _rows(cur) if want_rows else None
            finally:
                cur.close()
        except (pg8000.dbapi.InterfaceError, pg8000.dbapi.OperationalError, OSError):
            global _conn, _exp
            with _lock:
                _conn, _exp = None, 0.0
            if attempt == 2:
                raise


def query(sql, params=None):
    return _run(sql, params, want_rows=True)


def execute(sql, params=None, returning=True):
    return _run(sql, params, want_rows=returning)
