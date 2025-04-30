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

def notify_server_delete(ds_id: str) -> None:
    """Call DELETE /admin/dataset/:id so server globals stay in sync."""
    try:
        r = requests.delete(f"{SERVER_URL}/admin/dataset/{ds_id}", timeout=5)
        if r.status_code in (200, 404):
            # 404 just means the server had no record – fine.
            print("Server cache updated")
        else:
            print(f"Server responded {r.status_code}: {r.text}")
    except requests.RequestException as e:
        print(f"Could not reach the server at {SERVER_URL}: {e}")

def main(ds: str) -> None:
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

    # dataset-level keys
    keys_to_del.update([
        f"v1:datasets:{ds}",
        f"v1:datasets:{ds}:meta",
        f"v1:assignments:{ds}",           # user list for this ds
    ])
    # question objects
    for uid in r.smembers(f"v1:datasets:{ds}"):
        uid = uid.decode() if isinstance(uid, bytes) else uid
        keys_to_del.add(f"v1:datasets:{ds}:{uid}")

    # user responses + submission markers
    for pid in assigned_users:
        pattern = f"v1:{pid}:{ds}:*"
        keys_to_del.update(k.decode() if isinstance(k, bytes) else k
                           for k in r.scan_iter(match=pattern))

    pattern_all = f"v1:*:{ds}:*"
    keys_to_del.update(
        k.decode() if isinstance(k, bytes) else k
        for k in r.scan_iter(match=pattern_all)
    )

    meta_key = f"v1:campaigns:{ds}:meta"
    if meta_key in keys_to_del:
        keys_to_del.remove(meta_key)

    # campaign set entry
    # if topic:
    #     keys_to_del.append(f"v1:campaigns:{topic}:meta")  # we’ll rewrite later
    #     # dataset entry in the set will be handled with SREM, not DEL

    # ── show summary & confirm ----------------------------------------
    print(f"Dataset : {ds}")
    print(f"Topic    : {topic or 'unknown'}")
    print(f"Users    : {len(assigned_users)}")
    print(assigned_users)
    print(f"Redis keys to delete: {len(keys_to_del):,}")
    print(keys_to_del)
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
    pipe.srem("v1:datasets", ds)               # global dataset registry
    for pid in assigned_users:                 # user assignment sets
        pid = pid.decode() if isinstance(pid, bytes) else pid
        pipe.srem(f"v1:assignments:{pid}", ds)
    if topic:                                  # campaign’s dataset list
        pipe.srem(f"v1:campaigns:{topic}", ds)
    pipe.execute()

    notify_server_delete(ds_id)
    print("Finished – dataset and all responses removed.")

if __name__ == "__main__":
    if len(sys.argv) == 1:
        ds_id = "Test"
    elif len(sys.argv) != 2:
        sys.exit("usage: delete_dataset.py <dataset-id>")
    else:
        ds_id = sys.argv[1]
    main(ds_id)
