"""
Selective opinion_id -> cluster_id map.
Prefer --wanted-opinions (exact IDs) with early-stop once all found.
Fallback --wanted (cluster IDs) requires full scan.
"""
from __future__ import annotations

import argparse
import bz2
import csv
import json
import sqlite3
import sys
import urllib.request

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def open_source(args):
    if args.local:
        return bz2.open(args.local, "rt", encoding="utf-8", errors="replace", newline="")
    req = urllib.request.Request(args.s3_url, headers={"User-Agent": "nyayagrid-corpus-graph-fallback"})
    raw = urllib.request.urlopen(req, timeout=180)
    return bz2.open(raw, "rt", encoding="utf-8", errors="replace", newline="")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--wanted", default=None, help="JSON list of cluster IDs")
    p.add_argument("--wanted-opinions", default=None, help="JSON list of opinion IDs (preferred)")
    p.add_argument("--out", required=True)
    p.add_argument("--local", default=None)
    p.add_argument(
        "--s3-url",
        default="https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinions-2026-09-30.csv.bz2",
    )
    args = p.parse_args()

    wanted_opinions = None
    wanted_clusters = None
    if args.wanted_opinions:
        wanted_opinions = set(str(x) for x in json.load(open(args.wanted_opinions, encoding="utf-8")))
    elif args.wanted:
        wanted_clusters = set(str(x) for x in json.load(open(args.wanted, encoding="utf-8")))
    else:
        raise SystemExit("need --wanted or --wanted-opinions")

    print(
        json.dumps(
            {
                "phase": "START",
                "mode": "opinions" if wanted_opinions is not None else "clusters",
                "wanted": len(wanted_opinions or wanted_clusters or []),
                "source": "local" if args.local else "s3",
            }
        ),
        flush=True,
    )

    conn = sqlite3.connect(args.out)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("DROP TABLE IF EXISTS opinion_cluster")
    conn.execute("CREATE TABLE opinion_cluster (opinion_id TEXT PRIMARY KEY, cluster_id TEXT NOT NULL)")
    conn.execute("CREATE INDEX idx_oc_cluster ON opinion_cluster(cluster_id)")

    f = open_source(args)
    reader = csv.reader(f, doublequote=False, escapechar="\\")
    header = next(reader)
    id_i = header.index("id")
    cl_i = header.index("cluster_id")
    print(json.dumps({"phase": "HEADER", "ncols": len(header), "id_i": id_i, "cl_i": cl_i}), flush=True)

    rows = kept = short = 0
    batch = []
    remaining = set(wanted_opinions) if wanted_opinions is not None else None

    for row in reader:
        rows += 1
        if rows % 200000 == 0:
            if batch:
                conn.executemany(
                    "INSERT OR IGNORE INTO opinion_cluster(opinion_id, cluster_id) VALUES (?, ?)", batch
                )
                conn.commit()
                batch.clear()
            print(
                json.dumps(
                    {
                        "phase": "PROGRESS",
                        "rows": rows,
                        "kept": kept,
                        "short": short,
                        "remaining": len(remaining) if remaining is not None else None,
                    }
                ),
                flush=True,
            )
        if len(row) <= max(id_i, cl_i):
            short += 1
            continue
        oid = row[id_i].strip()
        cid = row[cl_i].strip()
        del row
        if not oid or not cid or not oid.isdigit():
            continue

        if remaining is not None:
            if oid not in remaining:
                continue
            remaining.discard(oid)
            batch.append((oid, cid))
            kept += 1
            if not remaining:
                if batch:
                    conn.executemany(
                        "INSERT OR IGNORE INTO opinion_cluster(opinion_id, cluster_id) VALUES (?, ?)", batch
                    )
                    conn.commit()
                print(json.dumps({"phase": "EARLY_STOP", "rows": rows, "kept": kept}), flush=True)
                break
        else:
            if cid not in wanted_clusters:
                continue
            batch.append((oid, cid))
            kept += 1

        if len(batch) >= 200:
            conn.executemany("INSERT OR IGNORE INTO opinion_cluster(opinion_id, cluster_id) VALUES (?, ?)", batch)
            conn.commit()
            batch.clear()

    if batch:
        conn.executemany("INSERT OR IGNORE INTO opinion_cluster(opinion_id, cluster_id) VALUES (?, ?)", batch)
        conn.commit()
    f.close()
    stored = conn.execute("SELECT count(*) FROM opinion_cluster").fetchone()[0]
    conn.close()
    print(
        json.dumps(
            {
                "phase": "DONE",
                "rows": rows,
                "kept": kept,
                "short": short,
                "stored": stored,
                "unfound": len(remaining) if remaining is not None else None,
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(json.dumps({"phase": "ERROR", "error": str(e)}), flush=True)
        raise
