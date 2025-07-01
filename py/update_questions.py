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

def main(ds_id: str, jsonl_file: Path) -> None:
    ds_set_key   = f"v1:datasets:{ds_id}"

    r = redis.Redis.from_url(REDIS_URL, decode_responses=False)

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
    questions: set[tuple[str, bytes]] = set()
    keys_to_del: set[str] = set()
    pipe, pending = r.pipeline(), 0
    assigned_users = r.smembers(f"v1:assignments:{ds_id}")
    uids = []
    for q in tqdm(entries, unit="q"):
        uid = q["uid"]
        uids.append(uid)
        questions.add((f"{ds_set_key}:{uid}", json.dumps(q).encode()))
    
    for pid in assigned_users:
        pid = pid.decode() if isinstance(pid, bytes) else pid
        keys_to_del.add(f"v1:{pid}:{ds_id}:meta")
        for uid in uids:
            keys_to_del.add(f"v1:{pid}:{ds_id}:{uid}")
        
        # ── show summary & confirm ----------------------------------------
    print(f"Dataset : {ds_id}")
    print(f"Users    : {len(assigned_users)}")
    print(f"Questions to update: {len(questions):,}")
    print(f"Existing responses to delete: {(len(keys_to_del)-len(assigned_users)):,}")
    if input("Proceed? [y/N] ").strip().lower() != "y":
        print("Aborted.")
        return

    with r.pipeline() as pipe:
        pending = 0
        for k, obj in tqdm(questions, unit="key"):
            pipe.set(k, obj)
            pending += 1
            if pending >= BATCH_SIZE:
                pipe.execute(); pending = 0
        for k in tqdm(keys_to_del, unit="key"):
            pipe.delete(k)
            pending += 1
            if pending >= BATCH_SIZE:
                pipe.execute(); pending = 0
        if pending:
            pipe.execute()

    print(f"Done – {ds_id} updated with {len(entries)} questions.")

if __name__ == "__main__":
    if len(sys.argv) == 1:
        ds_id = "MilitaryAccuracy"
        jsonl = Path("/storage/cmarnold/projects/maps/labeldata/mapqa/MilitaryTraining_20.jsonl")
    elif len(sys.argv) != 4:
        sys.exit("usage: add_dataset_to_redis.py <topic> <index:int> <jsonl_path>")
    else:
        ds_id  = sys.argv[1]
        topic  = sys.argv[2]
        jsonl  = Path(sys.argv[3])
    if not jsonl.exists():
        sys.exit(f"{jsonl} not found")
    main(ds_id, jsonl)
