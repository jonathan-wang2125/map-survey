#!/usr/bin/env python3
"""
Build / migrate to the new Redis layout (prefix v1:) and
*rename five datasets* during the import.

Renaming table
--------------
112mapqa_Military        →  MilitaryAccuracy
mapqa_NaturalWorld_103   →  NaturalWorldAccuracy
mapqa_Aviation_120       →  AviationAccuracy
mapqa_Urban_120          →  UrbanAccuracy
newMilitaryForAnnotators →  MilitaryPromptTest
"""

# ------------ CONFIG --------------------------------------------------------
REDIS_URL      = "redis://localhost:6379/0"
CATALOGUE_FILE = "data/datasets.jsonl"          # path to datasets.jsonl
DATA_DIR       = "data"                    # directory that holds all dataset files
# ----------------------------------------------------------------------------

import json, os
from pathlib import Path
import redis
from tqdm import tqdm

# ---------- dataset-id renaming map ----------
RENAME = {
    "112mapqa_Military":        "MilitaryAccuracy",
    "mapqa_NaturalWorld_103":   "NaturalWorldAccuracy",
    "mapqa_Aviation_120":       "AviationAccuracy",
    "mapqa_Urban_120":          "UrbanAccuracy",
    "newMilitaryForAnnotators": "MilitaryPromptTest",
}

# ---------- redis connection ----------
r = redis.Redis.from_url(REDIS_URL, decode_responses=True)

QUESTION_UID = {}

# ----------------------------------------------------------------------------
def ingest_questions() -> None:
    """Read datasets.jsonl and populate v1:datasets:* keys."""
    cat_path = Path(CATALOGUE_FILE)
    if not cat_path.exists():
        raise SystemExit(f"{cat_path} not found; aborting.")

    print("Importing questions from every dataset file...")
    with cat_path.open(encoding="utf-8") as cat_f:
        for line in tqdm(cat_f, desc="Datasets processed"):
            meta = json.loads(line)
            old_id = meta["id"]
            new_id = RENAME.get(old_id, old_id)        # apply rename

            data_file = Path(DATA_DIR) / meta["file"]
            if not data_file.exists():
                print(f"  Warning: {data_file} is missing; skipped.")
                continue

            r.sadd("v1:datasets", new_id)
            _ingest_dataset_file(new_id, data_file)

    print("Question import finished.\n")


def _ingest_dataset_file(dataset_id: str, file_path: Path) -> None:
    """Load one data/<file>.jsonl into Redis under the new dataset_id."""

    QUESTION_UID[dataset_id] = {}

    with file_path.open(encoding="utf-8") as f, r.pipeline() as pipe:
        for line in f:
            q = json.loads(line)
            uid = q.get("uid")
            if not uid:                       # dataset is expected to have one
                print(f"  Warning: question with no uid in {file_path}")
                continue

            map_name  = q.get("Map", "").strip()
            question  = q.get("Question", "").strip()
            QUESTION_UID[dataset_id][(map_name, question)] = uid

            pipe.sadd(f"v1:datasets:{dataset_id}", uid)
            pipe.set(f"v1:datasets:{dataset_id}:{uid}", json.dumps(q))
        pipe.execute()


# ----------------------------------------------------------------------------
def migrate_user_responses() -> None:
    """
    Copy legacy answers into v1:… keys.
    If an answer lacks uid/responseID, find the uid by matching
    (mapFileName, question) against the questions previously loaded.
    """
    print("Migrating user responses…")
    patt = "user:*:qresponse:*:*"
    keys = list(r.scan_iter(match=patt, count=5000))

    if not keys:
        print("No old answer keys found; skipping.\n")
        return

    with r.pipeline() as pipe:
        for key in tqdm(keys, desc="Answers migrated"):
            # key = user:<pid>:qresponse:<dataset>:<responseID>
            _, pid, _, old_ds, _ = key.split(":", 4)
            dataset_id = RENAME.get(old_ds, old_ds)

            raw = r.get(key)
            if not raw:
                continue

            try:
                ans = json.loads(raw)
            except json.JSONDecodeError as ex:
                print(f"  Warning: bad JSON in {key}: {ex}")
                continue

            uid = ans.get("QID")
            if not uid:
                map_name  = ans.get("mapFileName", "").strip()
                question  = ans.get("question", "").strip()
                uid = QUESTION_UID.get(dataset_id, {}).get((map_name, question))

                if not uid:
                    print(f"  Warning: could not match UID "
                          f"for answer {key} (map={map_name}, q='{question[:40]}…')")
                    continue   # skip or choose to store under a fallback key

                # also persist the recovered uid inside the answer JSON
                ans["uid"] = uid
                raw = json.dumps(ans)

            # book-keeping sets
            pipe.sadd("v1:usernames", pid)
            pipe.sadd(f"v1:assignments:{pid}", dataset_id)
            pipe.sadd("v1:datasets", dataset_id)

            # store the answer under the correct uid
            pipe.set(f"v1:{pid}:{dataset_id}:{uid}", raw)

        pipe.execute()

    print("User-response migration finished.\n")


# ----------------------------------------------------------------------------
if __name__ == "__main__":
    print(os.getcwd())
    ingest_questions()
    migrate_user_responses()
