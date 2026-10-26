"""Labeled decision fixtures mined from Significant Events eval gold.

Labels come from `@kbn/evals-suite-significant-events` scenario criteria
(otel-demo, Bank of Anthos, Quarkus Super Heroes), not from an LLM judge.
"""

from __future__ import annotations

from typing import Any

Example = dict[str, Any]


def _ex(
    example_id: str,
    *,
    task: str,
    dataset: str,
    scenario: str,
    state: dict[str, Any],
    gold: dict[str, Any],
    **extra: Any,
) -> Example:
    return {
        "id": example_id,
        "task": task,
        "dataset": dataset,
        "scenario": scenario,
        "state": state,
        "gold": gold,
        **extra,
    }


def pattern_triage_examples() -> list[Example]:
    """A1: is this log pattern worth a KI, and what kind?"""
    rows: list[Example] = []

    interesting_errors = [
        (
            "otel",
            "payment-unreachable",
            "failed to charge card",
            "frontend gRPC Error: 13 INTERNAL: failed to charge card; transport: Error while dialing: dial tcp i/o timeout",
            "error",
            3,
        ),
        (
            "otel",
            "payment-unreachable",
            "dial tcp connection refused",
            "frontend: transport: Error while dialing: dial tcp 10.96.12.8:50051: connect: connection refused",
            "error",
            3,
        ),
        (
            "otel",
            "cart-redis-cutoff",
            "Wasn't able to connect to redis",
            "cartservice.cartstore.ValkeyCartStore: Wasn't able to connect to redis; fail GetCartAsync",
            "error",
            3,
        ),
        (
            "otel",
            "cart-redis-cutoff",
            "failed to get user cart during checkout",
            "frontend gRPC code 13 INTERNAL: failed to get user cart during checkout; ECONNREFUSED 10.105.181.182:7070",
            "error",
            3,
        ),
        (
            "otel",
            "checkout-memory-starvation",
            "Killing pod checkout",
            "kubelet reason=Killing container checkout OOMKilled; ScalingReplicaSet checkout",
            "resource",
            3,
        ),
        (
            "anthos",
            "ledger-db-disconnect",
            "SQLState: 08001",
            "transactionhistory org.postgresql.util.PSQLException: SQLState: 08001 The connection attempt failed",
            "error",
            3,
        ),
        (
            "anthos",
            "ledger-db-disconnect",
            "The connection attempt failed",
            "ledgerwriter JDBC The connection attempt failed; Connection refused ledger-db:5432",
            "error",
            3,
        ),
        (
            "anthos",
            "ledger-db-disconnect",
            "Read timed out",
            "frontend Error getting transaction_list: Read timed out calling ledgerwriter",
            "error",
            3,
        ),
        (
            "anthos",
            "ledger-db-disconnect",
            "Cache error",
            "balancereader Cache error after PostgreSQL lookup failure",
            "error",
            2,
        ),
        (
            "anthos",
            "ledger-db-disconnect",
            "Failed to retrieve account balance",
            "ledgerwriter Failed to retrieve account balance; payment and deposit submissions fail",
            "error",
            3,
        ),
        (
            "quarkus",
            "kafka-disconnect",
            "SRMSG18206 Unable to write to Kafka",
            "rest-fights SRMSG18206 Unable to write to Kafka; SRMSG18212 message nacked; TimeoutException Topic fights not present in metadata",
            "error",
            3,
        ),
        (
            "quarkus",
            "fights-db-disconnect",
            "MongoTimeoutException",
            "rest-fights MongoTimeoutException: Timed out while waiting for a server that matches WritableServerSelector; MongoSocketOpenException",
            "error",
            3,
        ),
        (
            "quarkus",
            "fights-db-disconnect",
            "HTTP Request to /api/fights failed",
            "rest-fights HTTP Request to /api/fights failed after MongoDB timeout",
            "error",
            2,
        ),
        (
            "otel",
            "payment-unreachable",
            "gRPC code 14 UNAVAILABLE",
            "frontend Error: 14 UNAVAILABLE: No connection established to payment",
            "error",
            3,
        ),
        (
            "otel",
            "cart-redis-cutoff",
            "Application is shutting down",
            "cart Application is shutting down after Valkey connect failures",
            "resource",
            2,
        ),
        (
            "anthos",
            "ledger-db-disconnect",
            "HTTPConnectionPool Max retries exceeded",
            "loadgenerator HTTPConnectionPool Max retries exceeded Connection refused userservice",
            "error",
            2,
        ),
        (
            "otel",
            "checkout-memory-starvation",
            "OutOfMemoryError",
            "checkout java.lang.OutOfMemoryError: Java heap space during PlaceOrder",
            "resource",
            3,
        ),
        (
            "otel",
            "healthy-baseline",
            "context deadline exceeded",
            "otel-collector export OTLP context deadline exceeded to backend",
            "error",
            1,
        ),
        (
            "anthos",
            "healthy-baseline",
            "Connection refused",
            "transient Connection refused from loadgenerator to frontend during rollout",
            "error",
            1,
        ),
        (
            "quarkus",
            "kafka-disconnect",
            "TimeoutException Topic fights not present in metadata",
            "event-statistics org.apache.kafka.common.errors.TimeoutException: Topic fights not present in metadata",
            "error",
            2,
        ),
    ]

    noise = [
        (
            "otel",
            "healthy-baseline",
            "GetCartAsync called with userId",
            "cart GetCartAsync called with userId=abc; ValkeyCartStore operation success",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "order confirmation email sent to",
            "checkout order confirmation email sent to user@example.com",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "Charge request received",
            "payment Charge request received; Transaction complete",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "Sending Quote",
            "shipping Sending Quote; Received quote; Tracking ID Created",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "Receive ListRecommendations for product ids",
            "recommendation_server.py Receive ListRecommendations for product ids",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "Targeted ad request received",
            "oteldemo.AdService - Targeted ad request received",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "POST /getquote HTTP/1.1 200",
            "quote POST /getquote HTTP/1.1 200",
            "expected_noise",
            0,
        ),
        (
            "anthos",
            "healthy-baseline",
            "Login Successful.",
            "userservice Login Successful. 385 docs in healthy snapshot",
            "expected_noise",
            0,
        ),
        (
            "anthos",
            "healthy-baseline",
            "Deposit submitted successfully.",
            "ledgerwriter Deposit submitted successfully. 362 docs",
            "expected_noise",
            0,
        ),
        (
            "anthos",
            "healthy-baseline",
            "Payment initiated successfully.",
            "frontend Payment initiated successfully. 291 docs",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "POST /send_order_confirmation HTTP/1.1 200",
            "email POST /send_order_confirmation HTTP/1.1 200",
            "expected_noise",
            0,
        ),
        (
            "quarkus",
            "healthy-baseline",
            "fight simulation completed",
            "rest-fights fight simulation completed hero vs villain ~12 fights/min",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "kube-probe GET /health",
            "frontend kube-probe GET /health 200 OK",
            "expected_noise",
            0,
        ),
        (
            "anthos",
            "healthy-baseline",
            "Started Application",
            "userservice Started Application in 2.1 seconds (JVM running)",
            "expected_noise",
            0,
        ),
        (
            "otel",
            "healthy-baseline",
            "valkey background saving started",
            "valkey Background saving started; RDB write successful",
            "expected_noise",
            0,
        ),
        (
            "quarkus",
            "healthy-baseline",
            "Received first command on ingress connection",
            "fights-db Received first command on ingress connection since session start or auth handshake elapsedMillis=12",
            "operational",
            1,
        ),
        (
            "otel",
            "healthy-baseline",
            "PlaceOrder user_id",
            "checkout [PlaceOrder] user_id=... payment went through (transaction_id: ...)",
            "operational",
            1,
        ),
        (
            "anthos",
            "healthy-baseline",
            "request volume ledgerwriter",
            "ledgerwriter handled POST /deposits 200 in 18ms",
            "operational",
            1,
        ),
        (
            "otel",
            "checkout-memory-starvation",
            "ScalingReplicaSet checkout",
            "deployment-controller ScalingReplicaSet checkout from 2 to 2 after rolling update",
            "config",
            1,
        ),
        (
            "anthos",
            "healthy-baseline",
            "JWT token issued",
            "userservice JWT token issued for user after Login Successful.",
            "security",
            1,
        ),
    ]

    for i, (dataset, scenario, pattern, sample, category, severity) in enumerate(interesting_errors):
        rows.append(
            _ex(
                f"a1-err-{i:03d}",
                task="pattern_triage",
                dataset=dataset,
                scenario=scenario,
                state={
                    "pattern": pattern,
                    "samples": [sample],
                    "hint": "failure scenario log pattern from Significant Events eval gold",
                },
                gold={"interesting": 1, "category": category, "severity": severity},
            )
        )

    for i, (dataset, scenario, pattern, sample, category, severity) in enumerate(noise):
        interesting = 0 if category == "expected_noise" else 1
        rows.append(
            _ex(
                f"a1-noise-{i:03d}",
                task="pattern_triage",
                dataset=dataset,
                scenario=scenario,
                state={
                    "pattern": pattern,
                    "samples": [sample],
                    "hint": "healthy-baseline or routine operational pattern from eval gold",
                },
                gold={"interesting": interesting, "category": category, "severity": severity},
            )
        )

    # Near-duplicates with wording changes so lexical and semantic backends can diverge.
    paraphrases = [
        (
            "a1-para-000",
            "otel",
            "payment-unreachable",
            "card charge failed",
            "checkout could not charge the customer card because payment did not respond",
            1,
            "error",
            3,
        ),
        (
            "a1-para-001",
            "otel",
            "healthy-baseline",
            "cart fetched for user",
            "GetCartAsync completed successfully for userId xyz",
            0,
            "expected_noise",
            0,
        ),
        (
            "a1-para-002",
            "anthos",
            "ledger-db-disconnect",
            "postgres connection refused",
            "PSQLException connection refused host=ledger-db port=5432",
            1,
            "error",
            3,
        ),
        (
            "a1-para-003",
            "anthos",
            "healthy-baseline",
            "user signed in",
            "Login Successful. session created",
            0,
            "expected_noise",
            0,
        ),
        (
            "a1-para-004",
            "quarkus",
            "kafka-disconnect",
            "cannot publish fight event",
            "SmallRye nacked fight event because Kafka write timed out",
            1,
            "error",
            3,
        ),
        (
            "a1-para-005",
            "otel",
            "cart-redis-cutoff",
            "valkey unreachable from cart",
            "cart store failed: redis connection error to valkey:6379",
            1,
            "error",
            3,
        ),
    ]
    for example_id, dataset, scenario, pattern, sample, interesting, category, severity in paraphrases:
        rows.append(
            _ex(
                example_id,
                task="pattern_triage",
                dataset=dataset,
                scenario=scenario,
                state={"pattern": pattern, "samples": [sample], "hint": "paraphrase of eval gold"},
                gold={"interesting": interesting, "category": category, "severity": severity},
            )
        )
    return rows


