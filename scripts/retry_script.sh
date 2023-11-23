#!/bin/bash
set -v
set +e
kill -- -$(ps -o pgid= $(pgrep -f "npm run start"))
hedera restart -d
sleep 5
docker stop json-rpc-relay json-rpc-relay-ws
npm run start &
npm run start:ws &