#!/usr/bin/env python3
"""
campaign_overview.py
────────────────────
Hard-coded dashboard for the campaigns you care about.
• Reads the datasets inside each campaign (`v1:campaigns:<topic>` SET)
• Ensures the campaign-meta key exists with the right `numImages`
• Prints a concise summary

Edit the TOPICS dict below to match your project and just run:
    $ python campaign_overview.py
"""

import json, redis
from textwrap import indent

# ── 1. configure here ──────────────────────────────────────────────────
REDIS_URL = "redis://localhost:6379/0"

TOPICS = {
    "Military":        107,
    "Natural World":   118,
    "Urban":           113,
    "Aviation":        68,
    "Test":            2,
}  # topic → numImages limit
# ────────────────────────────────────────────────────────────────────────

r = redis.Redis.from_url(REDIS_URL, decode_responses=True)

def ensure_meta(topic: str, target_images: int) -> dict:
    """Guarantee the meta key exists and carries the desired numImages."""
    key = f"v1:campaigns:{topic}:meta"
    raw = r.get(key)
    if raw:
        meta = json.loads(raw)
    else:
        meta = {"curIndex": 0, "numImages": target_images}

    # keep curIndex but update numImages if caller changed it
    if meta.get("numImages") != target_images:
        meta["numImages"] = target_images
        r.set(key, json.dumps(meta))

    return meta

def reset_meta(topic: str, target_images: int):
    key = f"v1:campaigns:{topic}:meta"
    meta = {"curIndex": 0, "numImages": target_images}
    r.set(key, json.dumps(meta))

    return meta

for topic, max_imgs in TOPICS.items():
    set_key = f"v1:campaigns:{topic}"
    datasets = sorted(r.smembers(set_key))
    meta = ensure_meta(topic, max_imgs)
    meta = reset_meta(topic, max_imgs)

    print(f"▶  {topic}")
    print(f"   datasets : {', '.join(datasets) or '—'}")
    print(indent(json.dumps(meta, indent=2), "   "))
    print()

