#!/usr/bin/env bash
# Host-side firmware test runner. On Windows, run via WSL:
#   wsl bash tests/firmware/run.sh
set -e
cd "$(dirname "$0")"
make clean >/dev/null 2>&1 || true
make
