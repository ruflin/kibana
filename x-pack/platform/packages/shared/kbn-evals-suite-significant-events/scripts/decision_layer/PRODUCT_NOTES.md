# Product notes: where a decision layer fits

Research notes from the bakeoff conversation. Not measured unless `RESULTS.md`
says so. Jev = TypeSafe System One (choice / score / noul, no text generation).
Categorizer = Jina `/v1/classify`, v5 embeddings, or keyword bins.

Do not replace ES|QL generation, `change_point`, or `events_write` with Jev.

## 1. Source-parsed log patterns — which are important?

**Possible.** Source parsing (`code_analysis.verified_strings` / `code_context`)
plus `log_patterns` will produce far more templates than the LLM is allowed to
see today (`selectLogPatternsForLlm`: 4 common + 6 rare). Gate **before**
`identifyKIQueries`.

Importance is a noul (`interesting`), not a category. Bakeoff: MiniLM category
0.95, MiniLM interesting 0.26. A categorizer answers “what kind?”; Jev answers
“keep it?”.

**Recommended:** deterministic noise drop → categorizer (drop `expected_noise`)
→ Jev noul on the ambiguous middle (operational / config / code-only strings)
→ only then generate ES|QL.

Treat `verified_strings` (in logs **and** code) as a higher prior than
`code_context` (code-only, not yet observed). The A2 `grounded` noul is the
right question for the second set.

| | Jev | Categorizer |
|---|---|---|
| **Pros** | Native yes/no + severity; calibrated; cheap vs generator LLM | Scales to thousands of format strings; EIS-native; Nightshift already has the bins |
| **Cons** | 255-way / 64k — batch; unmeasured; waitlist | “Error” ≠ “worth a KI”; uncalibrated persist will over-keep |

## 2. KI duplicates

**Exact ES|QL is already solved** (`validateKIQueries` + `normalizeEsqlSafe`).
The gap is functional / same-signal near-duplicates. The generator prompt asks
for Case 1 SKIP / `replaces` and admits near-duplicates slip through. Existing
query context is capped at 50.

A **categorizer cannot decide duplicates**. Two different DB failures are both
`error` and should both live.

| Tool | Use |
|---|---|
| Current validator | Exact normalized ES|QL |
| Jina rerank v3.5 or v5 `text-matching` | Candidate `{title, description, esql}` vs `existing_queries` — this is retrieval |
| Jev | noul `duplicate` + choice `which existing id` / `none`; wrap a rerank score if you want a calibrated persist/skip |

Do not trust bakeoff A2 duplicate accuracy (majority-class + author overlap).
Score rank of the true neighbor when one exists.

## 3. Detection engine

`system-significant-events-detection` is **not** an LLM. It runs ES `change_point`
on per-rule alert counts and writes an immutable detection only on a type
transition (`stationary` is never written). Lifecycle, open/dismissed, and
investigate/page live in **discovery** (`ai.agent`, batch ≤10, flaky-rule
count heuristic).

**Jev cannot replace Detection.** No time series, no p-value, no fleet scan.

**Jev can sit after a written transition** (or on the discovery batch):

| Decision | Jev | Instead of |
|---|---|---|
| Promote to an event? | noul `escalate` | Every transition → discovery agent |
| New vs attach to open event? | choice of open ids + `none` | Discovery LLM correlation |
| Investigate / page / watch | choice `action` | Severity ≥60/80 hard gate |
| Known-noisy rule? | noul `flaky` | Count ≥10 in 24h + 6h probe |

Do **not** call Jev inside `foreach_rule` of the change_point scan. Call it
only on written transitions or the ≤10 discovery batch.

A3 (admission) was n=8; action accuracy tied majority at 0.38 — anecdotal.

## 4. Jev as a workflow decision step

**Yes.** Nightshift *is* workflows. Today decisions are:

- `type: if` / `switch` — deterministic (`is_transition`, flaky count, severity)
- `type: ai.agent` + `structured_output` — LLM (discovery, investigation)
- `waitForApproval` — human
- `http` / `kibana.request` — anything else

Jev is the missing middle: a structured decision without an agent turn.

### Near-term (no new step type)

`http` POST to TypeSafe, then `if` on the noul. Sketch:

```yaml
- name: decide_escalate
  type: http
  with:
    method: POST
    url: https://api.typesafe.ai/v1/systemone
    headers:
      Authorization: "Bearer {{ consts.jev_key }}"
      Content-Type: application/json
    body:
      model: jev-1.13.0
      state: "{{ steps.get_detections.output }}"
      questions:
        escalate:
          type: noul
          instructions: "Should discovery spend an agent turn on this change-point?"
        action:
          type: choice
          instructions: "Single next action."
          criteria:
            suppress: "known noise or flaky rule"
            watch: "record only"
            investigate: "open event, start investigation"
            page: "investigate and page"

- name: maybe_discover
  type: if
  condition: "steps.decide_escalate.output.answers.escalate.noul >= 0.75"
  steps:
    - name: run_discovery_agent
      type: ai.agent
      agent-id: significant-events.discovery
      # ...
```

Mid-confidence (`0.4–0.75`) → agent or `waitForApproval`. Fail **closed** on
HTTP error (do not skip the detection write).

### Product-shaped

A first-class step (`ai.decision` / `jev.decide`) that takes `state` +
`questions`, uses `connector-id-by-feature` like `ai.agent`, bounds input
(64k / 255-way), and exposes `answers.*.noul` / `choice` / `confidence` to
Liquid. Same step for KI persist, detection escalate, investigation admit.

Do **not** hide Jev inside `ai.agent` as a tool — you still pay for the agent
loop. Jev cannot `events_write` or generate titles.

| Pros | Cons |
|---|---|
| Workflows already orchestrate Nightshift | First-class type is platform work |
| Same step reused at three gates | No connector today; secrets / inference-feature registry |
| Calibrated three-way: auto / agent / human | Liquid on floats is brittle; pin thresholds in `consts` |
| `http`+`if` works without a new type | `foreach` over the fleet is the wrong cost model |
| Leaves generation and `change_point` alone | Unmeasured; need detection-shaped gold, not only KI fixtures |

**Best first workflow insertion:** discovery.yaml, between `get_detections` and
`run_discovery_agent`. Second: queries persist gate after `_generate`. Third:
investigation trigger (`gate_investigatable_severity`).
