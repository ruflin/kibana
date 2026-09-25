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

Scripts that need both Elasticsearch and Kibana can use the shared CLI flags:

```ts
import { run } from '@kbn/dev-cli-runner';
import {
  getLocalStackOptionsFromFlags,
  kibanaFetch,
  LOCAL_STACK_FLAG_OPTIONS,
  resolveLocalStack,
} from '@kbn/local-stack-connection';

run(
  async ({ log, flags }) => {
    const { elasticsearch, kibana } = await resolveLocalStack({
      log,
      ...getLocalStackOptionsFromFlags(flags),
    });
    await kibanaFetch(kibana, '/api/status');
  },
  { flags: LOCAL_STACK_FLAG_OPTIONS }
);
```

`LOCAL_STACK_FLAG_OPTIONS` adds `--es-url`, `--es-username`, `--es-password`, `--es-api-key`,
`--kibana-url`, `--kibana-username`, `--kibana-password`, `--kibana-api-key`, and `--insecure`.

## Resolution order

### Elasticsearch

1. Explicit options (`url` may contain `user:pass@`, `username`, `password`, `apiKey`)
2. `ELASTICSEARCH_HOST`, `ELASTICSEARCH_USERNAME`, `ELASTICSEARCH_PASSWORD`, `ELASTICSEARCH_API_KEY`
3. The first `elasticsearch.hosts` entry in `config/kibana.dev.yml`
4. `http://localhost:9200`, then `https://localhost:9200`

Local URLs are tried over both http and https. Without explicit credentials, `elastic` and then
`elastic_serverless` are tried. The `kibana_system` credentials in `kibana.dev.yml` are never used,
since they lack the privileges scripts need. When `kibana.dev.yml` points to a remote cluster, there
is no fallback to localhost.

### Kibana

1. Explicit options (`url` may contain `user:pass@` and a base path)
2. `KIBANA_URL`, `KIBANA_USERNAME`, `KIBANA_PASSWORD`, `KIBANA_API_KEY` (and the legacy
   `KIBANA_AUTH=user:pass`)
3. `server.host`, `server.port`, `server.basePath`, and `server.ssl.enabled` in `config/kibana.dev.yml`
4. `http://localhost:5601`, then `https://localhost:5601`

The random base path of the dev base path proxy is detected by following the redirect of `/`.
`resolveLocalStack` tries the Elasticsearch credentials first, then the default superusers.

## TLS

`getTlsOptions(url, { insecure })` is the single TLS policy:

- https on a local host: trust the dev CA from `@kbn/dev-utils` and verify against `localhost`.
  The dev certificates have no IP address entries, so this is what makes `https://127.0.0.1:9200`
  work.
- other https hosts: Node defaults.
- `insecure: true`: certificate verification disabled. Only set this from an explicit opt-in.

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`: `@kbn/setup-node-env` exits on the warning it emits.
