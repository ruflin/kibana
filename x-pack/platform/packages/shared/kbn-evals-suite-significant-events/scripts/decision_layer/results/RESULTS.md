# Decision-layer bakeoff results

Fixtures are labeled from Significant Events eval gold (otel-demo, Bank of Anthos,
Quarkus Super Heroes). This is **not** an LLM-as-judge comparison.

## Environment

- `majority`: ran
- `heuristic`: ran
- `tfidf`: ran
- `jev`: skipped — TYPESAFE_API_KEY not set (Jev is waitlist/API)
- `laya`: skipped — laya package not installed
- `embedding`: ran
- `reranker`: ran

## Experiment A — unit bakeoff (test split)

### A1 Pattern triage

n=46 (holdout 19; train 27)

| backend | notes | key scores | latency ms |
|---|---|---|---|
| majority | n=19 | category acc=0.37; severity MAE=1.37; interesting acc=0.47 ECE=0.27 | 0.1 |
| heuristic | n=19 | category acc=0.74; severity MAE=0.44; interesting acc=0.89 ECE=0.12 | 0.0 |
| tfidf | n=19 | category acc=0.05; severity MAE=1.33; interesting acc=0.53 ECE=0.11 | 0.3 |
| jev | skipped | TYPESAFE_API_KEY not set (Jev is waitlist/API) | — |
| laya | skipped | laya package not installed | — |
| embedding | n=19 | category acc=0.95; severity MAE=1.21; interesting acc=0.26 ECE=0.24 | 41.5 |
| reranker | n=19 | category acc=0.16; severity MAE=0.93; interesting acc=0.47 ECE=0.03 | 37.5 |

### A2 KI judge

n=26 (holdout 11; train 15)

| backend | notes | key scores | latency ms |
|---|---|---|---|
| majority | n=11 | category acc=0.27; severity MAE=1.00; grounded acc=0.64 ECE=0.10; duplicate acc=1.00 ECE=0.20 | 0.1 |
| heuristic | n=11 | category acc=0.82; severity MAE=0.68; grounded acc=1.00 ECE=0.19; duplicate acc=1.00 ECE=0.08 | 0.0 |
| tfidf | n=11 | category acc=0.27; severity MAE=0.96; grounded acc=0.36 ECE=0.27; duplicate acc=0.00 ECE=0.76 | 0.4 |
| jev | skipped | TYPESAFE_API_KEY not set (Jev is waitlist/API) | — |
| laya | skipped | laya package not installed | — |
| embedding | n=11 | category acc=0.36; severity MAE=0.87; grounded acc=0.55 ECE=0.14; duplicate acc=0.91 ECE=0.50 | 67.6 |
| reranker | n=11 | category acc=0.64; severity MAE=0.83; grounded acc=0.36 ECE=0.16; duplicate acc=0.91 ECE=0.48 | 61.6 |

### A3 Investigation admission

n=20 (holdout 8; train 12)

| backend | notes | key scores | latency ms |
|---|---|---|---|
| majority | n=8 | action acc=0.38; investigate acc=0.62 ECE=0.04; page acc=0.75 ECE=0.08 | 0.1 |
| heuristic | n=8 | action acc=0.38; investigate acc=0.88 ECE=0.28; page acc=0.75 ECE=0.23 | 0.0 |
| tfidf | n=8 | action acc=0.50; investigate acc=0.62 ECE=0.03; page acc=0.75 ECE=0.10 | 0.2 |
| jev | skipped | TYPESAFE_API_KEY not set (Jev is waitlist/API) | — |
| laya | skipped | laya package not installed | — |
| embedding | n=8 | action acc=0.25; investigate acc=0.25 ECE=0.25; page acc=0.25 ECE=0.26 | 36.5 |
| reranker | n=8 | action acc=0.25; investigate acc=0.62 ECE=0.11; page acc=0.75 ECE=0.24 | 37.1 |

## Experiment B — persist-gate pipeline

| arm | persist rate | must-detect recall | noise persist |
|---|---|---|---|
| B0_persist_all | 1.00 | 1.00 | 1.00 |
| B_majority_t0.6 | 1.00 | 1.00 | 1.00 |
| B_majority_t0.75 | 0.00 | 0.00 | 0.00 |
| B_heuristic_t0.6 | 0.64 | 1.00 | 0.00 |
| B_heuristic_t0.75 | 0.64 | 1.00 | 0.00 |
| B_tfidf_t0.6 | 0.00 | 0.00 | 0.00 |
| B_tfidf_t0.75 | 0.00 | 0.00 | 0.00 |
| B_jev | skipped | TYPESAFE_API_KEY not set (Jev is waitlist/API) | — |
| B_laya | skipped | laya package not installed | — |
| B_embedding_t0.6 | 0.00 | 0.00 | 0.00 |
| B_embedding_t0.75 | 0.00 | 0.00 | 0.00 |
| B_reranker_t0.6 | 0.00 | 0.00 | 0.00 |
| B_reranker_t0.75 | 0.00 | 0.00 | 0.00 |

## Experiment C — auto-act coverage (interesting / grounded / investigate)

### interesting on A1_pattern_triage

