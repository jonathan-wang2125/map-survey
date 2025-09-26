#!/usr/bin/env python3
"""Export every response from Redis into per-dataset JSONL files.

Each dataset receives a `<dataset>.jsonl` file under the export directory
(`/storage/cmarnold/projects/maps/survey-responses/annotations/difficulties`
by default). Every line contains the complete answer payload augmented with
question metadata (`questionData`) and dataset metadata (`datasetMeta`)
when available. Existing files are merged so that no previously stored
responses are lost.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterator, List, MutableMapping, Optional, Tuple, Union

import redis

DEFAULT_REDIS_URL = "redis://localhost:6397/0"
DEFAULT_EXPORT_DIR = Path(
    "/storage/cmarnold/projects/maps/survey-responses/annotations/difficulties"
)
USER_SET_KEY = "v1:usernames"
META_SUFFIX = b":meta"

JsonDict = Dict[str, Union[str, int, float, bool, None, Dict, List]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dump all survey responses grouped by dataset into JSONL files."
    )
    parser.add_argument(
        "--redis-url",
        default=DEFAULT_REDIS_URL,
        help=f"Redis connection URL (default: {DEFAULT_REDIS_URL})",
    )
    parser.add_argument(
        "--export-dir",
        type=Path,
        default=DEFAULT_EXPORT_DIR,
        help=(
            "Directory that will receive <dataset>.jsonl files (default: "
            "/storage/cmarnold/projects/maps/survey-responses/annotations/difficulties)"
        ),
    )
    return parser.parse_args()


def to_str(value: Union[str, bytes, None]) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def iter_answer_keys(r: redis.Redis, pid: str) -> Iterator[str]:
    pattern = f"v1:{pid}:*:*"
    for key in r.scan_iter(match=pattern, count=10_000):
        if isinstance(key, bytes) and key.endswith(META_SUFFIX):
            continue
        key_str = to_str(key)
        if key_str.endswith(":meta"):
            continue
        yield key_str


def extract_ids_from_key(key: str) -> Optional[Tuple[str, str, str]]:
    parts = key.split(":")
    if len(parts) < 4:
        return None
    pid = parts[1]
    dataset = parts[2]
    uid = ":".join(parts[3:])
    return pid, dataset, uid


def load_json(r: redis.Redis, key: str) -> Optional[JsonDict]:
    raw = r.get(key)
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    try:
        obj = json.loads(raw)
    except Exception:
        return None
    if isinstance(obj, dict):
        return obj
    return None


def compute_record_key(payload: MutableMapping[str, object]) -> Optional[str]:
    pid = to_str(payload.get("prolificID"))
    uid = to_str(payload.get("uid"))
    if not pid or not uid:
        return None
    return f"{pid}:{uid}"


def load_existing_jsonl(path: Path) -> Dict[str, JsonDict]:
    entries: Dict[str, JsonDict] = {}
    if not path.exists():
        return entries
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if not isinstance(obj, dict):
                continue
            key = compute_record_key(obj)
            if not key:
                continue
            entries[key] = obj
    return entries


def merge_records(existing: JsonDict, new_data: JsonDict) -> JsonDict:
    merged = dict(existing)
    merged.update(new_data)
    return merged


def write_dataset_file(path: Path, records: List[JsonDict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = load_existing_jsonl(path)
    for record in records:
        key = compute_record_key(record)
        if not key:
            continue
        if key in existing:
            existing[key] = merge_records(existing[key], record)
        else:
            existing[key] = record
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as fh:
        for key in sorted(existing):
            fh.write(json.dumps(existing[key], ensure_ascii=False) + "\n")
    tmp_path.replace(path)


def export_all_responses(r: redis.Redis, export_dir: Path) -> None:
    dataset_meta_cache: Dict[str, Optional[JsonDict]] = {}
    question_cache: Dict[Tuple[str, str], Optional[JsonDict]] = {}
    responses_by_dataset: Dict[str, List[JsonDict]] = defaultdict(list)

    pids = sorted(to_str(pid) for pid in r.smembers(USER_SET_KEY) if pid)

    for pid in pids:
        if not pid:
            continue
        for key in iter_answer_keys(r, pid):
            ids = extract_ids_from_key(key)
            if ids is None:
                continue
            _, dataset_from_key, uid_from_key = ids

            answer = load_json(r, key)
            if answer is None:
                continue

            dataset = to_str(answer.get("dataset") or dataset_from_key)
            uid = to_str(answer.get("uid") or uid_from_key)

            answer["prolificID"] = to_str(answer.get("prolificID") or pid)
            answer["dataset"] = dataset
            answer["uid"] = uid

            q_cache_key = (dataset, uid)
            if q_cache_key not in question_cache:
                question_cache[q_cache_key] = load_json(
                    r, f"v1:datasets:{dataset}:{uid}"
                )
            question_data = question_cache[q_cache_key]
            if question_data:
                answer.setdefault(
                    "question", question_data.get("Question") or question_data.get("question")
                )
                answer.setdefault("label", question_data.get("Label"))
                answer.setdefault(
                    "map", question_data.get("Map") or question_data.get("map")
                )
                answer["questionData"] = question_data

            if dataset not in dataset_meta_cache:
                dataset_meta_cache[dataset] = load_json(
                    r, f"v1:datasets:{dataset}:meta"
                )
            dataset_meta = dataset_meta_cache[dataset]
            if dataset_meta:
                answer["datasetMeta"] = dataset_meta

            responses_by_dataset[dataset].append(answer)

    for dataset, records in responses_by_dataset.items():
        if not dataset:
            continue
        out_path = export_dir / f"{dataset}.jsonl"
        write_dataset_file(out_path, records)



def main() -> None:
    args = parse_args()
    r = redis.Redis.from_url(args.redis_url, decode_responses=False)
    export_all_responses(r, args.export_dir)


if __name__ == "__main__":
    main()
