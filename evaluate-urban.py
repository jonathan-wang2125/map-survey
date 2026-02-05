import argparse
import json
import subprocess

import redis
## TO RUN: python py/evaluate-urban.py
DEFAULT_REDIS_URL = "redis://localhost:6397/0"
DATASET_PREFIX = "urban"

PYTHON_BIN = "/storage/cmarnold/shared/conda/envs/ml/bin/python"
PYTHON_ROOT = "/storage/cmarnold/projects/maps"
GRADE_DATASET = "/storage/cmarnold/projects/maps/SurveyBridge/grade_dataset.py"
SURVEY_PYTHON = "/storage/cmarnold/shared/conda/envs/map-survey/bin/python"
SURVEY_ROOT = "/storage/cmarnold/projects/map-survey"
ADD_EVAL = "/storage/cmarnold/projects/map-survey/py/add_eval.py"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Grade Urban datasets and store accuracies in Redis."
    )
    parser.add_argument("--redis-url", default=DEFAULT_REDIS_URL)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regrade even if v1:<pid>:<dataset>:meta already exists.",
    )
    return parser.parse_args()


def run_grade(pid: str, dataset: str) -> dict:
    result = subprocess.run(
        [PYTHON_BIN, GRADE_DATASET, pid, dataset],
        cwd=PYTHON_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "grade_dataset failed")

    last_line = "{}"
    for line in result.stdout.splitlines():
        if line.strip():
            last_line = line
    try:
        return json.loads(last_line)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid grader output: {last_line}") from exc


def run_add_eval(pid: str, dataset: str, eval_file: str) -> None:
    result = subprocess.run(
        [SURVEY_PYTHON, ADD_EVAL, pid, dataset, eval_file],
        cwd=SURVEY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "add_eval failed")


def main() -> None:
    args = parse_args()

    r = redis.Redis.from_url(args.redis_url, decode_responses=True)
    datasets = sorted(r.smembers("v1:datasets"))
    urban_datasets = [ds for ds in datasets if ds.lower().startswith(DATASET_PREFIX)]

    if not urban_datasets:
        print(f"No datasets found starting with '{DATASET_PREFIX}'.")
        return

    total = 0
    skipped = 0
    failures = 0

    for dataset in urban_datasets:
        assigned = r.smembers(f"v1:assignments:{dataset}")
        if not assigned:
            continue

        for pid in sorted(assigned):
            meta_key = f"v1:{pid}:{dataset}:meta"
            if not args.force and r.exists(meta_key):
                skipped += 1
                continue

            try:
                result = run_grade(pid, dataset)
                accuracy = result.get("accuracy")
                eval_file = result.get("eval_file")
                if accuracy is None:
                    raise RuntimeError("grader output missing accuracy")

                if eval_file:
                    run_add_eval(pid, dataset, eval_file)

                r.set(meta_key, accuracy)
                total += 1
                print(f"Graded {pid}/{dataset}: {accuracy}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"Failed {pid}/{dataset}: {exc}")

    print(
        "\nDone. "
        f"graded={total}, skipped={skipped}, failures={failures}, datasets={len(urban_datasets)}"
    )


if __name__ == "__main__":
    main()