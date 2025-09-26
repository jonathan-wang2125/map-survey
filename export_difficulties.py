#!/usr/bin/env python3
"""Export difficulty responses from Redis in adjudication-like format.

This script iterates through every stored answer in Redis and updates
per-dataset JSON Lines files so they mirror how adjudication exports are
structured. Each JSON object includes the full answer payload plus question
metadata, dataset metadata, and an inferred difficulty scale (0-10, 0-5, or
time-based). Existing JSONL exports are preserved and augmented instead of
being overwritten. Optionally, the updated entries can also be emitted to
stdout.

After updating the JSONL files, the script prints a summary describing when
the recorded difficulties switched from a 0-10 scale to 0-5 and then to
time-based values.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple, Union

import redis

# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------
DEFAULT_REDIS_URL = "redis://localhost:6397/0"
# Default export directory should match the canonical annotations repository on disk
# so that running the script without arguments updates the shared JSONL files.
DEFAULT_EXPORT_DIR = Path("/storage/cmarnold/projects/maps/survey-responses/annotations")
USER_SET_KEY = "v1:usernames"
META_SUFFIX = b":meta"


JsonDict = Dict[str, Union[str, int, float, bool, None, Dict, List]]
Number = Union[int, float]

PREFER_EXISTING_KEYS = {
    "difficulty",
    "difficultyScale",
    "time",
    "timeSpent",
    "time_spent",
    "timeTaken",
    "time_taken",
    "duration",
    "durationSeconds",
}


@dataclass
class DifficultyRecord:
    payload: JsonDict
    dataset: str
    difficulty_value: Optional[Union[str, Number]]
    timestamp: Optional[int]


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export difficulty responses in JSON Lines format"
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
            "Directory that stores per-dataset JSONL exports to update "
            "(default: /storage/cmarnold/projects/maps/survey-responses/annotations)"
        ),
    )
    parser.add_argument(
        "--emit-stdout",
        action="store_true",
        help="Also emit JSON lines to stdout after updating JSONL files",
    )
    parser.add_argument(
        "--read-only",
        action="store_true",
        help=(
            "Inspect difficulties without updating JSONL exports; only print the "
            "scale switch summary and any requested stdout emission"
        ),
    )
    return parser.parse_args()


def to_str(value: Union[str, bytes]) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def parse_timestamp(raw: Optional[Union[str, Number]]) -> Optional[int]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        try:
            return int(raw)
        except Exception:
            return None
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return None
        try:
            return int(float(raw))
        except Exception:
            return None
    return None


def parse_numeric(raw: Optional[Union[str, Number]]) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return None
        try:
            return float(raw)
        except Exception:
            return None
    return None


def classify_dataset_scale(
    max_numeric: Optional[float],
    has_time_like: bool,
) -> str:
    if has_time_like:
        return "time"
    if max_numeric is None:
        return "unknown"
    return "0-10" if max_numeric > 5 else "0-5"


def isoformat_from_millis(ts: Optional[int]) -> str:
    if ts is None:
        return "unknown"
    try:
        return (
            datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
    except Exception:
        return "unknown"


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
        return json.loads(raw)
    except Exception:
        return None


def collect_difficulties(r: redis.Redis) -> Tuple[List[DifficultyRecord], Dict[str, str]]:
    dataset_meta_cache: Dict[str, Optional[JsonDict]] = {}
    question_cache: Dict[Tuple[str, str], Optional[JsonDict]] = {}
    dataset_max_numeric: Dict[str, float] = {}
    dataset_time_like: Dict[str, bool] = {}

    records: List[DifficultyRecord] = []

    pids = sorted(to_str(pid) for pid in r.smembers(USER_SET_KEY))

    for pid in pids:
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

            # Fetch question metadata once per (dataset, uid)
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
                answer.setdefault("map", question_data.get("Map") or question_data.get("map"))
                answer["questionData"] = question_data

            # Fetch dataset metadata once per dataset
            if dataset not in dataset_meta_cache:
                dataset_meta_cache[dataset] = load_json(
                    r, f"v1:datasets:{dataset}:meta"
                )
            dataset_meta = dataset_meta_cache[dataset]
            if dataset_meta:
                answer["datasetMeta"] = dataset_meta

            answer["prolificID"] = to_str(answer.get("prolificID") or pid)
            answer["dataset"] = dataset
            answer["uid"] = uid

            difficulty_value = answer.get("difficulty")
            numeric_value = parse_numeric(difficulty_value)
            if numeric_value is not None:
                current_max = dataset_max_numeric.get(dataset)
                if current_max is None or numeric_value > current_max:
                    dataset_max_numeric[dataset] = numeric_value
            elif difficulty_value not in (None, ""):
                dataset_time_like[dataset] = True

            ts = parse_timestamp(
                answer.get("origTimestamp")
                or answer.get("timestamp")
                or answer.get("created_at")
            )

            records.append(
                DifficultyRecord(
                    payload=answer,
                    dataset=dataset,
                    difficulty_value=difficulty_value,
                    timestamp=ts,
                )
            )

    dataset_scales: Dict[str, str] = {}
    for dataset in {rec.dataset for rec in records}:
        has_time_like = dataset_time_like.get(dataset, False)
        max_numeric = dataset_max_numeric.get(dataset)
        dataset_scales[dataset] = classify_dataset_scale(max_numeric, has_time_like)

    for rec in records:
        rec.payload["difficultyScale"] = dataset_scales.get(rec.dataset, "unknown")

    return records, dataset_scales


def compute_record_key(payload: JsonDict) -> str:
    pid = to_str(payload.get("prolificID", ""))
    uid = to_str(payload.get("uid", ""))
    if not pid or not uid:
        return ""
    return f"{pid}:{uid}"


def load_existing_jsonl(path: Path) -> Dict[str, JsonDict]:
    entries: Dict[str, JsonDict] = {}
    if not path.exists():
        return entries
    try:
        with path.open("r", encoding="utf-8") as fh:
            for line_no, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                pid = to_str(obj.get("prolificID", ""))
                uid = to_str(obj.get("uid", ""))
                key = f"{pid}:{uid}"
                entries[key] = obj
    except FileNotFoundError:
        return {}
    return entries


def is_meaningful(value: Union[str, Number, bool, None, Dict, List]) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def merge_payload(
    existing: JsonDict,
    new_payload: JsonDict,
    dataset: str,
    dataset_scale: str,
) -> JsonDict:
    merged: JsonDict = dict(existing)

    for key, value in new_payload.items():
        if key in PREFER_EXISTING_KEYS:
            if not is_meaningful(merged.get(key)) and (
                is_meaningful(value) or key not in merged
            ):
                merged[key] = value
            continue

        if is_meaningful(value) or key not in merged:
            merged[key] = value

    merged.setdefault("dataset", dataset)

    # Ensure prolificID/uid are present
    pid = to_str(merged.get("prolificID", ""))
    uid = to_str(merged.get("uid", ""))
    if not pid or pid == "":
        pid = to_str(new_payload.get("prolificID", ""))
        if pid:
            merged["prolificID"] = pid
    if not uid or uid == "":
        uid = to_str(new_payload.get("uid", ""))
        if uid:
            merged["uid"] = uid

    if dataset_scale:
        merged["difficultyScale"] = dataset_scale

    return merged


def write_jsonl(path: Path, entries: Dict[str, JsonDict]) -> None:
    if not entries:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as fh:
        for key in sorted(entries):
            fh.write(json.dumps(entries[key], ensure_ascii=False) + "\n")
    tmp_path.replace(path)


def export_records_to_jsonl(
    records: List[DifficultyRecord],
    dataset_scales: Dict[str, str],
    export_dir: Path,
) -> Dict[str, Path]:
    grouped: Dict[str, Dict[str, JsonDict]] = defaultdict(dict)
    for rec in records:
        key = compute_record_key(rec.payload)
        if not key:
            continue
        grouped[rec.dataset][key] = rec.payload

    written: Dict[str, Path] = {}

    for dataset, new_entries in grouped.items():
        dataset_file = export_dir / f"{dataset}.jsonl"
        existing_entries = load_existing_jsonl(dataset_file)

        merged_entries: Dict[str, JsonDict] = {}
        dataset_scale = dataset_scales.get(dataset, "unknown")

        all_keys = set(existing_entries) | set(new_entries)
        for key in all_keys:
            existing_payload = existing_entries.get(key, {})
            new_payload = new_entries.get(key, existing_payload)
            merged_entries[key] = merge_payload(
                existing_payload,
                new_payload,
                dataset,
                dataset_scale,
            )

        write_jsonl(dataset_file, merged_entries)
        written[dataset] = dataset_file

    return written


def find_first_scale_after(
    timeline: List[Tuple[Optional[int], DifficultyRecord]],
    scale: str,
    after: Optional[int],
) -> Optional[Tuple[int, DifficultyRecord]]:
    for ts, rec in timeline:
        if rec.payload.get("difficultyScale") != scale:
            continue
        if after is not None:
            if ts is None or ts <= after:
                continue
        if ts is None:
            continue
        return ts, rec
    return None


def main() -> None:
    args = parse_args()
    r = redis.Redis.from_url(args.redis_url, decode_responses=False)

    records, dataset_scales = collect_difficulties(r)

    # Sort records by timestamp for stable output
    def sort_key(rec: DifficultyRecord) -> Tuple[int, str, str]:
        ts = rec.timestamp if rec.timestamp is not None else 0
        return (ts, rec.payload.get("dataset", ""), rec.payload.get("uid", ""))

    records.sort(key=sort_key)

    if not args.read_only:
        export_paths = export_records_to_jsonl(records, dataset_scales, args.export_dir)
        if export_paths:
            for dataset, path in sorted(export_paths.items()):
                print(f"Updated {dataset} export at {path}")
        else:
            print("No difficulty responses found to export.")

    timeline: List[Tuple[Optional[int], DifficultyRecord]] = [
        (rec.timestamp, rec) for rec in records
    ]

    first_scale_entries: Dict[str, Tuple[int, DifficultyRecord]] = {}
    for scale in ("0-10", "0-5", "time"):
        entry = find_first_scale_after(timeline, scale, after=None)
        if entry is not None:
            first_scale_entries[scale] = entry

    first_10 = first_scale_entries.get("0-10")
    first_5_after_10 = None
    if first_10 is not None:
        first_5_after_10 = find_first_scale_after(timeline, "0-5", after=first_10[0])
    else:
        first_5_after_10 = first_scale_entries.get("0-5")

    first_time_after_5 = None
    if first_5_after_10 is not None:
        first_time_after_5 = find_first_scale_after(
            timeline, "time", after=first_5_after_10[0]
        )
    elif first_10 is not None:
        first_time_after_5 = find_first_scale_after(
            timeline, "time", after=first_10[0]
        )
    else:
        first_time_after_5 = first_scale_entries.get("time")

    if args.emit_stdout:
        for rec in records:
            print(json.dumps(rec.payload, ensure_ascii=False))

    def describe(entry: Optional[Tuple[int, DifficultyRecord]]) -> str:
        if entry is None:
            return "not observed"
        ts, rec = entry
        iso_ts = isoformat_from_millis(ts)
        dataset = rec.payload.get("dataset", "unknown")
        pid = rec.payload.get("prolificID", "unknown")
        uid = rec.payload.get("uid", "unknown")
        return f"{iso_ts} (dataset={dataset}, pid={pid}, uid={uid})"

    switch_messages = []
    if first_10 is not None and first_5_after_10 is not None:
        switch_messages.append(
            f"0-10 → 0-5 at {describe(first_5_after_10)}"
        )
    elif first_5_after_10 is not None:
        switch_messages.append(
            f"0-10 → 0-5 switch inferred at {describe(first_5_after_10)}"
        )
    else:
        switch_messages.append("0-10 → 0-5 switch not observed")

    if first_5_after_10 is not None and first_time_after_5 is not None:
        switch_messages.append(
            f"0-5 → time at {describe(first_time_after_5)}"
        )
    elif first_time_after_5 is not None:
        switch_messages.append(
            f"0-5 → time switch inferred at {describe(first_time_after_5)}"
        )
    else:
        switch_messages.append("0-5 → time switch not observed")

    print("Difficulty scale switches: " + "; ".join(switch_messages))


if __name__ == "__main__":
    main()