| backend | acc@0.5 | Brier | ECE | coverage@P90 | coverage@P95 |
|---|---|---|---|---|---|
| majority | 0.47 | 0.321 | 0.267 | 0.00 | 0.00 |
| heuristic | 0.89 | 0.083 | 0.117 | 0.37 | 0.37 |
| tfidf | 0.53 | 0.254 | 0.108 | 0.00 | 0.00 |
| embedding | 0.26 | 0.252 | 0.239 | 0.00 | 0.00 |
| reranker | 0.47 | 0.252 | 0.032 | 0.00 | 0.00 |

### grounded on A2_ki_judge

| backend | acc@0.5 | Brier | ECE | coverage@P90 | coverage@P95 |
|---|---|---|---|---|---|
| majority | 0.64 | 0.241 | 0.097 | 0.00 | 0.00 |
| heuristic | 1.00 | 0.035 | 0.187 | 0.64 | 0.64 |
| tfidf | 0.36 | 0.309 | 0.273 | 0.00 | 0.00 |
| embedding | 0.55 | 0.250 | 0.135 | 0.00 | 0.00 |
| reranker | 0.36 | 0.245 | 0.155 | 0.00 | 0.00 |

### investigate on A3_admission

| backend | acc@0.5 | Brier | ECE | coverage@P90 | coverage@P95 |
|---|---|---|---|---|---|
| majority | 0.62 | 0.236 | 0.042 | 0.00 | 0.00 |
| heuristic | 0.88 | 0.123 | 0.275 | 0.25 | 0.25 |
| tfidf | 0.62 | 0.235 | 0.025 | 0.00 | 0.00 |
| embedding | 0.25 | 0.251 | 0.252 | 0.00 | 0.00 |
| reranker | 0.62 | 0.245 | 0.111 | 0.00 | 0.00 |

## Experiment D — criteria / cardinality / truncation

### heuristic
| variant | category accuracy |
|---|---|
| long_criteria | 0.79 |
| short_criteria | 0.79 |
| high_cardinality_26 | 0.79 |
| truncated_state | 0.88 |

### tfidf
| variant | category accuracy |
|---|---|
| long_criteria | 0.12 |
| short_criteria | 0.42 |
| high_cardinality_26 | 0.00 |
| truncated_state | 0.29 |

### embedding
| variant | category accuracy |
|---|---|
| long_criteria | 0.88 |
| short_criteria | 0.75 |
| high_cardinality_26 | 0.88 |
| truncated_state | 0.75 |

### reranker
| variant | category accuracy |
|---|---|
| long_criteria | 0.38 |
| short_criteria | 0.29 |
| high_cardinality_26 | 0.38 |
| truncated_state | 0.71 |

## Interpretation

**What actually ran.** Majority, heuristic keyword rules, hashed TF-IDF, MiniLM embeddings, and a MiniLM cross-encoder (Jina-shaped reranker). Jev and Laya did not run in this environment (no `TYPESAFE_API_KEY`, no Laya weights). Structured LLM / Kibana inference also did not run (no Scout/connector).

**Headline.** On this gold set the **heuristic persist gate is the only arm that beats B0**: it keeps every `must_detect` query (recall 1.00), drops all labeled noise (noise persist 0.00), and persists 64% of candidates. Majority either persists everything or nothing depending on the threshold. Embedding/reranker/TF-IDF gates suppressed everything at 0.6/0.75 — they are not calibrated for `grounded`/`duplicate` nouls.

**Unit scores.**

- A1 category: MiniLM embedding 0.95 > heuristic 0.74 > majority 0.37. Generic embeddings are good at *typing* a pattern when label descriptions are rich.
- A1 interesting: heuristic 0.89; embeddings 0.26. MiniLM does not implement a usable yes/no for “is this worth a KI?”
- A2 grounded/duplicate: heuristic is perfect on this set; the reranker’s duplicate accuracy (0.91) is majority-class (few duplicates in holdout), not a real ranking win.
- A3 is n=8 holdout — treat action accuracy as anecdotal.

**Ablations.** Heuristic is invariant to criteria wording (it ignores `criteria` and reads the log text). Embedding drops when criteria are shortened (0.88 → 0.75) and survives 26-way choice (0.88). TF-IDF collapses at 26-way (0.00). The reranker *improves* when state is truncated to the pattern only (0.38 → 0.71) — same “context rot” failure mode TypeSafe documents for Jev.

## Limits (read before over-fitting a product decision)

- Holdout sizes are small (A1 19, A2 11, A3 8). Good enough to reject “generic MiniLM replaces a decision layer”; not enough to rank 1-point differences.
- The heuristic has **author overlap** with the fixtures: both were written from the same eval-suite phrases (`SQLState: 08001`, `GetCartAsync`, `Login Successful.`). That inflates heuristic A1/A2 scores. A Customer-0 unlabeled dump would be the fair next test.
- Jev, Laya, and a Kibana structured-LLM connector were **not measured**. Re-run `python3 run_experiments.py` with `TYPESAFE_API_KEY` and/or `pip install laya` to fill those rows on the same fixtures.
- Pipeline B is a **frozen-candidate simulation**. It does not re-run `identifyKIQueries` or change-point detection.

## How to read this

- **B0 persist-all** is today's generator+validate path (no semantic gate).
- A backend wins A1/A2 if it raises must-detect recall while cutting noise persist vs B0.
- Jev/Laya rows are skipped unless `TYPESAFE_API_KEY` / `laya` weights are present.
- `reranker` is a MiniLM cross-encoder stand-in for Jina listwise ranking on CPU.
- `embedding` is MiniLM cosine — the ELSER-shaped alternative.

