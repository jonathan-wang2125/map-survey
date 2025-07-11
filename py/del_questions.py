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

        # user responses + submission markers
        for pid in assigned_users:
            pid = pid.decode() if isinstance(pid, bytes) else pid
            keys_to_del.add(f"v1:{pid}:{ds}:{uid}")

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
        ds_id = "AviationAccuracy"
        uids = ['19364623-13d2-4b82-84bb-fbda5d2a2f34', '1fb4e12c-0080-489a-b41e-698865b01c83', '56281688-1a1a-40ff-a694-a30c4f424df8', '0a445061-d63f-4b4b-a250-3898bc25eb0e', 'f3f959af-23b2-4562-a208-1f6d171a024d', '6f837678-942a-476f-92cb-e4045a435a9c', '0cea9fab-031e-49f6-855c-6e2b074d52a1', 'ed8f137b-bcd6-420c-aed7-c4631c5a633c', '10fab28f-8b49-46f9-80ae-1df361226442', '0c7cb3bb-bed8-488d-8d9e-c5ea3217f549', '40cc275d-d90b-49bd-b169-62fad9d70f8f', '51d0ee0b-66cd-4a0b-867f-a47f8a27e901', '2cafb767-6636-4ff8-8893-7b7d109014c8', '7c1f8785-eb48-454d-bd95-f6b628415437', 'ef02d9cb-e750-4124-aea9-7d2a4eeee97b', 'f41bf92e-7927-4a77-8d15-7cdd14af3af6', 'b9b8ee11-1d32-4ecc-806a-bbb1f3fbdbc0', '3cb01182-7239-4996-a642-7714b5d57dd3', '1a30ad23-695f-48b2-a9df-6e30feebe8c1', 'db6b7eb6-cfd4-466f-948b-0565340a3bbf', 'a62505d8-0403-4557-be67-3cfc320f1501']
    elif len(sys.argv) != 3:
        sys.exit("usage: delete_dataset.py <dataset-id> <uids>")
    else:
        ds_id = sys.argv[1]
    main(ds_id, uids)
