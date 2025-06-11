import sys
import json
import redis
from pathlib import Path
from tqdm import tqdm

# ------------------------------------------------------------------------------
REDIS_URL  = "redis://localhost:6397/0"
BATCH_SIZE = 5_000
# ------------------------------------------------------------------------------

def main(user_id: str, ds_id: str, updates_jsonl: Path) -> None:
    """
    Connect to Redis and update the "llm_eval" field for each question UID
    in the specified user's dataset.
    """
    base_key = f"v1:{user_id}:{ds_id}"
    r = redis.Redis.from_url(REDIS_URL, decode_responses=False)

    # ---------- read JSONL of updates ----------
    print(f"Reading updates from JSONL: {updates_jsonl} …")
    updates: dict[str, str] = {}
    with updates_jsonl.open(encoding="utf-8") as fh:
        for ln, line in enumerate(fh, 1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                sys.exit(f"{updates_jsonl}:{ln} – bad JSON ({e})")
            if "uid" not in obj or "llm_eval" not in obj:
                sys.exit(f"{updates_jsonl}:{ln} – each JSON object must contain 'uid' and 'llm_eval'")
            uid      = obj["uid"]
            new_eval = obj["llm_eval"]
            updates[uid] = new_eval

    if not updates:
        sys.exit(f"{updates_jsonl} contained no valid update entries.")

    # ---------- apply updates via pipeline ----------
    print("Updating Redis entries …")
    pipe    = r.pipeline()
    pending = 0
    skipped = 0

    for uid, new_eval in tqdm(updates.items(), unit="uid"):
        full_key = f"{base_key}:{uid}"
        raw = r.get(full_key)
        if raw is None:
            print(f"  • Warning: Redis key '{full_key}' not found – skipping.")
            skipped += 1
            continue

        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            print(f"  • Warning: Stored value under '{full_key}' is not valid JSON – skipping.")
            skipped += 1
            continue

        # Update or add the "llm_eval" field
        payload["llm_eval"] = new_eval

        # Queue up the write in the pipeline
        pipe.set(full_key, json.dumps(payload).encode("utf-8"))
        pending += 1

        if pending >= BATCH_SIZE:
            pipe.execute()
            pending = 0

    if pending:
        pipe.execute()

    total   = len(updates)
    applied = total - skipped
    print(f"\nDone. {applied} / {total} entries updated. {skipped} entries skipped.")

if __name__ == "__main__":
    if len(sys.argv) == 1:
        user_id = "cmarnold"
        ds_id = "MilitaryAccuracy"
        updates_jsonl = Path("/storage/cmarnold/projects/maps/survey-responses/MilitaryAccuracy/cmarnold.jsonl")
    elif len(sys.argv) != 4:
        sys.exit("usage: update_llm_eval.py <user_id> <ds_id> <jsonl_with_updates>")
    else:
        user_id       = sys.argv[1]
        ds_id         = sys.argv[2]
        updates_jsonl = Path(sys.argv[3])
    if not updates_jsonl.exists():
        sys.exit(f"{updates_jsonl} not found")

    main(user_id, ds_id, updates_jsonl)

    # from pathlib import Path
    # import sys

    # # --- ADJUST THESE TWO LINES AS NEEDED ---
    # ds_id = "MilitaryAccuracy"
    # folder = Path("/storage/cmarnold/projects/maps/survey-responses/MilitaryAccuracy")
    # # -----------------------------------------

    # for jsonl_file in folder.glob("*.jsonl"):
    #     user_id = jsonl_file.stem
    #     print(f"Processing user: {user_id}")
    #     main(user_id, ds_id, jsonl_file)