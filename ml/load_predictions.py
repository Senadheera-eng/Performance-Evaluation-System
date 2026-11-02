"""Load ml/out/predictions.json into the database.

The load goes through the database function ml_load_predictions, signed in
with nothing but the app's public (anon) key. What lets it write is a
single-use token that expires within the hour: this script makes one, prints
the line of SQL that records its hash, and you run that line in the Supabase
SQL editor. Only the hash is stored, so the token itself never leaves this
machine, and no service key is needed.

Usage
-----
    python ml/load_predictions.py --new-token     # prints a token and the SQL for it
    ML_LOAD_TOKEN=<token> python ml/load_predictions.py

The project URL and anon key are read from pes_app/.env.local (or from the
VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables).
Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT.parent / "pes_app" / ".env.local"


def settings() -> tuple[str, str]:
    values = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    url, key = values.get("VITE_SUPABASE_URL"), values.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or create pes_app/.env.local")
    return url.rstrip("/"), key


def new_token() -> None:
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    print("Token (keep it to yourself; it works once, for one hour):\n")
    print(f"    {token}\n")
    print("Run this in the Supabase SQL editor:\n")
    print(f"    insert into public.ml_load_tokens (token_hash) values ('{digest}');\n")
    print("Then load:\n")
    print("    ML_LOAD_TOKEN=<token> python ml/load_predictions.py")


def load(payload_path: Path) -> None:
    url, key = settings()
    token = os.environ.get("ML_LOAD_TOKEN") or getpass.getpass("Load token: ")
    payload = json.loads(payload_path.read_text())
    body = json.dumps({"p_token": token.strip(), "p_payload": payload}).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/rpc/ml_load_predictions",
        data=body,
        method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            out = json.loads(res.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        try:
            detail = json.loads(detail).get("message", detail)
        except ValueError:
            pass
        sys.exit(f"Load refused ({e.code}): {detail}")
    print(f"Loaded {out['predictions']} predictions for Semester {payload['semester']} "
          f"from {len(payload['rows'])} in the file; model {out['model_id']} is now active.")
    if out["predictions"] != len(payload["rows"]):
        print("Some rows did not match a student or course; check the export is current.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--new-token", action="store_true", help="make a load token and print the SQL for it")
    ap.add_argument("--payload", type=Path, default=ROOT / "out" / "predictions.json")
    args = ap.parse_args()
    if args.new_token:
        new_token()
    else:
        load(args.payload)


if __name__ == "__main__":
    main()
