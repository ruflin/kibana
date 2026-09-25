#!/usr/bin/env python3
# Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
# or more contributor license agreements. Licensed under the Elastic License
# 2.0; you may not use this file except in compliance with the Elastic License
# 2.0.
"""Create the obs-services AI index and load the service.name entity-KI workflow.

Talks to a running local Kibana + Elasticsearch. Stdlib only.

Example::

  python3 x-pack/platform/plugins/shared/context_engine/scripts/setup_obs_services_ai_index.py
  python3 .../setup_obs_services_ai_index.py --source 'traces-apm*' --limit 20 --run

Env overrides: ``KIBANA_URL``, ``KIBANA_AUTH`` (user:pass), ``ES_URL``.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from email.message import Message

API_VERSION = "2023-10-31"
CONTEXT_ENGINE_SETTING = "contextEngine:enabled"
DEFAULT_AI_INDEX_ID = "obs-services"
DEFAULT_WORKFLOW_ID = "obs-services-entity-kis"
DEFAULT_SOURCE = "traces-apm*"
DEFAULT_LOOKBACK = "7 days"
DEFAULT_LIMIT = 20

# Quadrupled braces are not needed: this is not an f-string. Single {{ }} is Liquid.
WORKFLOW_YAML_TEMPLATE = """\
name: obs-services entity KIs
enabled: true
description: One entity KI per observed service.name, written into the obs-services AI index.
tags:
  - knowledge-indicators
  - observability
consts:
  target_index: __DEST__
triggers:
  - type: manual
    inputs:
      - name: source
        type: string
        default: __SOURCE__
      - name: lookback
        type: string
        default: __LOOKBACK__
      - name: limit
        type: number
        default: __LIMIT__
steps:
  - name: ensure_dest
    type: elasticsearch.indices.create
    with:
      index: "{{ consts.target_index }}"
    on-failure:
      continue: true

  - name: list_services
    type: elasticsearch.esql.query
    with:
      query: |
        FROM {{ inputs.source }}
        | WHERE @timestamp >= NOW() - {{ inputs.lookback }} AND service.name IS NOT NULL
        | STATS doc_count = COUNT(*) BY service.name
        | SORT doc_count DESC
        | LIMIT {{ inputs.limit }}
        | RENAME `service.name` AS service_name
        | KEEP service_name, doc_count

  - name: sink_each_service
    type: foreach
    foreach: "{{ steps.list_services.output.values | default: [] }}"
    iteration-on-failure:
      continue: true
    steps:
      - name: sink_entity_ki
        type: elasticsearch.index
        with:
          index: "{{ consts.target_index }}"
          id: "service:{{ foreach.item[0] }}"
          refresh: wait_for
          document:
            type: entity
            title: "{{ foreach.item[0] }}"
            tags:
              - observability
              - service
            "@timestamp": '{{ "now" | date: "%Y-%m-%dT%H:%M:%S%:z" }}'
            attributes:
              entity_type: service
              service_name: "{{ foreach.item[0] }}"
              doc_count: '{{ foreach.item[1] }}'
            description: |
              Entity profile for service {{ foreach.item[0] }}.
              Observed {{ foreach.item[1] }} docs in the last {{ inputs.lookback }}
              on {{ inputs.source }}.
            content: |
              Service: {{ foreach.item[0] }}
              Questions answered: what is this service, recent errors, latency,
              related traces.
              When to use: user asks about {{ foreach.item[0] }} or its dependencies.

              Access patterns:
                Q: Recent traces for this service
                ESQL: FROM {{ inputs.source }} | WHERE service.name == "{{ foreach.item[0] }}" AND @timestamp >= NOW() - 1 hour | LIMIT 50
                Q: Error rate
                ESQL: FROM {{ inputs.source }} | WHERE service.name == "{{ foreach.item[0] }}" AND @timestamp >= NOW() - 1 hour | STATS errors = COUNT(*) WHERE event.outcome == "failure", total = COUNT(*)
