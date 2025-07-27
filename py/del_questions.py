#!/usr/bin/env python3
"""
delete_dataset.py  –  wipe a whole dataset *and* every user response to it.

Usage:
    python delete_dataset.py <dataset-id>

Safety nets
-----------
* Prompts for confirmation and prints how many keys will be removed.
* Uses SCAN + pipeline so it can handle millions of keys without blocking Redis.
"""

import sys, redis, json, requests
from tqdm import tqdm                     # pip install tqdm (nice progress bar)

REDIS_URL   = "redis://localhost:6397/0"
SERVER_URL = "http://localhost:3000"
BATCH_SIZE  = 5_000                       # pipeline flush size

# given a list of uids
# delete uids from v1:<user_name>:<ds>:<uid>
# delete uids from v1:datasets:<ds>:<uid>

def main(ds: str, uids: list) -> None:
    r = redis.Redis.from_url(REDIS_URL, decode_responses=False)

    # ── gather auxiliary info (topic, assigned users) ─────────────────
    meta_raw = r.get(f"v1:datasets:{ds}:meta")
    topic = None
    if meta_raw:
        try: topic = json.loads(meta_raw)["topic"]
        except Exception: pass

    assigned_users = r.smembers(f"v1:assignments:{ds}")

    # ── build key list to delete --------------------------------------
    keys_to_del: set[str] = set()

    # question objects
    for uid in uids:
        keys_to_del.add(f"v1:datasets:{ds}:{uid}")
        print(f"v1:datasets:{ds}:{uid}")

        # user responses + submission markers
        for pid in assigned_users:
            pid = pid.decode() if isinstance(pid, bytes) else pid
            keys_to_del.add(f"v1:{pid}:{ds}:{uid}")
            print(f"v1:{pid}:{ds}:{uid}")

    # ── show summary & confirm ----------------------------------------
    print(f"Dataset : {ds}")
    print(f"Users    : {len(assigned_users)}")
    print(assigned_users)
    print(f"Redis keys to delete: {len(keys_to_del):,}")
    if input("Proceed? [y/N] ").strip().lower() != "y":
        print("Aborted.")
        return

    # ── delete keys in batches ----------------------------------------
    with r.pipeline() as pipe:
        pending = 0
        for k in tqdm(keys_to_del, unit="key"):
            pipe.delete(k)
            pending += 1
            if pending >= BATCH_SIZE:
                pipe.execute(); pending = 0
        if pending:
            pipe.execute()

    # ── remove entries from various sets ------------------------------
    pipe = r.pipeline()
    for uid in uids:
        pipe.srem(f"v1:datasets:{ds}", uid)
    pipe.execute()

    print("Finished – uids and all responses removed.")

if __name__ == "__main__":
    if len(sys.argv) == 1:
        ds_id = "NaturalWorldAccuracy"
        uids = ['6d70fc39-7e2a-4e99-90e2-dd27b7d490ae',
                '72be3576-56a8-4ce2-ba49-edffe6bcc877',
                '8cc51377-656d-462d-a632-48f476a678df',
                'a01fbfff-f9bb-4722-9f81-088cf36877d9',
                'a70ba896-7215-4e3b-b1db-545c5a850b41',
                'b10f8961-be22-4d47-a0fd-93603117bee5',
                'eedd5993-29fb-4687-9a5e-b0f245b9cbdf',
                'f10029c3-1cf4-4f4e-9e5b-bbec9e8c28c5',
                'f357ca08-9ec6-47b4-a336-21de2fd3f970'
                ]

    elif len(sys.argv) != 3:
        sys.exit("usage: delete_dataset.py <dataset-id> <uids>")
    else:
        ds_id = sys.argv[1]
    main(ds_id, uids)
