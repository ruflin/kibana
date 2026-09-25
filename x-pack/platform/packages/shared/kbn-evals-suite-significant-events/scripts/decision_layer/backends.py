"""Decision backends that all implement the same question contract."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

import numpy as np

Answer = dict[str, Any]


def _softmax(xs: list[float]) -> list[float]:
    arr = np.asarray(xs, dtype=float)
    arr = arr - np.max(arr)
    exp = np.exp(arr)
    return (exp / np.sum(exp)).tolist()


def _state_text(state: dict[str, Any], max_chars: int | None = None) -> str:
    text = json.dumps(state, ensure_ascii=True, sort_keys=True)
    if max_chars is not None and len(text) > max_chars:
        return text[:max_chars]
    return text


class Backend:
    name = "base"
    available = True
    skip_reason = ""

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        raise NotImplementedError

    def close(self) -> None:
        return


class MajorityBackend(Backend):
    """Train-split prior. Used as the 'do nothing smart' control."""

    name = "majority"

    def __init__(self) -> None:
        self.priors: dict[str, dict[str, float]] = {}

    def fit(self, examples: list[dict[str, Any]], task: str) -> None:
        from collections import Counter

        if task == "pattern_triage":
            interesting = Counter(ex["gold"]["interesting"] for ex in examples)
            category = Counter(ex["gold"]["category"] for ex in examples)
            severity = [ex["gold"]["severity"] for ex in examples]
            self.priors[task] = {
                "interesting": interesting.most_common(1)[0][0] if interesting else 0,
                "category": category.most_common(1)[0][0] if category else "expected_noise",
                "severity": float(np.mean(severity)) if severity else 0.0,
                "interesting_rate": (
                    interesting[1] / max(1, sum(interesting.values())) if interesting else 0.0
                ),
            }
        elif task == "ki_judge":
            category = Counter(ex["gold"]["category"] for ex in examples)
            self.priors[task] = {
                "category": category.most_common(1)[0][0] if category else "error",
                "severity": float(np.mean([ex["gold"]["severity"] for ex in examples]) if examples else 0),
                "grounded": float(np.mean([ex["gold"]["grounded"] for ex in examples]) if examples else 0),
                "duplicate": float(np.mean([ex["gold"]["duplicate"] for ex in examples]) if examples else 0),
            }
        else:
            action = Counter(ex["gold"]["action"] for ex in examples)
            self.priors[task] = {
                "investigate": float(np.mean([ex["gold"]["investigate"] for ex in examples]) if examples else 0),
                "page": float(np.mean([ex["gold"]["page"] for ex in examples]) if examples else 0),
                "action": action.most_common(1)[0][0] if action else "suppress",
            }

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        task = next(
            name
            for name, spec in (
                ("pattern_triage", {"interesting", "category", "severity"}),
                ("ki_judge", {"category", "grounded", "duplicate"}),
                ("admission", {"investigate", "page", "action"}),
            )
            if spec <= set(questions)
        )
        prior = self.priors.get(task, {})
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        for qname, q in questions.items():
            if q["type"] == "noul":
                p = float(prior.get(qname, prior.get(f"{qname}_rate", 0.5)))
                if qname == "interesting":
                    p = float(prior.get("interesting_rate", 0.5))
                values[qname] = p
                confidence[qname] = 0.3
            elif q["type"] == "choice":
                choice = str(prior.get(qname, next(iter(q["criteria"]))))
                values[qname] = choice
                probabilities[qname] = {k: (1.0 if k == choice else 0.0) for k in q["criteria"]}
                confidence[qname] = 0.3
            else:
                values[qname] = float(prior.get(qname, 1.0))
                confidence[qname] = 0.3
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": 0.1,
            "input_tokens": 0,
            "cost_usd": 0.0,
        }


class HeuristicBackend(Backend):
    """Keyword SRE rules — the deterministic alternative to a System One model."""

    name = "heuristic"

    ERROR = (
        "error",
        "exception",
        "timeout",
        "refused",
        "unavailable",
        "failed",
        "failure",
        "sqlstate",
        "jdbc",
        "dial tcp",
        "econnrefused",
        "oom",
        "mongo",
        "kafka",
        "srmsg",
        "nack",
        "psqlexception",
        "charge card",
        "connection attempt",
    )
    RESOURCE = ("oomkilled", "heap space", "disk", "enospc", "killing", "memory", "valkey", "redis")
    CONFIG = ("scalingreplicaset", "rollout", "feature flag", "replica")
    SECURITY = ("jwt", "jndi", "ldap", "handshake_failure", "cve", "unauthorized")
    NOISE = (
        "login successful",
        "submitted successfully",
        "initiated successfully",
        "getcartasync",
        "confirmation email sent",
        "charge request received",
        "transaction complete",
        "kube-probe",
        "/health",
        "background saving",
        "fight simulation completed",
        "targeted ad request",
        "listrecommendations",
        "sending quote",
        "started application",
    )
    OPS = ("throughput", "stats", "count(*)", "placeorder", "elapsedmillis", "request volume")

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        started = time.perf_counter()
        text = _state_text(state).lower()
        scores = {
            "expected_noise": self._hits(text, self.NOISE),
            "error": self._hits(text, self.ERROR),
            "resource": self._hits(text, self.RESOURCE),
            "resource_health": self._hits(text, self.RESOURCE),
            "config": self._hits(text, self.CONFIG),
            "configuration": self._hits(text, self.CONFIG),
            "security": self._hits(text, self.SECURITY),
            "operational": self._hits(text, self.OPS) + (0.4 if "stats" in text else 0.0),
        }
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}

        for qname, q in questions.items():
            if q["type"] == "choice":
                raw = [scores.get(key, 0.1) + 0.15 for key in q["criteria"]]
                probs = _softmax(raw)
                dist = dict(zip(q["criteria"], probs, strict=True))
                choice = max(dist, key=dist.get)
                values[qname] = choice
                probabilities[qname] = dist
                confidence[qname] = float(dist[choice])
            elif q["type"] == "noul":
                p = self._noul(qname, text, scores, state)
                values[qname] = p
                confidence[qname] = abs(p - 0.5) * 2
            else:
                sev = self._severity(text, scores)
                values[qname] = sev
                confidence[qname] = 0.55

        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": (time.perf_counter() - started) * 1000,
            "input_tokens": len(text.split()),
            "cost_usd": 0.0,
        }

    @staticmethod
    def _hits(text: str, needles: tuple[str, ...]) -> float:
        return float(sum(1.0 for n in needles if n in text))

    def _noul(self, name: str, text: str, scores: dict[str, float], state: dict[str, Any]) -> float:
        if name == "interesting":
            if scores["expected_noise"] >= 1 and scores["error"] == 0:
                return 0.12
            return float(np.clip(0.2 + 0.25 * scores["error"] + 0.2 * scores["resource"], 0.05, 0.95))
        if name == "grounded":
            features = state.get("features") or []
            speculative = any(
                token in text
                for token in ("jndi", "enospc", "handshake_failure", "stream name", "no tls", "no log4j")
            )
            if speculative and not any("error_logs" in str(f).lower() for f in features):
                return 0.18
            success_alert = any(n in text for n in self.NOISE) and "stats" not in text
            if success_alert:
                return 0.22
            return 0.82 if features else 0.4
        if name == "duplicate":
            existing = state.get("existing_queries") or []
            if not existing:
                return 0.08
            blob = " ".join(
                f"{q.get('title', '')} {q.get('esql', '')} {q.get('description', '')}" for q in existing
            ).lower()
            query = json.dumps(state.get("query", {})).lower()
            overlap = sum(
                1
                for token in ("sqlstate", "08001", "charge card", "srmsg18206", "connect to redis")
                if token in blob and token in query
            )
            return float(np.clip(0.15 + 0.35 * overlap, 0.05, 0.95))
        if name == "investigate":
            return float(np.clip(0.15 + 0.2 * scores["error"] + 0.15 * scores["resource"], 0.05, 0.95))
        if name == "page":
            critical = "80-critical" in text or scores["error"] >= 2
            return 0.8 if critical else 0.15
        return 0.5

    def _severity(self, text: str, scores: dict[str, float]) -> float:
        if scores["expected_noise"] >= 1 and scores["error"] == 0:
            return 0.2
        if "80-critical" in text or scores["error"] >= 2:
            return 2.7
        if scores["error"] >= 1 or scores["resource"] >= 1:
            return 2.1
        if scores["operational"] >= 1:
            return 1.1
        return 0.8


class TfidfBackend(Backend):
    """Hashed unigram/bigram cosine vs label text. No extra deps."""

    name = "tfidf"

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        started = time.perf_counter()
        text = _state_text(state)
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        state_vec = self._vec(text)
        for qname, q in questions.items():
            if q["type"] == "choice":
                sims = [self._cos(state_vec, self._vec(f"{k} {v}")) for k, v in q["criteria"].items()]
                probs = _softmax([s * 6 for s in sims])
                dist = dict(zip(q["criteria"], probs, strict=True))
                choice = max(dist, key=dist.get)
                values[qname] = choice
                probabilities[qname] = dist
                confidence[qname] = float(dist[choice])
            elif q["type"] == "noul":
                yes = self._cos(state_vec, self._vec(f"yes {q['instructions']} {text}"))
                no = self._cos(state_vec, self._vec(f"no not {q['instructions']}"))
                # Mix lexical overlap of the question intent with state tokens.
                intent = self._overlap(text, q["instructions"])
                p = float(np.clip(0.5 + 0.35 * (yes - no) + 0.15 * intent, 0.05, 0.95))
                if qname in {"interesting", "investigate", "page", "grounded"}:
                    p = float(np.clip(0.35 + 0.5 * intent, 0.08, 0.92))
                values[qname] = p
                confidence[qname] = abs(p - 0.5) * 2
            else:
                sims = [self._cos(state_vec, self._vec(desc)) for desc in q["criteria"]]
                probs = _softmax([s * 6 for s in sims])
                values[qname] = float(sum(i * p for i, p in enumerate(probs)))
                confidence[qname] = float(max(probs))
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": (time.perf_counter() - started) * 1000,
            "input_tokens": len(text.split()),
            "cost_usd": 0.0,
        }

    @staticmethod
    def _tokens(text: str) -> list[str]:
        raw = "".join(ch.lower() if ch.isalnum() else " " for ch in text).split()
        grams = list(raw)
        grams.extend(f"{a}_{b}" for a, b in zip(raw, raw[1:], strict=False))
        return grams

    def _vec(self, text: str, dim: int = 512) -> np.ndarray:
        vec = np.zeros(dim, dtype=float)
        for tok in self._tokens(text):
            vec[hash(tok) % dim] += 1.0
        norm = np.linalg.norm(vec)
        return vec / norm if norm else vec

    @staticmethod
    def _cos(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b))

    def _overlap(self, text: str, other: str) -> float:
        a, b = set(self._tokens(text)), set(self._tokens(other))
        if not a or not b:
            return 0.0
        return len(a & b) / len(a | b)


class EmbeddingBackend(Backend):
    """MiniLM cosine vs label descriptions — ELSER / embedding alternative."""

    name = "embedding"

    def __init__(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            self.available = False
            self.skip_reason = "sentence-transformers not installed"
            self.model = None
            return
        started = time.perf_counter()
        self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        self.load_ms = (time.perf_counter() - started) * 1000

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        if self.model is None:
            raise RuntimeError(self.skip_reason)
        started = time.perf_counter()
        text = _state_text(state)
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        for qname, q in questions.items():
            if q["type"] == "choice":
                labels = list(q["criteria"])
                docs = [f"{lab}: {q['criteria'][lab]}" for lab in labels]
                embs = self.model.encode([text, *docs], normalize_embeddings=True)
                sims = (embs[0] @ embs[1:].T).tolist()
                probs = _softmax([s * 8 for s in sims])
                dist = dict(zip(labels, probs, strict=True))
                choice = max(dist, key=dist.get)
                values[qname] = choice
                probabilities[qname] = dist
                confidence[qname] = float(dist[choice])
            elif q["type"] == "noul":
                yes = f"Yes. {q['instructions']}"
                no = f"No. {q['instructions']}"
                embs = self.model.encode([text, yes, no], normalize_embeddings=True)
                yes_s = float(embs[0] @ embs[1])
                no_s = float(embs[0] @ embs[2])
                p = float(np.clip((yes_s - no_s + 1) / 2, 0.02, 0.98))
                values[qname] = p
                confidence[qname] = abs(p - 0.5) * 2
            else:
                levels = list(q["criteria"])
                docs = [f"severity {i}: {desc}" for i, desc in enumerate(levels)]
                embs = self.model.encode([text, *docs], normalize_embeddings=True)
                sims = (embs[0] @ embs[1:].T).tolist()
                probs = _softmax([s * 8 for s in sims])
                score = sum(i * p for i, p in enumerate(probs))
                values[qname] = float(score)
                confidence[qname] = float(max(probs))
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": (time.perf_counter() - started) * 1000,
            "input_tokens": len(text.split()),
            "cost_usd": 0.0,
        }


class RerankerBackend(Backend):
    """Cross-encoder listwise scores — Jina-family proxy that fits CPU."""

    name = "reranker"

    def __init__(self) -> None:
        try:
            from sentence_transformers import CrossEncoder
        except ImportError:
            self.available = False
            self.skip_reason = "sentence-transformers not installed"
            self.model = None
            return
        self.model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        if self.model is None:
            raise RuntimeError(self.skip_reason)
        started = time.perf_counter()
        text = _state_text(state, max_chars=2000)
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        for qname, q in questions.items():
            if q["type"] == "choice":
                pairs = [(text, f"{k}: {v}") for k, v in q["criteria"].items()]
                raw = self.model.predict(pairs).tolist()
                probs = _softmax(raw)
                dist = dict(zip(q["criteria"], probs, strict=True))
                choice = max(dist, key=dist.get)
                values[qname] = choice
                probabilities[qname] = dist
                confidence[qname] = float(dist[choice])
            elif q["type"] == "noul":
                yes, no = self.model.predict([(text, f"Yes. {q['instructions']}"), (text, f"No. {q['instructions']}")])
                p = float(1 / (1 + np.exp(-(yes - no))))
                values[qname] = p
                confidence[qname] = abs(p - 0.5) * 2
            else:
                pairs = [(text, f"{i}: {desc}") for i, desc in enumerate(q["criteria"])]
                raw = self.model.predict(pairs).tolist()
                probs = _softmax(raw)
                values[qname] = float(sum(i * p for i, p in enumerate(probs)))
                confidence[qname] = float(max(probs))
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": (time.perf_counter() - started) * 1000,
            "input_tokens": len(text.split()),
            "cost_usd": 0.0,
        }


class JevBackend(Backend):
    name = "jev"

    def __init__(self) -> None:
        self.key = os.environ.get("TYPESAFE_API_KEY", "")
        if not self.key:
            self.available = False
            self.skip_reason = "TYPESAFE_API_KEY not set (Jev is waitlist/API)"

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        payload = json.dumps(
            {
                "model": os.environ.get("JEV_MODEL", "jev-1.13.0"),
                "state": state,
                "questions": questions,
            }
        ).encode()
        req = urllib.request.Request(
            "https://api.typesafe.ai/v1/systemone",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode())
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Jev request failed: {exc}") from exc
        latency = (time.perf_counter() - started) * 1000
        answers = body.get("answers", {})
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        for name, ans in answers.items():
            if ans.get("type") == "choice":
                values[name] = ans.get("choice")
                probabilities[name] = ans.get("probabilities", {})
                confidence[name] = float(ans.get("confidence", 0))
            elif ans.get("type") == "noul":
                values[name] = float(ans.get("noul", 0))
                confidence[name] = abs(float(ans.get("noul", 0)) - 0.5) * 2
            else:
                values[name] = float(ans.get("score", 0))
                confidence[name] = float(ans.get("confidence", 0))
        usage = body.get("usage", {})
        tokens = int(usage.get("input_tokens", 0))
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": latency,
            "input_tokens": tokens,
            "cost_usd": tokens * 0.042 / 1_000_000,
        }


class LayaBackend(Backend):
    name = "laya"

    def __init__(self) -> None:
        try:
            import laya
        except ImportError:
            self.available = False
            self.skip_reason = "laya package not installed"
            self.agent = None
            return
        try:
            self.agent = laya.load("convaiinnovations/laya")
        except Exception as exc:  # noqa: BLE001 — local optional backend
            self.available = False
            self.skip_reason = f"laya load failed: {exc}"
            self.agent = None

    def decide(self, state: dict[str, Any], questions: dict[str, Any]) -> Answer:
        if self.agent is None:
            raise RuntimeError(self.skip_reason)
        started = time.perf_counter()
        result = self.agent.predict(_state_text(state, max_chars=1500), questions)
        latency = (time.perf_counter() - started) * 1000
        answers = result.get("answers", result)
        values: dict[str, Any] = {}
        probabilities: dict[str, dict[str, float]] = {}
        confidence: dict[str, float] = {}
        for name, ans in answers.items():
            if not isinstance(ans, dict):
                continue
            if "choice" in ans:
                values[name] = ans["choice"]
                probabilities[name] = ans.get("probabilities", {})
                confidence[name] = float(ans.get("confidence", 0))
            elif "noul" in ans:
                values[name] = float(ans["noul"])
                confidence[name] = abs(float(ans["noul"]) - 0.5) * 2
            elif "score" in ans:
                values[name] = float(ans["score"])
                confidence[name] = float(ans.get("confidence", 0))
        return {
            "values": values,
            "probabilities": probabilities,
            "confidence": confidence,
            "latency_ms": latency,
            "input_tokens": 0,
            "cost_usd": 0.0,
        }


def build_backends() -> list[Backend]:
    backends: list[Backend] = [
        MajorityBackend(),
        HeuristicBackend(),
        TfidfBackend(),
        JevBackend(),
        LayaBackend(),
    ]
    backends.extend([EmbeddingBackend(), RerankerBackend()])
    from jina_backends import build_jina_backends

    backends.extend(build_jina_backends())
    return backends
