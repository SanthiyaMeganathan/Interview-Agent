#!/usr/bin/env bash
set -Eeuo pipefail

python -c "from db import init_db; init_db()"

python agent.py start &
worker_pid=$!
python api.py &
api_pid=$!

shutdown() {
    trap - EXIT INT TERM
    kill "$api_pid" "$worker_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
}

trap shutdown EXIT INT TERM
wait -n "$api_pid" "$worker_pid"
