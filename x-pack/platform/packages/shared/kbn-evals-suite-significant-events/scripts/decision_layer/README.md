# Nightshift decision-layer bakeoff

Offline experiments comparing System One / classifier alternatives for KI
generation and Nightshift admission. Gold labels come from the Significant
Events eval suite criteria (otel-demo, Bank of Anthos, Quarkus Super Heroes),
not from an LLM judge.

## What runs

| Experiment | Spec |
|---|---|
| A1 | Pattern triage (`interesting`, `category`, `severity`) |
| A2 | KI judge (`category`, `severity`, `grounded`, `duplicate`) |
| A3 | Investigation admission (`investigate`, `page`, `action`) |
| B | Persist-gate pipeline on frozen A2 candidates |
| C | Calibration + precision-coverage auto-act curves |
| D | Short vs long criteria, 26-way cardinality, truncated state |

## Backends

| Backend | Needs |
|---|---|
| `majority` | nothing (train-split prior) |
| `heuristic` | nothing (SRE keyword rules) |
| `tfidf` | numpy |
| `embedding` | `sentence-transformers` + MiniLM |
| `reranker` | `sentence-transformers` + MiniLM cross-encoder (Jina-shaped) |
| `jev` | `TYPESAFE_API_KEY` |
| `laya` | `pip install laya` and HF weights |

## Run

```bash
python3 run_experiments.py
```

Writes `results/RESULTS.md` and JSON dumps. Optional models are used when
importable and skipped otherwise.
