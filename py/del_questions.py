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
        ds_id = "NaturalWorld_4"
        uids = ["761f792a-7953-47b3-96c0-3f1d87b83f24",
"6bc5578d-4fe9-4329-9af8-4a500be91e9d",
"90cc430f-1dcb-46fe-9283-15b57d7207e1",
"42aaeb52-bb74-45bf-8aee-8831bddfcf96",
"9bb3734a-4709-4d52-a29a-f7cf19eb5a3a",
"fd44daa8-5691-46e2-b42a-7e821ed8ae86",
"cf5bcec0-40ab-4138-9bc9-5c84c5091995",
"39b122dd-0c30-459b-9ce0-2bdf36742c4e",
"be92040a-2116-4dac-806f-27676677cf90",
"47603095-79ce-4504-925f-d453c74c3bb3",
"4191b1f4-a168-41b8-805a-65f0a869ba80",
"9549372d-9e90-4559-87dd-5f7a946595b0",
"eaf9bade-57cc-46bb-acee-7ea073e9d5d5",
"34f8d897-4f66-4c42-a3e2-c5dc51090618",
"7a75371b-5b9e-4e1f-a531-c7a5f205273a",
"90fca476-0651-4b40-9183-609e6b862889",
"00b575d3-7a84-43a9-aaf4-f44822821b20",
"6b783223-0c11-477b-bbe4-9fc87c69372f",
"27566716-3243-43f0-bbc2-a8b0eaa1b0e8",
"cf2523ac-36d2-44a5-ae50-80a38691cf06",
"289c472b-7488-43a6-9707-f7b0835adae1",
"bdd34cee-9c00-442a-9cfc-046d6f68e00d",
"f62b31d3-c578-4c6a-8d37-b7dcc481282e",
"92b3cea3-a6eb-4258-8959-7d7c4001b73e",
"1026831d-6ae3-4382-b284-7e165f3add10",
"a470c3d6-f985-4190-99ba-9379b1b14612",
"348916fd-9ea1-49c1-a97a-7c318cfd8e90",
"a68f26f6-83ed-422c-b0bf-dd25f5be7894",
"a5e449f6-e750-4c0d-a6b2-69f87fff7d8c",
"72f0f6cb-9ae0-49f0-8fed-0a82473a3b99",
                ]

    elif len(sys.argv) != 3:
        sys.exit("usage: delete_dataset.py <dataset-id> <uids>")
    else:
        ds_id = sys.argv[1]
    main(ds_id, uids)
