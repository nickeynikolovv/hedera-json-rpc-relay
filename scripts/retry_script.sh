#!/bin/bash
set -v
set +e
pkill -f "node dist/index.js"
hedera restart -d
sleep 5
docker stop json-rpc-relay json-rpc-relay-ws
npm run start &
npm run start:ws &