"""


class ApiError(RuntimeError):
    """HTTP call failed with a non-success status."""

    def __init__(self, method: str, url: str, status: int, body: object) -> None:
        self.method = method
        self.url = url
        self.status = status
        self.body = body
        super().__init__(f"{method} {url} -> {status}: {body}")


@dataclass(frozen=True)
class Settings:
    kibana_url: str
    es_url: str
    username: str
    password: str
    space: str
    insecure: bool
    ai_index_id: str
    workflow_id: str
    dest: str
    source: str
    lookback: str
    limit: int
    skip_enable: bool
    skip_dest: bool
    print_yaml: bool
    run: bool


def _basic_auth(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {token}"


def _ssl_context(insecure: bool) -> ssl.SSLContext:
    context = ssl.create_default_context()
    if insecure:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    return context


def _decode_body(raw: bytes, headers: Message | None) -> object:
    if not raw:
        return None
    content_type = headers.get("content-type", "") if headers is not None else ""
    text = raw.decode("utf-8", errors="replace")
    if "application/json" in content_type:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text
    return text


class HttpClient:
    def __init__(self, base_url: str, username: str, password: str, insecure: bool) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth = _basic_auth(username, password)
        self.context = _ssl_context(insecure)

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, object] | None = None,
        extra: dict[str, str] | None = None,
    ) -> tuple[int, object]:
        url = f"{self.base_url}{path}"
        payload = json.dumps(body).encode() if body is not None else None
        headers = {
            "Authorization": self.auth,
            "Content-Type": "application/json",
            **(extra or {}),
        }
        request = urllib.request.Request(url, data=payload, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, context=self.context) as response:
                return response.status, _decode_body(response.read(), response.headers)
        except urllib.error.HTTPError as err:
            return err.code, _decode_body(err.read(), err.headers)
        except urllib.error.URLError as err:
            raise SystemExit(f"Could not reach {url}: {err.reason}") from err


def _space_prefix(space: str) -> str:
    if space == "default":
        return ""
    return f"/s/{space}"


def kibana_headers() -> dict[str, str]:
    return {
        "kbn-xsrf": "true",
        "x-elastic-internal-origin": "Kibana",
        "elastic-api-version": API_VERSION,
    }


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def resolve_kibana_base_path(client: HttpClient) -> str:
    """Follow the 3-letter dev-mode base path Kibana uses locally."""
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=client.context),
        urllib.request.HTTPHandler(),
        _NoRedirect(),
    )
    request = urllib.request.Request(
        client.base_url, method="GET", headers={"Authorization": client.auth}
    )
    try:
        opener.open(request)
    except urllib.error.HTTPError as err:
        if 300 <= err.code < 400:
            location = err.headers.get("Location") or err.headers.get("location") or ""
            parsed = urllib.parse.urlparse(location) if "://" in location else None
            path = parsed.path if parsed is not None else location
            slug = path.strip("/")
            if len(slug) == 3 and slug.isalnum():
                resolved = f"{client.base_url}/{slug}"
                print(f"Detected Kibana base path: {resolved}")
                return resolved
    except urllib.error.URLError:
        pass
    return client.base_url


def build_workflow_yaml(*, dest: str, source: str, lookback: str, limit: int) -> str:
    """Zero-LLM workflow: STATS BY service.name, upsert one entity KI per row."""
    return (
        WORKFLOW_YAML_TEMPLATE.replace("__DEST__", json.dumps(dest))
        .replace("__SOURCE__", json.dumps(source))
        .replace("__LOOKBACK__", json.dumps(lookback))
        .replace("__LIMIT__", str(limit))
    )


def parse_auth(raw: str) -> tuple[str, str]:
    if ":" not in raw:
        raise SystemExit("KIBANA_AUTH / --auth must be user:password")
    username, password = raw.split(":", 1)
    return username, password


def parse_args(argv: list[str]) -> Settings:
    parser = argparse.ArgumentParser(
        description="Create the obs-services AI index and load the service.name entity-KI workflow."
    )
    parser.add_argument(
        "--kibana-url", default=os.environ.get("KIBANA_URL", "http://localhost:5601")
    )
    parser.add_argument(
        "--es-url",
        default=os.environ.get("ES_URL")
        or os.environ.get("ELASTICSEARCH_HOST", "http://localhost:9200"),
    )
    parser.add_argument("--auth", default=os.environ.get("KIBANA_AUTH", "elastic:changeme"))
    parser.add_argument("--space", default="default")
    parser.add_argument(
        "--insecure", action="store_true", help="Skip TLS certificate verification"
    )
    parser.add_argument("--ai-index-id", default=DEFAULT_AI_INDEX_ID)
    parser.add_argument("--workflow-id", default=DEFAULT_WORKFLOW_ID)
    parser.add_argument(
        "--dest", default="", help="Dest index (default: ai-index-idx-<ai-index-id>)"
    )
    parser.add_argument(
        "--source", default=DEFAULT_SOURCE, help="ES|QL FROM clause, e.g. traces-apm*"
    )
    parser.add_argument(
        "--lookback", default=DEFAULT_LOOKBACK, help="ES|QL interval, e.g. '7 days'"
    )
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument(
        "--skip-enable", action="store_true", help="Do not set contextEngine:enabled"
    )
    parser.add_argument(
        "--skip-dest", action="store_true", help="Do not create the dest index in ES"
    )
    parser.add_argument("--print-yaml", action="store_true", help="Print workflow YAML and exit")
    parser.add_argument("--run", action="store_true", help="Run the workflow after loading it")
    args = parser.parse_args(argv)
    username, password = parse_auth(args.auth)
    dest = args.dest or f"ai-index-idx-{args.ai_index_id}"
    if not dest.startswith("ai-index-idx-"):
        raise SystemExit("--dest must start with ai-index-idx- (upsert needs a regular index)")
    if args.limit < 1:
        raise SystemExit("--limit must be a positive integer")
    return Settings(
        kibana_url=args.kibana_url,
        es_url=args.es_url,
        username=username,
        password=password,
        space=args.space,
        insecure=args.insecure,
        ai_index_id=args.ai_index_id,
        workflow_id=args.workflow_id,
        dest=dest,
        source=args.source,
        lookback=args.lookback,
        limit=args.limit,
        skip_enable=args.skip_enable,
        skip_dest=args.skip_dest,
        print_yaml=args.print_yaml,
        run=args.run,
    )


def require_ok(method: str, path: str, status: int, body: object, ok: set[int]) -> object:
    if status not in ok:
        raise ApiError(method, path, status, body)
    return body


def enable_context_engine(kibana: HttpClient) -> None:
    path = "/internal/kibana/settings"
    status, body = kibana.request(
        "POST",
        path,
        body={"changes": {CONTEXT_ENGINE_SETTING: True}},
        extra=kibana_headers(),
    )
    require_ok("POST", path, status, body, {200})
    print(f"Enabled {CONTEXT_ENGINE_SETTING}")


def ensure_dest_index(es: HttpClient, dest: str) -> None:
    status, body = es.request("GET", f"/{dest}")
    if status == 200:
        print(f"Dest index already exists: {dest}")
        return
    if status not in {404}:
        raise ApiError("GET", f"/{dest}", status, body)
    put_status, put_body = es.request("PUT", f"/{dest}", body={})
    if put_status in {200, 201}:
        print(f"Created dest index: {dest}")
        return
    error_type = ""
    if isinstance(put_body, dict):
        error = put_body.get("error")
        if isinstance(error, dict):
            error_type = str(error.get("type") or "")
    if put_status == 400 and error_type == "resource_already_exists_exception":
        print(f"Dest index already exists: {dest}")
        return
    raise ApiError("PUT", f"/{dest}", put_status, put_body)


def upsert_workflow(kibana: HttpClient, settings: Settings, yaml_text: str) -> str:
    prefix = _space_prefix(settings.space)
    path = f"{prefix}/api/workflows/workflow/{settings.workflow_id}"
    status, body = kibana.request("GET", path, extra=kibana_headers())
    if status == 200:
        put_status, put_body = kibana.request(
            "PUT",
            path,
            body={"yaml": yaml_text, "enabled": True},
            extra=kibana_headers(),
        )
        require_ok("PUT", path, put_status, put_body, {200})
        print(f"Updated workflow {settings.workflow_id}")
        return settings.workflow_id
    if status != 404:
        raise ApiError("GET", path, status, body)

    create_path = f"{prefix}/api/workflows/workflow"
    create_status, create_body = kibana.request(
        "POST",
        create_path,
        body={"id": settings.workflow_id, "yaml": yaml_text},
        extra=kibana_headers(),
    )
    require_ok("POST", create_path, create_status, create_body, {200})
    created_id = settings.workflow_id
    if isinstance(create_body, dict) and isinstance(create_body.get("id"), str):
        created_id = create_body["id"]
    print(f"Created workflow {created_id}")
    return created_id


def source_esql(settings: Settings) -> str:
    return (
        f"FROM {settings.source} | WHERE @timestamp >= NOW() - {settings.lookback} "
        "AND service.name IS NOT NULL | STATS doc_count = COUNT(*) BY service.name "
        f"| SORT doc_count DESC | LIMIT {settings.limit}"
    )


def _as_object_list(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def upsert_ai_index(kibana: HttpClient, settings: Settings, workflow_id: str) -> None:
    prefix = _space_prefix(settings.space)
    path = f"{prefix}/api/context_engine/ai_index/{settings.ai_index_id}"
    status, body = kibana.request("GET", path, extra=kibana_headers())
    automations: list[dict[str, object]] = [{"type": "workflow", "value": workflow_id}]
    sources: list[dict[str, object]] = [{"type": "esql", "value": source_esql(settings)}]
    properties: dict[str, object] = {
        "description": "One entity KI per observed service.name",
        "dest": {"type": "index", "value": settings.dest},
        "automations": automations,
        "sources": sources,
    }

    if status == 200:
        if isinstance(body, dict) and body.get("managed") is True:
            raise SystemExit(
                f"AI index '{settings.ai_index_id}' is managed and cannot be updated via the API"
            )
        existing = body if isinstance(body, dict) else {}
        kept_automations = [
            item
            for item in _as_object_list(existing.get("automations"))
            if item.get("value") != workflow_id
        ]
        kept_sources = [
            item
            for item in _as_object_list(existing.get("sources"))
            if item.get("type") != "esql"
        ]
        properties["automations"] = [*kept_automations, *automations]
        properties["sources"] = [*kept_sources, *sources]
        put_status, put_body = kibana.request(
            "PUT", path, body=properties, extra=kibana_headers()
        )
        require_ok("PUT", path, put_status, put_body, {200, 201})
        print(f"Updated AI index {settings.ai_index_id}")
        return

    if status != 404:
        raise ApiError("GET", path, status, body)

    create_path = f"{prefix}/api/context_engine/ai_index"
    create_status, create_body = kibana.request(
        "POST",
        create_path,
        body={"id": settings.ai_index_id, **properties},
        extra=kibana_headers(),
    )
    require_ok("POST", create_path, create_status, create_body, {200, 201})
    print(f"Created AI index {settings.ai_index_id}")


def run_workflow(kibana: HttpClient, settings: Settings) -> None:
    prefix = _space_prefix(settings.space)
    path = f"{prefix}/api/workflows/workflow/{settings.workflow_id}/run"
    status, body = kibana.request("POST", path, body={"inputs": {}}, extra=kibana_headers())
    require_ok("POST", path, status, body, {200})
    execution_id = body.get("workflowExecutionId") if isinstance(body, dict) else body
    print(f"Started workflow execution {execution_id}")


def main(argv: list[str] | None = None) -> int:
    settings = parse_args(argv if argv is not None else sys.argv[1:])
    yaml_text = build_workflow_yaml(
        dest=settings.dest,
        source=settings.source,
        lookback=settings.lookback,
        limit=settings.limit,
    )
    if settings.print_yaml:
        print(yaml_text, end="")
        return 0

    kibana = HttpClient(
        settings.kibana_url, settings.username, settings.password, settings.insecure
    )
    kibana.base_url = resolve_kibana_base_path(kibana)
    es = HttpClient(settings.es_url, settings.username, settings.password, settings.insecure)

    if not settings.skip_enable:
        enable_context_engine(kibana)
    if not settings.skip_dest:
        ensure_dest_index(es, settings.dest)

    workflow_id = upsert_workflow(kibana, settings, yaml_text)
    upsert_ai_index(kibana, settings, workflow_id)
    if settings.run:
        run_workflow(kibana, settings)

    prefix = _space_prefix(settings.space)
    summary_path = (
        f"{prefix}/internal/context_engine/ai_index/{settings.ai_index_id}/ki_summary"
    )
    print()
    print("Done.")
    print(f"  AI index:  {settings.ai_index_id}")
    print(f"  Dest:      {settings.dest}")
    print(f"  Workflow:  {workflow_id}")
    print(f"  Inspect:   GET {kibana.base_url}{summary_path}")
    print(f"  ES|QL:     FROM {settings.dest} | KEEP type, title, attributes | LIMIT 20")
    if not settings.run:
        print("  Run next:  add --run, or execute the workflow from the Workflows app.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApiError as err:
        print(err, file=sys.stderr)
        raise SystemExit(1) from err
