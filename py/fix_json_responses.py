#!/usr/bin/env python3
"""
normalize_answers.py
────────────────────
Rewrite every stored answer so it contains *only* these fields
and in this order:

    {
        "uid":            …,
        "prolificID":     …,
        "dataset":        …,
        "questionIndex":  …,
        "question":       …,
        "answer":         …,
        "difficulty":     …,
        "badQuestion":    …,
        "badReason":      …,
        "origTimestamp":  …,
        "editTimestamp":  …   # ← kept only if it already exists
    }

• If `origTimestamp` is missing but a legacy `timestamp` field exists,
  the latter is renamed.
• Any other keys are dropped.
"""

from __future__ import annotations
from collections import OrderedDict
import json, time, sys, redis
from tqdm import tqdm
from typing import Any, Dict

# ──────────────────────────────────────────────────────────────────────────
REDIS_URL   = "redis://localhost:6379/0"
BATCH_SIZE  = 5_000
USER_SET    = "v1:usernames"        # where all PIDs live
META_SUFFIX = b":meta"
# ──────────────────────────────────────────────────────────────────────────

def require_uid(old: Dict[str, Any]) -> str:
    """Return uid (or QID), or raise ValueError if neither exists."""
    uid = old.get("uid") or old.get("QID")
    if not uid:
        raise ValueError("record missing 'uid' / 'QID'")
    return uid

def transform(old: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert an *old* answer object into the canonical format.
    Uses OrderedDict so json.dumps keeps the key order (purely cosmetic).
    """
    uid = require_uid(old) 

    # Work out the two timestamps first
    orig_ts = (
        old.get("origTimestamp")
        or old.get("timestamp")          # legacy name
        or int(time.time() * 1000)       # never happened, but stay safe
    )

    new = OrderedDict([
        ("uid",           uid),
        ("prolificID",    old.get("prolificID")),
        ("dataset",       old.get("dataset")),
        ("questionIndex", old.get("questionIndex")),
        ("question",      old.get("question") or old.get("Question")),
        ("answer",        old.get("answer")),
        ("difficulty",    old.get("difficulty")),
        ("badQuestion",   bool(old.get("badQuestion", False))),
        ("badReason",     old.get("badReason", "")),
        ("origTimestamp", orig_ts),
    ])

    # Preserve LAST-edit time if the record already has it
    if "editTimestamp" in old:
        new["editTimestamp"] = old["editTimestamp"]

    return new


def main() -> None:
    r = redis.Redis.from_url(REDIS_URL, decode_responses=False)

    # 1. Grab every known user
    pids = r.smembers(USER_SET)
    if not pids:
        print("No pids found in v1:usernames."); return

    total_processed = 0

    with r.pipeline() as pipe:
        pending = 0
        for pid_b in tqdm(pids, desc="PIDs"):
            pid = pid_b.decode() if isinstance(pid_b, bytes) else pid_b
            pattern = f"v1:{pid}:*:*"            # answers + markers

            for key in r.scan_iter(match=pattern, count=10_000):
                # Skip submission markers
                if key.endswith(META_SUFFIX):
                    continue

                raw = r.get(key)
                if not raw:
                    continue

                try:
                    obj       = json.loads(raw)
                    upgraded  = transform(obj)   # may raise ValueError
                except ValueError as ve:
                    print(f"\n❌  {key.decode()}: {ve}", file=sys.stderr)
                    sys.exit(1)
                except Exception as exc:
                    print(f"\n⚠️  Bad JSON in {key!r}: {exc}", file=sys.stderr)
                    continue

                pipe.set(key, json.dumps(upgraded))
                pending += 1; total_processed += 1

                if pending >= BATCH_SIZE:
                    pipe.execute(); pending = 0

        if pending:
            pipe.execute()

    print(f"Done – normalised {total_processed:,} answers.")


if __name__ == "__main__":
    main()