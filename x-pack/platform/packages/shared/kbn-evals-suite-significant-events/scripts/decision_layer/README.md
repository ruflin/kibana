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
| `reranker` | MiniLM-L6 MS-MARCO cross-encoder (CPU proxy, **not** Jina) |
| `jev` | `TYPESAFE_API_KEY` |
| `laya` | `pip install laya` and HF weights |
| `jina_classify` | `JINA_API_KEY` — v5-text-small `/v1/classify` |
| `jina_embed` | `JINA_API_KEY` — v5-text-small `/v1/embeddings` |
| `jina_rerank` | `JINA_API_KEY` — `jina-reranker-v3.5` |
| `jina_rerank_v2` | `JINA_API_KEY` — v2-base short-context control |

Jina comparison protocol: [`JINA.md`](./JINA.md).

Product notes (pattern importance, KI duplicates, detection, Jev as a
workflow step): [`PRODUCT_NOTES.md`](./PRODUCT_NOTES.md).

## Run

```bash
python3 run_experiments.py
JINA_API_KEY=… python3 run_experiments.py --backends jina_classify,jina_embed,jina_rerank,jina_rerank_v2
```

Writes `results/RESULTS.md` and JSON dumps. Optional models are used when
importable / keyed and skipped otherwise.
