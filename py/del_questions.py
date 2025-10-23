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
        ds_id = "UrbanAccuracy"
        uids = ['f1568c56-3fac-4aaf-bd9f-5804f990f472',
 'd87462e1-8dcd-4293-9074-0084eee7467b',
 'e662cff1-8b21-439f-b540-2919ee72a3d5',
 '60800084-f808-4876-b086-b73df98afe2a',
 '3b6440fd-da92-4f08-b0a6-46565f3eb2d9']

    elif len(sys.argv) != 3:
        sys.exit("usage: delete_dataset.py <dataset-id> <uids>")
    else:
        ds_id = sys.argv[1]
    main(ds_id, uids)
