# How to test and compare Jina models

The current `reranker` row is **not Jina**. It is
`cross-encoder/ms-marco-MiniLM-L-6-v2` (512-token pairwise MS-MARCO). Using that
row as a Jina result would be a category error: MiniLM already failed the
persist-gate because its scores are uncalibrated nouls and it improves when
state is truncated (context rot). Jina-reranker-v3.5 is a 0.6B **listwise**
model with a 131K context window, trained for retrieval, and available on EIS.

This note is the protocol for a fair Jina comparison on the **same fixtures,
questions, and splits** as experiments A–D. Do not introduce an LLM judge.

## Which Jina models to run (and which to skip)

Jina (Elastic-owned) is a search-foundation stack, not a System One decision
model. Map each Nightshift question to the Jina API that actually does that job.

| Bakeoff job | Honest Jina model | API | Why this one |
|---|---|---|---|
| A1/A2/A3 **choice** (category, action) | `jina-embeddings-v5-text-small` zero-shot | `POST /v1/classify` | Labels + scores, up to 512 classes. Closest to a classifier. |
| A1 **category** (embedding control) | same model, `task=classification` | `POST /v1/embeddings` | LoRA adapter for categorization; comparable to MiniLM cosine. |
| A2 **duplicate** | `jina-reranker-v3.5` | `POST /v1/rerank` | True retrieval: candidate KI vs `existing_queries`. |
| A2 **duplicate** (symmetric control) | v5-text-small, `task=text-matching` | `POST /v1/embeddings` | Jina's stated duplicate / paraphrase adapter. |
| A1/A2/A3 **noul** (interesting, grounded, investigate, page) | v3.5 yes/no pair **and** classify yes/no | rerank + classify | Rerankers emit relevance, not calibrated P(yes). Measure both raw and calib-split. |
| A1/A3 **choice listwise** | `jina-reranker-v3.5` | `POST /v1/rerank` | One forward pass over the label list. Tests 6-way and D's 26-way. |
| Short-context control | `jina-reranker-v2-base-multilingual` | `POST /v1/rerank` | 1K context, pairwise-ish. Isolates “v3.5 long-context” from “any Jina reranker”. |
| Cheap embed control | `jina-embeddings-v5-text-nano` | embed / classify | 8K / 768-d. Only worth running if small wins and you care about EIS cost. |

Skip for this bakeoff (wrong job or extra confounders): `jina-reranker-m0`
(multimodal), `jina-vlm` (generates text), ReaderLM, code embeddings, ColBERT
(late-interaction infra we do not have), `jina-embeddings-v4` (3.8B, no extra
signal for log text).

Default production-shaped pair, if you only run two:

1. `jina_classify` — `jina-embeddings-v5-text-small` via `/v1/classify`
2. `jina_rerank` — `jina-reranker-v3.5` via `/v1/rerank`

That is also the EIS pair Kibana already knows (`service: elastic`,
`model_id: jina-embeddings-v5-text-small` / `jina-reranker-v3.5`).

## What must stay identical

- Fixtures and gold from `fixtures.py` (eval-suite criteria, not an LLM).
- Train / calib / holdout splits from `metrics.split_indices`.
- Question text in `QUESTIONS` (criteria wording is part of the stimulus).
- Product metric: persist-gate vs **B0 persist-all** (must-detect recall, noise
  persist, persist rate). A Jina win on A1 category accuracy alone is not a
  product win.
- Cost and latency recorded per call (`usage.total_tokens`, wall ms).

## How to phrase each Jina call

Jina is a retriever. The “query” and “documents” you send **are** the
experiment. Freeze these templates; if you change them, it is a new arm.

### Choice (category / action)

**Classify (primary).**

```
input  = json(state)
labels = ["{name}: {criteria[name]}", ...]
pick   = response.data[0].prediction
probs  = {label: score}  # already a distribution-ish score
```

**Embed (control, same model as MiniLM cosine).**

```
task = classification
sims = cosine(embed(state), embed(label_text))
choice = argmax(softmax(sims))
```

**Rerank listwise (v3.5).**

```
query     = "{instructions}\n\n{json(state)}"
documents = ["{name}: {criteria[name]}", ...]
choice    = documents[results[0].index]  # highest relevance_score
```

Do **not** softmax relevance scores and call them probabilities until you have
fitted a temperature on the calib split. Report gold@1 / MRR as well as
accuracy.

### Noul (interesting / grounded / investigate / page)

Two encodings, both required. MiniLM failed this job; do not assume Jina
fixes it.

**Yes/no pair (same shape as the MiniLM reranker, so the delta is the model).**

```
query     = json(state)
documents = ["Yes. {instructions}", "No. {instructions}"]
p_raw     = sigmoid(score_yes - score_no)   # rerank
          | score_yes / (score_yes + score_no)  # classify
```

**Pointwise relevance (Jina-native).**

```
query = instructions
documents = [json(state)]
p_raw = sigmoid(relevance_score)   # one document, no contrast
```

Pointwise will look over-confident. That is expected. The question is whether
**calib-split temperature / Platt** moves coverage@P90 off zero.

### Duplicate (do not treat as a yes/no noul)

This is the only Nightshift question that is literally Jina’s training
objective.

```
query     = json(candidate query)
documents = [json(q) for q in existing_queries] or ["(no existing queries)"]
p_dup     = max(relevance_score) if existing_queries else 0.08
```

