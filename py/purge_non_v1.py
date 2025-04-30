#!/usr/bin/env python3
"""
purge_non_v1.py  –  delete every key that does **not** start with 'v1:'.
"""

import redis
from tqdm import tqdm

REDIS_URL  = "redis://localhost:6397/0"   # adjust as needed
BATCH_SIZE = 5_000                        # pipeline flush size

def main() -> None:
    r = redis.Redis.from_url(REDIS_URL, decode_responses=False)

    keys_to_delete = [k for k in r.scan_iter(match="*", count=10_000)
                      if not k.startswith(b"v1:")]

    total = len(keys_to_delete)
    if not total:
        print("No non-v1 keys found; nothing to remove.")
        return

    print(f"Found {total:,} keys to delete (everything without the 'v1:' prefix).")
    if input("Proceed with deletion? [y/N] ").strip().lower() != "y":
        print("Aborted – no keys deleted.")
        return

    print("Deleting keys …")
    with r.pipeline() as pipe:
        pending = 0
        for key in tqdm(keys_to_delete, unit="key"):
            pipe.delete(key)
            pending += 1
            if pending >= BATCH_SIZE:
                pipe.execute()
                pending = 0
        if pending:                          # flush final partial batch
            pipe.execute()

    print("Finished – all non-v1 keys have been purged.")

if __name__ == "__main__":
    main()