def ki_judge_examples() -> list[Example]:
    """A2: classify / score / ground / dedup a candidate KI query."""
    rows: list[Example] = []

    good = [
        (
            "a2-good-000",
            "otel",
            "payment-unreachable",
            {
                "title": "Payment charge failures",
                "description": "Detects frontend failed to charge card and gRPC dial timeouts to payment.",
                "esql": 'FROM logs | WHERE body.text LIKE "*failed to charge card*" OR body.text LIKE "*dial tcp*"',
                "category": "error",
                "severity_score": 85,
            },
            ["frontend entity", "checkout→payment dependency", "error_logs: failed to charge card"],
            [],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-good-001",
            "otel",
            "cart-redis-cutoff",
            {
                "title": "Valkey connection failures in cart",
                "description": "Catches cart losing connectivity to its Valkey backing store.",
                "esql": 'FROM logs | WHERE body.text LIKE "*connect to redis*" AND resource.attributes.app == "cart"',
                "category": "error",
                "severity_score": 80,
            },
            ["cart entity", "cart→valkey dependency", "error_logs: Wasn't able to connect to redis"],
            [],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-good-002",
            "anthos",
            "ledger-db-disconnect",
            {
                "title": "JDBC SQLState 08001",
                "description": "PostgreSQL connection refused across ledger services.",
                "esql": 'FROM logs | WHERE body.text LIKE "*SQLState: 08001*"',
                "category": "error",
                "severity_score": 80,
            },
            ["transactionhistory entity", "ledgerwriter→ledger-db dependency"],
            [],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-good-003",
            "anthos",
            "ledger-db-disconnect",
            {
                "title": "Frontend ledger read timeouts",
                "description": "User-facing Read timed out when frontend calls ledgerwriter.",
                "esql": 'FROM logs | WHERE resource.attributes.app == "frontend" AND body.text LIKE "*Read timed out*"',
                "category": "error",
                "severity_score": 75,
            },
            ["frontend entity", "error_logs: Read timed out 988 docs"],
            [
                {
                    "id": "seed-jdbc-sqlstate",
                    "title": "JDBC connection failure",
                    "esql": 'FROM logs | WHERE body.text LIKE "*SQLState: 08001*"',
                    "description": "PostgreSQL connection refused",
                }
            ],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-good-004",
            "quarkus",
            "kafka-disconnect",
            {
                "title": "Kafka write nacks in rest-fights",
                "description": "SmallRye SRMSG18206/18212 unable to write fight events.",
                "esql": 'FROM logs | WHERE resource.attributes.app == "rest-fights" AND (body.text LIKE "*SRMSG18206*" OR body.text LIKE "*SRMSG18212*")',
                "category": "error",
                "severity_score": 80,
            },
            ["rest-fights entity", "rest-fights→kafka dependency"],
            [],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-good-005",
            "quarkus",
            "fights-db-disconnect",
            {
                "title": "MongoDB timeouts in rest-fights",
                "description": "MongoTimeoutException and socket open failures persisting fights.",
                "esql": 'FROM logs | WHERE body.text LIKE "*MongoTimeoutException*" OR body.text LIKE "*MongoSocketOpenException*"',
                "category": "error",
                "severity_score": 80,
            },
            ["rest-fights entity", "rest-fights→fights-db dependency"],
            [],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-good-006",
            "otel",
            "healthy-baseline",
            {
                "title": "Per-service request volume",
                "description": "STATS series of request counts by service for change-point detection.",
                "esql": "FROM logs | STATS metric_value = COUNT(*) BY bucket = BUCKET(@timestamp, 1 minute), resource.attributes.app",
                "category": "operational",
                "severity_score": 40,
            },
            ["dataset_analysis: resource.attributes.app present", "entity: cart, checkout, payment"],
            [],
            {"category": "operational", "severity": 1, "grounded": 1, "duplicate": 0},
            False,
        ),
        (
            "a2-good-007",
            "quarkus",
            "healthy-baseline",
            {
                "title": "Mongo ingress latency",
                "description": "Average elapsedMillis on fights-db ingress connections.",
                "esql": 'FROM logs | WHERE body.text LIKE "*Received first command on ingress connection*" | STATS metric_value = AVG(attributes.attr.elapsedMillis) BY bucket = BUCKET(@timestamp, 1 minute)',
                "category": "operational",
                "severity_score": 35,
            },
            ["dataset_analysis: attributes.attr.elapsedMillis dense in ingress pattern"],
            [],
            {"category": "operational", "severity": 1, "grounded": 1, "duplicate": 0},
            False,
        ),
        (
            "a2-good-008",
            "otel",
            "payment-unreachable",
            {
                "title": "Payment error rate STATS",
                "description": "Per-minute rate of payment/gRPC errors during disruption.",
                "esql": 'FROM logs | EVAL is_err = body.text LIKE "*failed to charge card*" | STATS metric_value = SUM(is_err) BY bucket = BUCKET(@timestamp, 1 minute)',
                "category": "error",
                "severity_score": 70,
            },
            ["error_logs: failed to charge card", "dataset_analysis"],
            [],
            {"category": "error", "severity": 2, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-good-009",
            "anthos",
            "healthy-baseline",
            {
                "title": "Transaction throughput",
                "description": "Aggregate deposit/payment request volume across ledgerwriter.",
                "esql": 'FROM logs | WHERE resource.attributes.app == "ledgerwriter" | STATS metric_value = COUNT(*) BY bucket = BUCKET(@timestamp, 1 minute)',
                "category": "operational",
                "severity_score": 30,
            },
            ["entity: ledgerwriter", "dataset_analysis baselines"],
            [],
            {"category": "operational", "severity": 1, "grounded": 1, "duplicate": 0},
            False,
        ),
    ]

    bad_noise = [
        (
            "a2-noise-000",
            "otel",
            "healthy-baseline",
            {
                "title": "Cart fetched",
                "description": "Alert whenever GetCartAsync is called.",
                "esql": 'FROM logs | WHERE body.text LIKE "*GetCartAsync called*"',
                "category": "error",
                "severity_score": 70,
            },
            ["computed log_patterns: GetCartAsync called 404 docs — success path"],
            [],
            {"category": "operational", "severity": 0, "grounded": 0, "duplicate": 0},
            False,
        ),
        (
            "a2-noise-001",
            "otel",
            "healthy-baseline",
            {
                "title": "Order email sent",
                "description": "Match successful order confirmation emails.",
                "esql": 'FROM logs | WHERE body.text LIKE "*order confirmation email sent to*"',
                "category": "error",
                "severity_score": 60,
            },
            ["checkout success pattern 73 docs"],
            [],
            {"category": "operational", "severity": 0, "grounded": 0, "duplicate": 0},
            False,
        ),
        (
            "a2-noise-002",
            "anthos",
            "healthy-baseline",
            {
                "title": "Successful logins",
                "description": "Alert on Login Successful.",
                "esql": 'FROM logs | WHERE body.text LIKE "*Login Successful.*"',
                "category": "security",
                "severity_score": 55,
            },
            ["userservice Login Successful. 385 docs healthy"],
            [],
            {"category": "operational", "severity": 0, "grounded": 0, "duplicate": 0},
            False,
        ),
        (
            "a2-noise-003",
            "anthos",
            "healthy-baseline",
            {
                "title": "Deposits succeeded",
                "description": "Match Deposit submitted successfully.",
                "esql": 'FROM logs | WHERE body.text LIKE "*Deposit submitted successfully.*"',
                "category": "error",
                "severity_score": 50,
            },
            ["healthy snapshot success event"],
            [],
            {"category": "operational", "severity": 0, "grounded": 0, "duplicate": 0},
            False,
        ),
        (
            "a2-noise-004",
            "anthos",
            "healthy-baseline",
            {
                "title": "Payments initiated",
                "description": "Match Payment initiated successfully.",
                "esql": 'FROM logs | WHERE body.text LIKE "*Payment initiated successfully.*"',
                "category": "error",
                "severity_score": 50,
            },
            ["healthy snapshot success event"],
            [],
            {"category": "operational", "severity": 0, "grounded": 0, "duplicate": 0},
            False,
        ),
    ]

    speculative = [
        (
            "a2-spec-000",
            "otel",
            "healthy-baseline",
            {
                "title": "CVE Log4j JNDI",
                "description": "Speculative Log4j exploit watch from stream name only.",
                "esql": 'FROM logs | WHERE body.text LIKE "*jndi*" AND body.text LIKE "*ldap*"',
                "category": "security",
                "severity_score": 90,
            },
            ["stream name: logs", "no log4j feature in sample"],
            [],
            {"category": "security", "severity": 2, "grounded": 0, "duplicate": 0},
            False,
        ),
        (
            "a2-spec-001",
            "otel",
            "healthy-baseline",
            {
                "title": "Disk full on /var",
                "description": "Watch for ENOSPC even though no disk features were extracted.",
                "esql": 'FROM logs | WHERE body.text LIKE "*No space left on device*"',
                "category": "resource_health",
                "severity_score": 70,
            },
            ["stream description only"],
            [],
            {"category": "resource_health", "severity": 2, "grounded": 0, "duplicate": 0},
            False,
        ),
        (
            "a2-spec-002",
            "quarkus",
            "healthy-baseline",
            {
                "title": "TLS handshake failures",
                "description": "Generic TLS watch not present in fight logs.",
                "esql": 'FROM logs | WHERE body.text LIKE "*handshake_failure*"',
                "category": "security",
                "severity_score": 65,
            },
            ["no TLS feature"],
            [],
            {"category": "security", "severity": 1, "grounded": 0, "duplicate": 0},
            False,
        ),
    ]

    duplicates = [
        (
            "a2-dup-000",
            "anthos",
            "ledger-db-disconnect",
            {
                "title": "Postgres connect fail",
                "description": "Same JDBC 08001 signal under different wording.",
                "esql": 'FROM logs | WHERE MATCH(body.text, "SQLState 08001") OR body.text LIKE "*connection attempt failed*"',
                "category": "error",
                "severity_score": 78,
            },
            ["ledger-db JDBC"],
            [
                {
                    "id": "seed-jdbc-sqlstate",
                    "title": "JDBC connection failure",
                    "esql": 'FROM logs | WHERE body.text LIKE "*SQLState: 08001*"',
                    "description": "PostgreSQL connection refused (SQLState: 08001)",
                },
                {
                    "id": "seed-jdbc-connect-attempt",
                    "title": "JDBC connection attempt failure",
                    "esql": 'FROM logs | WHERE body.text LIKE "*The connection attempt failed*"',
                    "description": "JDBC connection attempt failed",
                },
            ],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 1},
            False,
        ),
        (
            "a2-dup-001",
            "otel",
            "payment-unreachable",
            {
                "title": "Charge card errors again",
                "description": "Retread of failed to charge card detection.",
                "esql": 'FROM logs | WHERE MATCH_PHRASE(body.text, "failed to charge card")',
                "category": "error",
                "severity_score": 82,
            },
            ["frontend payment errors"],
            [
                {
                    "id": "existing-charge",
                    "title": "Payment charge failures",
                    "esql": 'FROM logs | WHERE body.text LIKE "*failed to charge card*"',
                    "description": "Detects frontend failed to charge card",
                }
            ],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 1},
            False,
        ),
        (
            "a2-dup-002",
            "quarkus",
            "kafka-disconnect",
            {
                "title": "SmallRye Kafka write errors",
                "description": "Equivalent SRMSG18206 detector.",
                "esql": 'FROM logs | WHERE body.text LIKE "*Unable to write to Kafka*"',
                "category": "error",
                "severity_score": 80,
            },
            ["rest-fights kafka"],
            [
                {
                    "id": "existing-srmsg",
                    "title": "Kafka write nacks in rest-fights",
                    "esql": 'FROM logs | WHERE body.text LIKE "*SRMSG18206*"',
                    "description": "SmallRye unable to write fight events",
                }
            ],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 1},
            False,
        ),
    ]

    more_ops = [
        (
            "a2-ops-000",
            "otel",
            "healthy-baseline",
            {
                "title": "Checkout PlaceOrder throughput",
                "description": "Count PlaceOrder completions per minute.",
                "esql": 'FROM logs | WHERE body.text LIKE "*PlaceOrder*" | STATS metric_value = COUNT(*) BY bucket = BUCKET(@timestamp, 1 minute)',
                "category": "operational",
                "severity_score": 35,
            },
            ["entity: checkout", "log_patterns: PlaceOrder"],
            [],
            {"category": "operational", "severity": 1, "grounded": 1, "duplicate": 0},
            False,
        ),
        (
            "a2-ops-001",
            "otel",
            "cart-redis-cutoff",
            {
                "title": "Frontend cart unavailable impact",
                "description": "gRPC UNAVAILABLE ECONNREFUSED when cart is down.",
                "esql": 'FROM logs | WHERE resource.attributes.app == "frontend" AND body.text LIKE "*ECONNREFUSED*"',
                "category": "error",
                "severity_score": 75,
            },
            ["frontend entity", "cart crash causes ECONNREFUSED"],
            [],
            {"category": "error", "severity": 3, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-ops-002",
            "otel",
            "checkout-memory-starvation",
            {
                "title": "Checkout OOM / pod kills",
                "description": "Kubernetes Killing/OOMKilled on checkout.",
                "esql": 'FROM logs | WHERE body.structured.object.reason == "Killing" OR body.text LIKE "*OOMKilled*"',
                "category": "resource_health",
                "severity_score": 80,
            },
            ["infra kubernetes", "checkout memory starvation scenario"],
            [],
            {"category": "resource_health", "severity": 3, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-ops-003",
            "anthos",
            "ledger-db-disconnect",
            {
                "title": "Ledger JDBC error rate",
                "description": "STATS of SQLState/connection failures per minute.",
                "esql": 'FROM logs | EVAL is_jdbc = body.text LIKE "*SQLState: 08001*" | STATS metric_value = SUM(is_jdbc) BY bucket = BUCKET(@timestamp, 1 minute)',
                "category": "error",
                "severity_score": 70,
            },
            ["dataset_analysis", "JDBC errors"],
            [],
            {"category": "error", "severity": 2, "grounded": 1, "duplicate": 0},
            True,
        ),
        (
            "a2-miscat-000",
            "anthos",
            "healthy-baseline",
            {
                "title": "Auth login volume",
                "description": "STATS of login events for operational monitoring, not a security incident.",
                "esql": 'FROM logs | WHERE body.text LIKE "*Login Successful*" | STATS metric_value = COUNT(*) BY bucket = BUCKET(@timestamp, 1 minute)',
                "category": "security",
                "severity_score": 20,
            },
            ["userservice logins are routine success"],
            [],
            {"category": "operational", "severity": 1, "grounded": 1, "duplicate": 0},
            False,
        ),
    ]

    for pack in (good, bad_noise, speculative, duplicates, more_ops):
        for example_id, dataset, scenario, query, features, existing, gold, must_detect in pack:
            rows.append(
                _ex(
                    example_id,
                    task="ki_judge",
                    dataset=dataset,
                    scenario=scenario,
                    state={"query": query, "features": features, "existing_queries": existing},
                    gold=gold,
                    must_detect=must_detect,
                )
            )
    return rows


def admission_examples() -> list[Example]:
    """A3: should Nightshift investigate / page this detection or event?"""
    rows: list[Example] = []

    investigate_page = [
        (
            "a3-crit-000",
            "anthos",
            "ledger-db-disconnect",
            {
                "title": "Ledger services — connection refused across balance, history, and payment paths",
                "severity": "80-critical",
                "signals": [
                    "SQLState 08001 connection refused from transactionhistory",
                    "Frontend → Transaction History Connection Failures",
                    "Frontend → Balance Reader Connection Failures",
                    "Cache Errors in Balance Reader or Transaction History",
                    "Ledger Writer Failed to retrieve account balance",
                ],
                "summary": "Users cannot view balances or history and cannot submit payments.",
            },
            {"investigate": 1, "page": 1, "action": "page"},
        ),
        (
            "a3-crit-001",
            "otel",
            "payment-unreachable",
            {
                "title": "Checkout cannot charge cards",
                "severity": "80-critical",
                "signals": ["failed to charge card spike", "gRPC 14 UNAVAILABLE to payment"],
                "summary": "Payment service unreachable; checkout fails for all users.",
            },
            {"investigate": 1, "page": 1, "action": "page"},
        ),
        (
            "a3-crit-002",
            "otel",
            "cart-redis-cutoff",
            {
                "title": "Cart store down — checkout cannot load carts",
                "severity": "80-critical",
                "signals": ["Wasn't able to connect to redis", "ECONNREFUSED cart:7070"],
                "summary": "Valkey cutoff crashes cart; checkout blocked.",
            },
            {"investigate": 1, "page": 1, "action": "page"},
        ),
        (
            "a3-crit-003",
            "otel",
            "checkout-memory-starvation",
            {
                "title": "Checkout OOMKilled rolling update",
                "severity": "60-high",
                "signals": ["Killing checkout OOMKilled", "PlaceOrder errors"],
                "summary": "Checkout pods cycling; orders intermittently fail.",
            },
            {"investigate": 1, "page": 0, "action": "investigate"},
        ),
        (
            "a3-crit-004",
            "quarkus",
            "kafka-disconnect",
            {
                "title": "Fight events not publishing to Kafka",
                "severity": "60-high",
                "signals": ["SRMSG18206", "Topic fights not present in metadata"],
                "summary": "rest-fights cannot write; statistics stall.",
            },
            {"investigate": 1, "page": 0, "action": "investigate"},
        ),
        (
            "a3-crit-005",
            "quarkus",
            "fights-db-disconnect",
            {
                "title": "MongoDB unreachable from rest-fights",
                "severity": "80-critical",
                "signals": ["MongoTimeoutException", "/api/fights failed"],
                "summary": "Fight persistence down.",
            },
            {"investigate": 1, "page": 1, "action": "page"},
        ),
        (
            "a3-crit-006",
            "anthos",
            "ledger-db-disconnect",
            {
                "title": "Frontend Read timed out to ledgerwriter",
                "severity": "60-high",
                "signals": ["Read timed out 988 docs"],
                "summary": "User-facing timeouts after DB disconnect.",
            },
            {"investigate": 1, "page": 0, "action": "investigate"},
        ),
        (
            "a3-crit-007",
            "otel",
            "payment-unreachable",
            {
                "title": "gRPC transport dialing errors",
                "severity": "60-high",
                "signals": ["dial tcp i/o timeout", "connection refused"],
                "summary": "Frontend cannot establish payment channel.",
            },
            {"investigate": 1, "page": 0, "action": "investigate"},
        ),
    ]

    watch_or_suppress = [
        (
            "a3-quiet-000",
            "otel",
            "healthy-baseline",
            {
                "title": "GetCartAsync volume change-point",
                "severity": "20-low",
                "signals": ["GetCartAsync called count +12%"],
                "summary": "Healthy cart reads; volume wiggle only.",
            },
            {"investigate": 0, "page": 0, "action": "suppress"},
        ),
        (
            "a3-quiet-001",
            "otel",
            "healthy-baseline",
            {
                "title": "Order confirmation emails",
                "severity": "20-low",
                "signals": ["order confirmation email sent to spike"],
                "summary": "Successful checkout emails in baseline traffic.",
            },
            {"investigate": 0, "page": 0, "action": "suppress"},
        ),
        (
            "a3-quiet-002",
            "anthos",
            "healthy-baseline",
            {
                "title": "Login Successful rate up",
                "severity": "20-low",
                "signals": ["Login Successful. 385 docs"],
                "summary": "Routine auth success, not an incident.",
            },
            {"investigate": 0, "page": 0, "action": "suppress"},
        ),
        (
            "a3-quiet-003",
            "anthos",
            "healthy-baseline",
            {
                "title": "Deposits submitted successfully",
                "severity": "20-low",
                "signals": ["Deposit submitted successfully. 362 docs"],
                "summary": "Healthy banking traffic.",
            },
            {"investigate": 0, "page": 0, "action": "suppress"},
        ),
        (
            "a3-quiet-004",
            "otel",
            "healthy-baseline",
            {
                "title": "OTLP export deadline exceeded",
                "severity": "40-medium",
                "signals": ["context deadline exceeded on collector"],
                "summary": "Telemetry export blip; user traffic healthy.",
            },
            {"investigate": 0, "page": 0, "action": "watch"},
        ),
        (
            "a3-quiet-005",
            "otel",
            "healthy-baseline",
            {
                "title": "kube-probe /health 200",
                "severity": "20-low",
                "signals": ["health check count change-point"],
                "summary": "Probe chatter.",
            },
            {"investigate": 0, "page": 0, "action": "suppress"},
        ),
        (
            "a3-quiet-006",
            "quarkus",
            "healthy-baseline",
            {
                "title": "Fight throughput ~12/min",
                "severity": "20-low",
                "signals": ["fight simulation completed rate stable"],
                "summary": "Documented healthy baseline.",
            },
            {"investigate": 0, "page": 0, "action": "suppress"},
        ),
        (
            "a3-quiet-007",
            "otel",
            "healthy-baseline",
            {
                "title": "Valkey RDB background save",
                "severity": "20-low",
                "signals": ["background saving started"],
                "summary": "Routine cache persistence.",
            },
            {"investigate": 0, "page": 0, "action": "suppress"},
        ),
        (
            "a3-quiet-008",
            "anthos",
            "healthy-baseline",
            {
                "title": "Loadgenerator connection refused during rollout",
                "severity": "40-medium",
                "signals": ["Connection refused a few times at deploy"],
                "summary": "Transient client errors, recovered.",
            },
            {"investigate": 0, "page": 0, "action": "watch"},
        ),
        (
            "a3-quiet-009",
            "otel",
            "healthy-baseline",
            {
                "title": "Shipping quote volume",
                "severity": "20-low",
                "signals": ["Sending Quote count +8%"],
                "summary": "Healthy shipping traffic.",
            },
            {"investigate": 0, "page": 0, "action": "suppress"},
        ),
        (
            "a3-notify-000",
            "otel",
            "checkout-memory-starvation",
            {
                "title": "ReplicaSet scaled during checkout disruption",
                "severity": "40-medium",
                "signals": ["ScalingReplicaSet checkout"],
                "summary": "Related to OOM but not itself user-impacting.",
            },
            {"investigate": 0, "page": 0, "action": "notify"},
        ),
        (
            "a3-notify-001",
            "anthos",
            "ledger-db-disconnect",
            {
                "title": "Cache error without SQLState (already investigating JDBC)",
                "severity": "40-medium",
                "signals": ["Cache error"],
                "summary": "Symptom of known DB outage; notify the open incident.",
            },
            {"investigate": 0, "page": 0, "action": "notify"},
        ),
    ]

    for pack in (investigate_page, watch_or_suppress):
        for example_id, dataset, scenario, state, gold in pack:
            rows.append(
                _ex(
                    example_id,
                    task="admission",
                    dataset=dataset,
                    scenario=scenario,
                    state=state,
                    gold=gold,
                )
            )
    return rows


def all_examples() -> dict[str, list[Example]]:
    return {
        "pattern_triage": pattern_triage_examples(),
        "ki_judge": ki_judge_examples(),
        "admission": admission_examples(),
    }


QUESTIONS = {
    "pattern_triage": {
        "interesting": {
            "type": "noul",
            "instructions": "Would an on-call engineer want a Knowledge Indicator for this log pattern?",
        },
        "category": {
            "type": "choice",
            "instructions": "What is the primary class of this pattern?",
            "criteria": {
                "error": "application or dependency failure: exceptions, connection refused, gRPC errors, timeouts",
                "resource": "CPU, memory, disk, pod OOM, cache capacity",
                "config": "deploy, rollout, replica scaling, feature flags",
                "security": "authz/authn abuse, tokens, CVE, TLS attacks",
                "operational": "useful health/throughput/latency monitoring that is not a failure",
                "expected_noise": "routine success, health checks, informational chatter that should not become an alert",
            },
        },
        "severity": {
            "type": "score",
            "instructions": "How urgent is this pattern if it starts firing?",
            "criteria": ["routine / ignore", "watch later", "investigate soon", "page-worthy user impact"],
        },
    },
    "ki_judge": {
        "category": {
            "type": "choice",
            "instructions": "Correct Nightshift query category.",
            "criteria": {
                "operational": "health, throughput, latency, volume monitoring",
                "configuration": "deploys, flags, scaling config",
                "error": "failures, exceptions, refused connections",
                "resource_health": "saturation, OOM, disk, cache capacity",
                "security": "auth attacks, secrets, exploit attempts",
            },
        },
        "severity": {
            "type": "score",
            "instructions": "How severe is this query as a detection?",
            "criteria": ["routine success / do not alert", "low operational", "medium", "critical user impact"],
        },
        "grounded": {
            "type": "noul",
            "instructions": "Is this query grounded in the attached features/evidence rather than stream-name speculation?",
        },
        "duplicate": {
            "type": "noul",
            "instructions": "Does this query detect the same signal as one of existing_queries?",
        },
    },
    "admission": {
        "investigate": {
            "type": "noul",
            "instructions": "Should Nightshift start an investigation agent on this event?",
        },
        "page": {
            "type": "noul",
            "instructions": "Should a human be paged right now?",
        },
        "action": {
            "type": "choice",
            "instructions": "Single next action.",
            "criteria": {
                "suppress": "routine noise or success, do not show on homepage",
                "watch": "worth tracking, no agent yet",
                "notify": "tell an existing incident channel, do not start a new investigation",
                "investigate": "start an investigation, do not page",
                "page": "start investigation and page on-call",
            },
        },
    },
}


SHORT_CRITERIA = {
    "error": "errors",
    "resource": "resources",
    "config": "config",
    "security": "security",
    "operational": "ops",
    "expected_noise": "noise",
}
