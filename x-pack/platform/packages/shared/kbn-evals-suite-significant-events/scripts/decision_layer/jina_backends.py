"""Jina API backends. Skipped unless JINA_API_KEY is set. See JINA.md."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

import numpy as np

from backends import Answer, Backend, _softmax, _state_text

JINA_API = "https://api.jina.ai/v1"
DEFAULT_EMBED = "jina-embeddings-v5-text-small"
DEFAULT_RERANK = "jina-reranker-v3.5"
DEFAULT_RERANK_V2 = "jina-reranker-v2-base-multilingual"


def _jina_post(path: str, payload: dict[str, Any], key: str) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{JINA_API}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode() if exc.fp else ""
        raise RuntimeError(f"Jina {path} HTTP {exc.code}: {body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Jina {path} failed: {exc}") from exc


def _usage_tokens(body: dict[str, Any]) -> int:
    usage = body.get("usage") or {}
    return int(usage.get("total_tokens") or usage.get("prompt_tokens") or 0)


def _label_docs(criteria: dict[str, str]) -> list[str]:
    return [f"{name}: {desc}" for name, desc in criteria.items()]


class _JinaBase(Backend):
    def __init__(self) -> None:
        self.key = os.environ.get("JINA_API_KEY", "")
        if not self.key:
            self.available = False
            self.skip_reason = "JINA_API_KEY not set"


class JinaEmbedBackend(_JinaBase):
    """v5-text-small cosine vs label text. Task LoRA is configurable."""

    name = "jina_embed"

    def __init__(self) -> None:
        super().__init__()
        self.model = os.environ.get("JINA_EMBED_MODEL", DEFAULT_EMBED)
        self.task = os.environ.get("JINA_EMBED_TASK", "classification")

    def _embed(self, texts: list[str]) -> tuple[np.ndarray, int]:
        body = _jina_post(
            "/embeddings",
            {
                "model": self.model,
                "task": self.task,
                "input": texts,
                "normalized": True,
                "truncate": True,
            },
            self.key,
        )
        rows = sorted(body.get("data", []), key=lambda row: row.get("index", 0))
        vecs = np.asarray([row["embedding"] for row in rows], dtype=float)
        return vecs, _usage_tokens(body)

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        started = time.perf_counter()
        text = _state_text(state)
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        tokens = 0
        for qname, q in questions.items():
            if q["type"] == "choice":
                labels = list(q["criteria"])
                docs = _label_docs(q["criteria"])
                embs, used = self._embed([text, *docs])
                tokens += used
                sims = (embs[0] @ embs[1:].T).tolist()
                probs = _softmax([s * 8 for s in sims])
                dist = dict(zip(labels, probs, strict=True))
                choice = max(dist, key=dist.get)
                values[qname] = choice
                probabilities[qname] = dist
                confidence[qname] = float(dist[choice])
            elif q["type"] == "noul":
                if qname == "duplicate":
                    existing = state.get("existing_queries") or []
                    if not existing:
                        values[qname] = 0.08
                        confidence[qname] = 0.2
                        continue
                    docs = [_state_text(item) for item in existing]
                    embs, used = self._embed([_state_text(state.get("query", state)), *docs])
                    tokens += used
                    sims = (embs[0] @ embs[1:].T).tolist()
                    p = float(np.clip((max(sims) + 1) / 2, 0.02, 0.98))
                else:
                    yes = f"Yes. {q['instructions']}"
                    no = f"No. {q['instructions']}"
                    embs, used = self._embed([text, yes, no])
                    tokens += used
                    p = float(np.clip((float(embs[0] @ embs[1]) - float(embs[0] @ embs[2]) + 1) / 2, 0.02, 0.98))
                values[qname] = p
                confidence[qname] = abs(p - 0.5) * 2
            else:
                docs = [f"severity {i}: {desc}" for i, desc in enumerate(q["criteria"])]
                embs, used = self._embed([text, *docs])
                tokens += used
                sims = (embs[0] @ embs[1:].T).tolist()
                probs = _softmax([s * 8 for s in sims])
                values[qname] = float(sum(i * p for i, p in enumerate(probs)))
                confidence[qname] = float(max(probs))
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": (time.perf_counter() - started) * 1000,
            "input_tokens": tokens,
            "cost_usd": 0.0,
        }


class JinaClassifyBackend(_JinaBase):
    """Zero-shot /v1/classify on v5-text-small — the honest choice-question arm."""

    name = "jina_classify"

    def __init__(self) -> None:
        super().__init__()
        self.model = os.environ.get("JINA_EMBED_MODEL", DEFAULT_EMBED)

    def _classify(self, text: str, labels: list[str]) -> tuple[dict[str, float], int]:
        body = _jina_post(
            "/classify",
            {"model": self.model, "input": [text], "labels": labels},
            self.key,
        )
        row = (body.get("data") or [{}])[0]
        dist: dict[str, float] = {}
        for item in row.get("predictions") or []:
            dist[str(item.get("label", ""))] = float(item.get("score", 0))
        if not dist and row.get("prediction") is not None:
            dist[str(row["prediction"])] = float(row.get("score") or 1.0)
        return dist, _usage_tokens(body)

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        started = time.perf_counter()
        text = _state_text(state)
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        tokens = 0
        for qname, q in questions.items():
            if q["type"] == "choice":
                labels = list(q["criteria"])
                docs = _label_docs(q["criteria"])
                dist_raw, used = self._classify(f"{q['instructions']}\n\n{text}", docs)
                tokens += used
                dist = {labels[i]: float(dist_raw.get(docs[i], 0.0)) for i in range(len(labels))}
                if abs(sum(dist.values()) - 1.0) > 0.05:
                    total = sum(dist.values()) or 1.0
                    dist = {k: v / total for k, v in dist.items()}
                choice = max(dist, key=dist.get) if dist else labels[0]
                values[qname] = choice
                probabilities[qname] = dist
                confidence[qname] = float(dist.get(choice, 0.0))
            elif q["type"] == "noul":
                yes = f"Yes. {q['instructions']}"
                no = f"No. {q['instructions']}"
                dist_raw, used = self._classify(text, [yes, no])
                tokens += used
                yes_s = float(dist_raw.get(yes, 0.0))
                no_s = float(dist_raw.get(no, 0.0))
                p = float(yes_s / (yes_s + no_s)) if (yes_s + no_s) else 0.5
                values[qname] = p
                confidence[qname] = abs(p - 0.5) * 2
            else:
                docs = [f"severity {i}: {desc}" for i, desc in enumerate(q["criteria"])]
                dist_raw, used = self._classify(f"{q['instructions']}\n\n{text}", docs)
                tokens += used
                scores = [float(dist_raw.get(doc, 0.0)) for doc in docs]
                total = sum(scores) or 1.0
                probs = [s / total for s in scores]
                values[qname] = float(sum(i * p for i, p in enumerate(probs)))
                confidence[qname] = float(max(probs))
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": (time.perf_counter() - started) * 1000,
            "input_tokens": tokens,
            "cost_usd": 0.0,
        }


class JinaRerankBackend(_JinaBase):
    """Listwise jina-reranker-v3.5. Duplicate is scored as retrieval, not yes/no."""

    name = "jina_rerank"

    def __init__(self, model: str | None = None, name: str | None = None) -> None:
        super().__init__()
        self.model = model or os.environ.get("JINA_RERANK_MODEL", DEFAULT_RERANK)
        if name is not None:
            self.name = name

    def _rerank(self, query: str, documents: list[str]) -> tuple[list[dict[str, Any]], int]:
        payload: dict[str, Any] = {
            "model": self.model,
            "query": query,
            "documents": documents,
            "return_documents": False,
        }
        if self.model in {"jina-reranker-v3", "jina-reranker-v3.5"}:
            max_doc = os.environ.get("JINA_MAX_DOC_LENGTH")
            if max_doc:
                payload["max_doc_length"] = int(max_doc)
        body = _jina_post("/rerank", payload, self.key)
        return list(body.get("results") or []), _usage_tokens(body)

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        started = time.perf_counter()
        text = _state_text(state)
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        tokens = 0
        for qname, q in questions.items():
            if q["type"] == "choice":
                labels = list(q["criteria"])
                docs = _label_docs(q["criteria"])
                results, used = self._rerank(f"{q['instructions']}\n\n{text}", docs)
                tokens += used
                raw = [0.0] * len(docs)
                for row in results:
                    raw[int(row["index"])] = float(row.get("relevance_score", 0))
                probs = _softmax(raw)
                dist = dict(zip(labels, probs, strict=True))
                choice = max(dist, key=dist.get)
                values[qname] = choice
                probabilities[qname] = dist
                confidence[qname] = float(dist[choice])
            elif q["type"] == "noul":
                if qname == "duplicate":
                    existing = state.get("existing_queries") or []
                    if not existing:
                        values[qname] = 0.08
                        confidence[qname] = 0.2
                        continue
                    docs = [_state_text(item) for item in existing]
                    results, used = self._rerank(_state_text(state.get("query", state)), docs)
                    tokens += used
                    best = max((float(row.get("relevance_score", 0)) for row in results), default=0.0)
                    p = float(1 / (1 + np.exp(-best)))
                else:
                    docs = [f"Yes. {q['instructions']}", f"No. {q['instructions']}"]
                    results, used = self._rerank(text, docs)
                    tokens += used
                    scores = [0.0, 0.0]
                    for row in results:
                        scores[int(row["index"])] = float(row.get("relevance_score", 0))
                    p = float(1 / (1 + np.exp(-(scores[0] - scores[1]))))
                values[qname] = p
                confidence[qname] = abs(p - 0.5) * 2
            else:
                docs = [f"{i}: {desc}" for i, desc in enumerate(q["criteria"])]
                results, used = self._rerank(f"{q['instructions']}\n\n{text}", docs)
                tokens += used
                raw = [0.0] * len(docs)
                for row in results:
                    raw[int(row["index"])] = float(row.get("relevance_score", 0))
                probs = _softmax(raw)
                values[qname] = float(sum(i * p for i, p in enumerate(probs)))
                confidence[qname] = float(max(probs))
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": (time.perf_counter() - started) * 1000,
            "input_tokens": tokens,
            "cost_usd": 0.0,
        }


class JinaRerankV2Backend(JinaRerankBackend):
    """Short-context pairwise control (1K). Isolates v3.5 listwise / long-context."""

    name = "jina_rerank_v2"

    def __init__(self) -> None:
        super().__init__(
            model=os.environ.get("JINA_RERANK_V2_MODEL", DEFAULT_RERANK_V2),
            name="jina_rerank_v2",
        )


def build_jina_backends() -> list[Backend]:
    return [
        JinaClassifyBackend(),
        JinaEmbedBackend(),
        JinaRerankBackend(),
        JinaRerankV2Backend(),
    ]
