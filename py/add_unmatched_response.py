
import sys, json
import redis
from tqdm import tqdm

# ------------------------------------------------------------------------------
REDIS_URL  = "redis://localhost:6397/0"
BATCH_SIZE = 5_000
# ------------------------------------------------------------------------------

def main(user_id1: str, user_id2: str, ds_id: str, unmatched_responses: json) -> None:
    """
    Connect to Redis and update the "llm_eval" field for each question UID
    in the specified user's dataset.
    """

    user1_key = f'v1:{user_id1}:{ds_id}'
    user2_key = f'v1:{user_id2}:{ds_id}'
    r = redis.Redis.from_url(REDIS_URL, decode_responses=False)

        # ---------- read JSONL of updates ----------
    print(f"Reading updates from JSON …")
    updates: dict[str, tuple[str, str, str]] = {}
    for response in unmatched_responses:
        uid = response['uid']
        new_eval = response['llm_eval']
        user1_resp = response['Label']
        user2_resp = response['pred_text']
        updates[uid] = (new_eval, user1_resp, user2_resp)

    if not updates:
        sys.exit(f"Given json contained no valid update entries.")

    # ---------- apply updates via pipeline ----------
    print("Updating Redis entries …")
    pipe    = r.pipeline()
    pending = 0
    skipped = 0

    for uid, (new_eval, user1_resp, user2_resp) in tqdm(updates.items(), unit="uid"):
        user1_full_key = f"{user1_key}:{uid}"
        user2_full_key = f"{user2_key}:{uid}"
        payload1 = get_payload(r, user1_full_key, new_eval, user2_resp)
        payload2 = get_payload(r, user2_full_key, new_eval, user1_resp)

        # Queue up the write in the pipeline
        if payload1 is not None and payload2 is not None:
            pipe.set(user1_full_key, json.dumps(payload1).encode("utf-8"))
            pipe.set(user2_full_key, json.dumps(payload2).encode("utf-8"))
            pending += 2
        else:
            skipped += 1

        if pending >= BATCH_SIZE:
            pipe.execute()
            pending = 0

    if pending:
        pipe.execute()

    total   = len(updates)
    skipped_uids = skipped // 2
    applied = total - skipped_uids
    print(f"Done. {applied} / {total} UIDs updated; {skipped_uids} UIDs skipped.")

def get_payload(r: redis.Redis, key: str, new_eval: str, nonconcurred: str) -> dict | None:
    raw = r.get(key)
    if raw is None:
        print(f"  • Warning: Redis key '{key}' not found – skipping.")
        return None

    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        print(f"  • Warning: Stored value under '{key}' is not valid JSON – skipping.")
        return None
    
    payload["llm_eval"] = new_eval
    payload["nonconcurred_response"] = nonconcurred
    return payload


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit("usage: add_unmatched_response.py <user_id1> <user_id2> <ds_id> <json object>")
    else:
        pid1 = sys.argv[1]
        pid2 = sys.argv[2]
        ds = sys.argv[3]
        unmatched_responses = json.loads(sys.argv[4])

    main(pid1, pid2, ds, unmatched_responses)