Score this both as noul-at-0.5 **and** as rank-of-true-duplicate when
`existing_queries` is non-empty. The current holdout has few duplicates;
do not declare a Jina win from majority-class accuracy (MiniLM reranker
already scored 0.91 that way).

## Experiments to run (on top of A–D)

Reuse A–D so Jina rows land in the same tables. Then add four Jina-only
sweeps. Small n still applies (holdout 19 / 11 / 8); these sweeps exist to
**reject** bad uses of Jina, not to rank 1-point differences.

| ID | Question | Arms | Pass / fail |
|---|---|---|---|
| J1 Same-protocol A–D | Does real Jina beat MiniLM and B0? | `jina_classify`, `jina_embed`, `jina_rerank` (v3.5), `jina_rerank_v2` | Product pass = persist-gate beats B0 on must-detect **and** cuts noise. Category-only wins are noted, not shipped. |
| J2 Task adapter | Does v5 LoRA choice matter? | embed `classification` vs `text-matching` vs `retrieval.query` on A1 category + A2 duplicate | If adapters are flat, MiniLM-style cosine was enough and v5 is “just a better MiniLM”. |
| J3 Listwise vs short | Is v3.5’s listwise 131K the thing? | v3.5 vs v2-base vs MiniLM reranker on A1 category and D `high_cardinality_26` | v3.5 should not collapse at 26-way (TF-IDF did; MiniLM embed did not). v2 should hurt more on long state. |
| J4 Context budget | Does Jina avoid MiniLM context rot? | full state vs `truncated_state` vs `max_doc_length` 512 / 2K / 8K | MiniLM reranker **improved** when truncated (0.38 → 0.71). Jina fails this test if it does the same. |
| J5 Calibrate then gate | Are raw Jina scores usable as nouls? | raw 0.6/0.75 vs temperature/Platt fit on **calib only**, applied to holdout | Neural gates persisted 0 at 0.6–0.75. A fair Jina comparison **must** include a calib-split transform before calling persist. |

Transport is not a quality experiment: Jina API vs EIS (`_inference`) vs
on-prem Docker should be the same weights. Measure EIS only if you care about
Nightshift latency/cost in-cluster.

## What would count as a Jina win

- **Typing:** A1 category accuracy ≥ MiniLM embed (0.95) *or* clearly better on
  short-criteria / 26-way (MiniLM dropped 0.88 → 0.75 when criteria shortened).
- **Duplicate:** rank metrics on the subset with a true neighbor, not noul
  accuracy on a majority-negative holdout.
- **Persist-gate:** must-detect recall = 1.00 and noise persist < 1.00, **after
  calib-split calibration**. Raw softmax at 0.6 is not a fair bar — we already
  know that fails for MiniLM.
- **Auto-act:** coverage@P90 > 0 on interesting / grounded / investigate with
  ECE not worse than heuristic (heuristic is 0.12 / 0.19 / 0.28, and is
  inflated by author overlap).
- **Cost/latency:** tokens and ms vs Jev ($0.042/MTok, ~70–500 ms) and vs
  local MiniLM (~40 ms, $0). Jina API/EIS will lose on cost unless quality
  lands in the persist-gate column.

## Known traps

- **Do not name MiniLM `reranker` as Jina in write-ups.** Keep that row as the
  CPU proxy; add `jina_*` rows beside it.
- **Do not compare uncalibrated Jina nouls to the keyword heuristic.** The
  heuristic is a hand-tuned probability; Jina emits a relevance score.
- **Do not over-read A3** (n=8). Use it as a smoke test for the action choice.
- **CC-BY-NC vs EIS.** Self-hosting some Jina weights is non-commercial.
  Nightshift should assume EIS / Elastic-hosted IDs, not a random HF download.
- **Author-overlap still applies.** Jina cannot be “validated” on phrases the
  heuristic was written from (`SQLState: 08001`, `GetCartAsync`). A Customer-0
  dump remains the external test.
- **Frozen candidates.** Pipeline B still does not re-run `identifyKIQueries`.

## How to run

Jina rows skip unless `JINA_API_KEY` is set (free tier at jina.ai is enough
for this gold set).

```bash
cd x-pack/platform/packages/shared/kbn-evals-suite-significant-events/scripts/decision_layer
JINA_API_KEY=… python3 run_experiments.py --backends jina_classify,jina_embed,jina_rerank,jina_rerank_v2
```

Optional env:

- `JINA_EMBED_MODEL` (default `jina-embeddings-v5-text-small`)
- `JINA_EMBED_TASK` (default `classification`; J2 overrides per arm)
- `JINA_RERANK_MODEL` (default `jina-reranker-v3.5`)
- `JINA_RERANK_V2_MODEL` (default `jina-reranker-v2-base-multilingual`)

To replay J2–J4 without editing code, run the same command three times with
`JINA_EMBED_TASK=text-matching` / `retrieval.query` and compare `RESULTS.md`.
J5 (calib-split Platt) is not auto-applied; fit on the calib predictions in
`a1.json` / `a2.json` before declaring a persist-gate winner.

EIS variant (same protocol, different transport): point the backends at
`POST {KIBANA_URL}/internal/inference/...` or ES `_inference/rerank/{id}`
once a Scout stack is up. Do not mix EIS and Jina-API rows in one table
without labeling the transport.
