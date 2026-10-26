# @kbn/local-stack-connection

Resolves how a developer script connects to Elasticsearch, so the same script works against a
local stateful stack (`node scripts/es snapshot`), a local serverless stack
(`node scripts/es serverless`), and remote clusters without per-script detection logic.

| | Stateful | Serverless |
|---|---|---|
| Elasticsearch | `http://localhost:9200` | `https://localhost:9200` |
| Superuser | `elastic:changeme` | `elastic_serverless:changeme` |

```ts
import { Client } from '@elastic/elasticsearch';
import { getEsClientOptions, resolveElasticsearch } from '@kbn/local-stack-connection';

const es = await resolveElasticsearch({ log, url: flags['es-url'] });
const client = new Client(getEsClientOptions(es));
```

## Resolution order

1. Explicit options (`url` may contain `user:pass@`, `username`, `password`, `apiKey`)
2. `ELASTICSEARCH_HOST`, `ELASTICSEARCH_USERNAME`, `ELASTICSEARCH_PASSWORD`, `ELASTICSEARCH_API_KEY`
3. The first `elasticsearch.hosts` entry in `config/kibana.dev.yml`
4. `http://localhost:9200`, then `https://localhost:9200`

Local URLs are tried over both http and https. Without explicit credentials, `elastic` and then
`elastic_serverless` are tried. The `kibana_system` credentials in `kibana.dev.yml` are never used,
since they lack the privileges scripts need. When `kibana.dev.yml` points to a remote cluster, there
is no fallback to localhost.

## TLS

`getTlsOptions(url, { insecure })` is the single TLS policy:

- https on a local host: trust the dev CA from `@kbn/dev-utils` and verify against `localhost`.
  The dev certificates have no IP address entries, so this is what makes `https://127.0.0.1:9200`
  work.
- other https hosts: Node defaults.
- `insecure: true`: certificate verification disabled. Only set this from an explicit opt-in.

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`: `@kbn/setup-node-env` exits on the warning it emits.
