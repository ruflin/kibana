#!/bin/bash

# Set the default config file
DEFAULT_CONFIG_FILE="./config/kibana.dev.yml"

# Check if a config file is provided and use the default if not
CONFIG_FILE=${1:-$DEFAULT_CONFIG_FILE}

save_and_exit ( ) {
    # the dev process doesn't restart without a sleep after the HTTP calls, not sure why
    sleep 1

    echo "Saving config file to trigger a restart..."

    # Touch the config file to trigger a file change
    touch -c "$CONFIG_FILE"

    exit 0
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# system_indices_superuser:changeme exists on both `node scripts/es snapshot` and
# `node scripts/es serverless`, and may delete the restricted .kibana* indices.
if ! ENV_OUTPUT="$(node "$REPO_ROOT/scripts/local_stack.js" env --skip-kibana --config "$CONFIG_FILE" \
  --es-username "${ELASTICSEARCH_USERNAME:-system_indices_superuser}" \
  --es-password "${ELASTICSEARCH_PASSWORD:-changeme}")"; then
    echo "$ENV_OUTPUT" >&2
    exit 1
fi
eval "$ENV_OUTPUT"

CURL_TLS_FLAGS=()
if [ -n "$LOCAL_STACK_INSECURE" ]; then
    CURL_TLS_FLAGS=(-k)
elif [ -n "$LOCAL_STACK_CA_CERT" ]; then
    CURL_TLS_FLAGS=(--cacert "$LOCAL_STACK_CA_CERT")
fi

# Get the list of indices from the _cat/indices API
echo "Getting list of indices..."
INDICES=$(curl -s ${CURL_TLS_FLAGS[@]+"${CURL_TLS_FLAGS[@]}"} -X GET "${ELASTICSEARCH_HOST}/_cat/indices/.kibana*?format=txt" \
     -u "${ELASTICSEARCH_USERNAME}:${ELASTICSEARCH_PASSWORD}" | awk '{print $3}')
if [ $? -ne 0 ]; then
    echo "Failed to get the list of indices."
    exit 1
fi

# Convert the list of indices to a comma-separated list
INDICES_CSV=$(echo $INDICES | tr ' ' ',')

if [ -z "$INDICES_CSV" ]; then
    echo "No indices to delete."
    save_and_exit
fi

# Execute the DELETE call with curl using the extracted list of indices
echo "Deleting indices: $INDICES_CSV"
HTTP_STATUS=$(curl -s ${CURL_TLS_FLAGS[@]+"${CURL_TLS_FLAGS[@]}"} -o /dev/null -w "%{http_code}" -X DELETE "${ELASTICSEARCH_HOST}/$INDICES_CSV" \
     -u "${ELASTICSEARCH_USERNAME}:${ELASTICSEARCH_PASSWORD}")
if [ $? -ne 0 ] && [ "$HTTP_STATUS" != "404" ]; then
    echo "Failed to delete indices."
    exit 1
fi

save_and_exit
