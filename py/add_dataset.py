#!/usr/bin/env python3
"""
add_dataset_to_redis.py
───────────────────────
Load a local **JSONL** file that belongs to a *campaign topic* and register
everything directly in Redis using the schema:

    v1:datasets:<ds>              SET(uids)
    v1:datasets:<ds>:<uid>        JSON(question)
    v1:datasets:<ds>:meta         JSON({label,description,topic})
    v1:datasets                   SET(all datasets)
    v1:campaigns:<topic>          SET(datasets in campaign)
    v1:campaigns:<topic>:meta     JSON({curIndex,numImages})

Run:
    python add_dataset_to_redis.py <topic> <index:int> <jsonl_path>

If the dataset already exists nothing is inserted.
"""

import sys, json, uuid, redis, requests
from pathlib import Path
from tqdm import tqdm               # purely for a nice progress bar

REDIS_URL  = "redis://localhost:6397/0"
SERVER_URL = "http://localhost:3000"
BATCH_SIZE = 5_000

def notify_server(ds_id: str, meta_payload: dict) -> None:
    """POST /admin/dataset"""
    meta_payload['id'] = ds_id
    try:
        r = requests.post(f"{SERVER_URL}/admin/dataset", json=meta_payload, timeout=5)
        if r.status_code == 409:
            print("Dataset already present in the server cache – skipping")
        elif not r.ok:
            print(f"Server /admin/dataset returned {r.status_code}: {r.text}")
            return
        else:
            print("Added dataset to server cache")
    except requests.RequestException as e:
        print(f"Could not reach the server at {SERVER_URL}: {e}")

def main(ds_id: str, topic: str, jsonl_file: Path) -> None:
    camp_set_key = f"v1:campaigns:{topic}"
    ds_set_key   = f"v1:datasets:{ds_id}"

    r = redis.Redis.from_url(REDIS_URL, decode_responses=False)

    if r.exists(ds_set_key):
        print(f"{ds_id} already exists – nothing to do.")
        return

    # ---------- read JSONL ----------
    print("Reading JSONL …")
    entries: list[dict] = []
    with jsonl_file.open(encoding="utf-8") as fh:
        for ln, line in enumerate(fh, 1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                sys.exit(f"{jsonl_file}:{ln} – bad JSON ({e})")
            obj.setdefault("uid", str(uuid.uuid4()))
            entries.append(obj)

    if not entries:
        sys.exit(f"{jsonl_file} contained no valid entries.")

    # ---------- redis pipeline ----------
    print("Writing to Redis …")
    pipe, pending = r.pipeline(), 0
    for q in tqdm(entries, unit="q"):
        uid = q["uid"]
        pipe.sadd(ds_set_key, uid)
        pipe.set(f"{ds_set_key}:{uid}", json.dumps(q).encode())
        pending += 1
        if pending >= BATCH_SIZE:
            pipe.execute(); pending = 0
    if pending:
        pipe.execute()

    # ---------- register dataset + campaign links ----------
    meta_payload = {
        "label":       f"{topic} Map Questions {ds_id}",
        "description": "",
        "topic":       topic
    }

    pipe = r.pipeline()
    pipe.sadd("v1:datasets", ds_id)
    pipe.sadd(camp_set_key, ds_id)
    pipe.set(f"v1:datasets:{ds_id}:meta", json.dumps(meta_payload).encode())

    camp_meta_key = f"{camp_set_key}:meta"
    camp_raw      = r.get(camp_meta_key)
    if not camp_raw:
        camp_meta = {"curIndex": 0, "numImages": 0}
        pipe.set(camp_meta_key, json.dumps(camp_meta).encode())

    pipe.execute()
    notify_server(ds_id, meta_payload)
    print(f"Done – {ds_id} loaded with {len(entries)} questions.")

if __name__ == "__main__":
    if len(sys.argv) == 1:
        ds_id = "TestAccuracy"
        topic = "Test"
        jsonl = Path("/storage/cmarnold/projects/maps/labeldata/mapqa/TestAccuracy_1.jsonl")
    elif len(sys.argv) != 4:
        sys.exit("usage: add_dataset_to_redis.py <topic> <index:int> <jsonl_path>")
    else:
        ds_id  = sys.argv[1]
        topic  = sys.argv[2]
        jsonl  = Path(sys.argv[3])
    if not jsonl.exists():
        sys.exit(f"{jsonl} not found")
    main(ds_id, topic, jsonl)
