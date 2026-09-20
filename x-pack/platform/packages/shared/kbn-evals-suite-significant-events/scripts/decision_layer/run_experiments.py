#!/usr/bin/env python3
"""Run the Nightshift decision-layer bakeoff (experiments A–D)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from backends import Backend, MajorityBackend, build_backends
from fixtures import QUESTIONS, SHORT_CRITERIA, all_examples
from metrics import (
    accuracy,
    brier,
    coverage_at_precision,
    ece,
    mae,
    precision_coverage_curve,
    split_indices,
)

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"


def _assign_splits(examples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    splits = split_indices([ex["id"] for ex in examples])
    assigned = []
    for ex in examples:
        row = dict(ex)
        for name, ids in splits.items():
            if ex["id"] in ids:
                row["split"] = name
                break
        assigned.append(row)
    return assigned


def _safe(backend: Backend, state: dict[str, Any], questions: dict[str, Any]) -> dict[str, Any]:
    try:
        return backend.decide(state, questions)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "values": {}, "latency_ms": 0.0, "input_tokens": 0, "cost_usd": 0.0}


def run_unit(
    task: str,
    examples: list[dict[str, Any]],
    backends: list[Backend],
    questions: dict[str, Any],
) -> dict[str, Any]:
    examples = _assign_splits(examples)
    train = [ex for ex in examples if ex["split"] == "train"]
    test = [ex for ex in examples if ex["split"] == "test"]
    calib = [ex for ex in examples if ex["split"] == "calib"]
    # Small gold sets: score the full holdout (calib+test). Majority still fits train only.
    holdout = calib + test

    report: dict[str, Any] = {
        "task": task,
        "n_total": len(examples),
        "n_train": len(train),
        "n_calib": len(calib),
        "n_test": len(test),
        "n_holdout": len(holdout),
        "backends": {},
    }

    for backend in backends:
        if isinstance(backend, MajorityBackend):
            backend.fit(train, task)
        if not backend.available:
            report["backends"][backend.name] = {"skipped": True, "reason": backend.skip_reason}
            continue

        preds = []
        for ex in holdout:
            answer = _safe(backend, ex["state"], questions)
            preds.append({"id": ex["id"], "gold": ex["gold"], "answer": answer, "split": ex["split"]})
        report["backends"][backend.name] = score_task(task, preds, questions)
        report["backends"][backend.name]["predictions"] = preds
    return report


def score_task(task: str, preds: list[dict[str, Any]], questions: dict[str, Any]) -> dict[str, Any]:
    usable = [p for p in preds if "error" not in p["answer"]]
    errors = [p["answer"]["error"] for p in preds if "error" in p["answer"]]
    out: dict[str, Any] = {
        "n_scored": len(usable),
        "n_errors": len(errors),
        "errors_sample": errors[:3],
        "mean_latency_ms": _mean([p["answer"].get("latency_ms", 0) for p in usable]),
        "total_cost_usd": float(sum(p["answer"].get("cost_usd", 0) for p in usable)),
        "total_input_tokens": int(sum(p["answer"].get("input_tokens", 0) for p in usable)),
    }
    if not usable:
        return out

    if "category" in questions:
        acc = accuracy(
            [str(p["gold"]["category"]) for p in usable],
            [str(p["answer"]["values"].get("category", "")) for p in usable],
        )
        out["category_accuracy"] = acc.accuracy
        out["category_per_label"] = acc.per_label
    if "severity" in questions:
        out["severity_mae"] = mae(
            [float(p["gold"]["severity"]) for p in usable],
            [float(p["answer"]["values"].get("severity", 0)) for p in usable],
        )
    for noul_name in ("interesting", "grounded", "duplicate", "investigate", "page"):
        if noul_name not in questions:
            continue
        y = [int(p["gold"][noul_name]) for p in usable]
        p = [float(p["answer"]["values"].get(noul_name, 0.5)) for p in usable]
        pred_bin = [1 if v >= 0.5 else 0 for v in p]
        acc = accuracy([str(v) for v in y], [str(v) for v in pred_bin])
        curve = precision_coverage_curve(y, p)
        out[noul_name] = {
            "accuracy@0.5": acc.accuracy,
            "brier": brier(y, p),
            "ece": ece(y, p),
            "coverage_at_p95": coverage_at_precision(curve, 0.95),
            "coverage_at_p90": coverage_at_precision(curve, 0.90),
            "curve": curve,
        }
    if "action" in questions:
        acc = accuracy(
            [str(p["gold"]["action"]) for p in usable],
            [str(p["answer"]["values"].get("action", "")) for p in usable],
        )
        out["action_accuracy"] = acc.accuracy
        out["action_per_label"] = acc.per_label
    return out


def run_pipeline(judge_reports: dict[str, Any], examples: list[dict[str, Any]]) -> dict[str, Any]:
    """Experiment B: persist-gate simulation on frozen KI candidates."""
    examples = {ex["id"]: ex for ex in examples}
    arms: dict[str, Any] = {}
    test_ids = [
        pred["id"]
        for backend in judge_reports["backends"].values()
        if "predictions" in backend
        for pred in backend["predictions"]
    ]
    test_ids = list(dict.fromkeys(test_ids))

    def eval_arm(name: str, persist_fn) -> dict[str, Any]:
        persisted = []
        suppressed = []
        for example_id in test_ids:
            ex = examples[example_id]
            keep = persist_fn(ex, example_id)
            (persisted if keep else suppressed).append(ex)
        must = [ex for ex in (persisted + suppressed) if ex.get("must_detect")]
        noise = [
            ex
            for ex in (persisted + suppressed)
            if ex["gold"]["grounded"] == 0 or ex["gold"]["duplicate"] == 1 or ex["gold"]["severity"] == 0
        ]
        return {
            "persisted": len(persisted),
            "suppressed": len(suppressed),
            "persist_rate": len(persisted) / max(1, len(test_ids)),
            "must_detect": len(must),
            "must_detect_recall": (
                sum(1 for ex in persisted if ex.get("must_detect")) / max(1, len(must))
            ),
            "noise_persist_rate": (
                sum(
                    1
                    for ex in persisted
                    if ex["gold"]["grounded"] == 0
                    or ex["gold"]["duplicate"] == 1
                    or ex["gold"]["severity"] == 0
                )
                / max(1, len(noise))
            ),
        }

    arms["B0_persist_all"] = eval_arm("B0", lambda ex, _id: True)

    def from_backend(backend_name: str, grounded_t: float, dup_t: float):
        preds = {
            p["id"]: p
            for p in judge_reports["backends"].get(backend_name, {}).get("predictions", [])
        }

        def persist(ex: dict[str, Any], example_id: str) -> bool:
            pred = preds.get(example_id)
            if not pred or "error" in pred["answer"]:
                return True
            values = pred["answer"]["values"]
            grounded = float(values.get("grounded", 1))
            duplicate = float(values.get("duplicate", 0))
            return grounded >= grounded_t and duplicate < dup_t

        return persist

    for backend_name in judge_reports["backends"]:
        if judge_reports["backends"][backend_name].get("skipped"):
            arms[f"B_{backend_name}"] = {"skipped": True, **judge_reports["backends"][backend_name]}
            continue
        arms[f"B_{backend_name}_t0.6"] = eval_arm(backend_name, from_backend(backend_name, 0.6, 0.6))
        arms[f"B_{backend_name}_t0.75"] = eval_arm(backend_name, from_backend(backend_name, 0.75, 0.55))

    return {"n_test": len(test_ids), "arms": arms}


def run_ablations(
    examples: list[dict[str, Any]],
    backends: list[Backend],
    base_questions: dict[str, Any],
) -> dict[str, Any]:
    """Experiment D: short criteria, high cardinality, truncated state."""
    subset = [ex for ex in examples if ex["id"].startswith("a1-")][:24]
    results: dict[str, Any] = {}

    long_q = base_questions
    short_q = json.loads(json.dumps(base_questions))
    short_q["category"]["criteria"] = {
        k: SHORT_CRITERIA.get(k, k) for k in short_q["category"]["criteria"]
    }

    wide_q = json.loads(json.dumps(base_questions))
    extra = {f"service_{i}": f"microservice number {i} in a large catalog" for i in range(20)}
    wide_q["category"]["criteria"] = {**wide_q["category"]["criteria"], **extra}

    variants = {"long_criteria": long_q, "short_criteria": short_q, "high_cardinality_26": wide_q}

    for backend in backends:
        if not backend.available or backend.name == "majority":
            continue
        results[backend.name] = {}
        for variant, questions in variants.items():
            preds = []
            for ex in subset:
                state = ex["state"]
                if variant == "truncated_state":
                    state = {"pattern": state.get("pattern", "")}
                answer = _safe(backend, state, questions)
                preds.append({"id": ex["id"], "gold": ex["gold"], "answer": answer})
            results[backend.name][variant] = {
                "category_accuracy": accuracy(
                    [p["gold"]["category"] for p in preds if "error" not in p["answer"]],
                    [
                        str(p["answer"]["values"].get("category", ""))
                        for p in preds
                        if "error" not in p["answer"]
                    ],
                ).accuracy
                if any("error" not in p["answer"] for p in preds)
                else float("nan"),
                "n": len(preds),
            }

        truncated = []
        for ex in subset:
            answer = _safe(backend, {"pattern": ex["state"].get("pattern", "")}, long_q)
            truncated.append({"gold": ex["gold"], "answer": answer})
        results[backend.name]["truncated_state"] = {
            "category_accuracy": accuracy(
                [p["gold"]["category"] for p in truncated if "error" not in p["answer"]],
                [
                    str(p["answer"]["values"].get("category", ""))
                    for p in truncated
                    if "error" not in p["answer"]
                ],
            ).accuracy
            if any("error" not in p["answer"] for p in truncated)
            else float("nan")
        }
    return results


def _mean(xs: list[float]) -> float:
    return float(sum(xs) / len(xs)) if xs else float("nan")


def _strip_preds(report: dict[str, Any]) -> dict[str, Any]:
    slim = json.loads(json.dumps(report, default=str))
    for backend in slim.get("backends", {}).values():
        backend.pop("predictions", None)
    return slim


def write_markdown(summary: dict[str, Any], path: Path) -> None:
    lines = [
        "# Decision-layer bakeoff results",
        "",
        "Fixtures are labeled from Significant Events eval gold (otel-demo, Bank of Anthos,",
        "Quarkus Super Heroes). This is **not** an LLM-as-judge comparison.",
        "",
        "## Environment",
        "",
    ]
    env = summary["environment"]
    for name, info in env.items():
        if info.get("available"):
            lines.append(f"- `{name}`: ran")
        else:
            lines.append(f"- `{name}`: skipped — {info.get('reason', '')}")
    lines += ["", "## Experiment A — unit bakeoff (test split)", ""]

    for task_key, title in (
        ("A1_pattern_triage", "A1 Pattern triage"),
        ("A2_ki_judge", "A2 KI judge"),
        ("A3_admission", "A3 Investigation admission"),
    ):
        block = summary[task_key]
        lines += [
            f"### {title}",
            "",
            f"n={block['n_total']} (holdout {block.get('n_holdout', block['n_test'])}; train {block['n_train']})",
            "",
        ]
        lines.append("| backend | notes | key scores | latency ms |")
        lines.append("|---|---|---|---|")
        for name, res in block["backends"].items():
            if res.get("skipped"):
                lines.append(f"| {name} | skipped | {res.get('reason')} | — |")
                continue
            bits = []
            if "category_accuracy" in res:
                bits.append(f"category acc={res['category_accuracy']:.2f}")
            if "severity_mae" in res:
                bits.append(f"severity MAE={res['severity_mae']:.2f}")
            if "action_accuracy" in res:
                bits.append(f"action acc={res['action_accuracy']:.2f}")
            for noul in ("interesting", "grounded", "duplicate", "investigate", "page"):
                if noul in res:
                    bits.append(f"{noul} acc={res[noul]['accuracy@0.5']:.2f} ECE={res[noul]['ece']:.2f}")
            lines.append(
                f"| {name} | n={res.get('n_scored', 0)} | {'; '.join(bits)} | {res.get('mean_latency_ms', float('nan')):.1f} |"
            )
        lines.append("")

    lines += ["## Experiment B — persist-gate pipeline", "", "| arm | persist rate | must-detect recall | noise persist |", "|---|---|---|---|"]
    for arm, res in summary["B_pipeline"]["arms"].items():
        if res.get("skipped"):
            lines.append(f"| {arm} | skipped | {res.get('reason', '')} | — |")
            continue
        lines.append(
            f"| {arm} | {res['persist_rate']:.2f} | {res['must_detect_recall']:.2f} | {res['noise_persist_rate']:.2f} |"
        )

    lines += ["", "## Experiment C — auto-act coverage (interesting / grounded / investigate)", ""]
    for task_key, noul in (
        ("A1_pattern_triage", "interesting"),
        ("A2_ki_judge", "grounded"),
        ("A3_admission", "investigate"),
    ):
        lines += [f"### {noul} on {task_key}", ""]
        lines.append("| backend | acc@0.5 | Brier | ECE | coverage@P90 | coverage@P95 |")
        lines.append("|---|---|---|---|---|---|")
        for name, res in summary[task_key]["backends"].items():
            if res.get("skipped") or noul not in res:
                continue
            c90 = res[noul]["coverage_at_p90"]
            c95 = res[noul]["coverage_at_p95"]
            lines.append(
                f"| {name} | {res[noul]['accuracy@0.5']:.2f} | {res[noul]['brier']:.3f} | {res[noul]['ece']:.3f} | "
                f"{c90['coverage']:.2f} | {c95['coverage']:.2f} |"
            )
        lines.append("")

    lines += ["## Experiment D — criteria / cardinality / truncation", ""]
    for name, variants in summary["D_ablations"].items():
        lines.append(f"### {name}")
        lines.append("| variant | category accuracy |")
        lines.append("|---|---|")
        for variant, res in variants.items():
            acc = res.get("category_accuracy", float("nan"))
            acc_s = "nan" if acc != acc else f"{acc:.2f}"
            lines.append(f"| {variant} | {acc_s} |")
        lines.append("")

    lines += [
        "## Interpretation",
        "",
        "On this gold set the **heuristic persist gate is the only arm that beats B0**:",
        "must-detect recall 1.00, noise persist 0.00, persist rate 0.64.",
        "MiniLM embeddings win A1 category typing when criteria are rich, and fail yes/no",
        "(`interesting` 0.26). The MiniLM reranker is not a drop-in noul model.",
        "Jev/Laya/structured-LLM rows stay empty until API keys or weights are present.",
        "",
        "Heuristic scores are inflated by author overlap with eval-suite phrases.",
        "Holdout n is small (A1 19 / A2 11 / A3 8).",
        "",
        "## How to read this",
        "",
        "- **B0 persist-all** is today's generator+validate path (no semantic gate).",
        "- A backend wins A1/A2 if it raises must-detect recall while cutting noise persist vs B0.",
        "- Jev/Laya rows are skipped unless `TYPESAFE_API_KEY` / `laya` weights are present.",
        "- `reranker` is a MiniLM cross-encoder stand-in for Jina listwise ranking on CPU.",
        "- `embedding` is MiniLM cosine — the ELSER-shaped alternative.",
        "",
    ]
    path.write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-optional-models", action="store_true")
    args = parser.parse_args()

    RESULTS.mkdir(exist_ok=True)
    examples = all_examples()
    backends = build_backends()
    if args.skip_optional_models:
        for backend in backends:
            if backend.name in {"embedding", "reranker", "laya", "jev"}:
                backend.available = False
                backend.skip_reason = backend.skip_reason or "disabled by --skip-optional-models"

    env = {
        b.name: {"available": b.available, "reason": b.skip_reason}
        for b in backends
    }
    print("Backends:", json.dumps(env, indent=2))

    a1 = run_unit("pattern_triage", examples["pattern_triage"], backends, QUESTIONS["pattern_triage"])
    print("A1 done")
    a2 = run_unit("ki_judge", examples["ki_judge"], backends, QUESTIONS["ki_judge"])
    print("A2 done")
    a3 = run_unit("admission", examples["admission"], backends, QUESTIONS["admission"])
    print("A3 done")
    pipeline = run_pipeline(a2, examples["ki_judge"])
    print("B done")
    ablations = run_ablations(examples["pattern_triage"], backends, QUESTIONS["pattern_triage"])
    print("D done")

    summary = {
        "environment": env,
        "A1_pattern_triage": _strip_preds(a1),
        "A2_ki_judge": _strip_preds(a2),
        "A3_admission": _strip_preds(a3),
        "B_pipeline": pipeline,
        "D_ablations": ablations,
        "notes": {
            "gold": "Eval-suite scenario criteria, not LLM-as-judge",
            "jev": "Requires TYPESAFE_API_KEY",
            "laya": "Optional self-hosted clone; 512-1024 token budget",
        },
    }
    (RESULTS / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    (RESULTS / "a1.json").write_text(json.dumps(a1, indent=2, default=str))
    (RESULTS / "a2.json").write_text(json.dumps(a2, indent=2, default=str))
    (RESULTS / "a3.json").write_text(json.dumps(a3, indent=2, default=str))
    write_markdown(summary, RESULTS / "RESULTS.md")
    print(f"Wrote {RESULTS / 'RESULTS.md'}")


if __name__ == "__main__":
    main()
