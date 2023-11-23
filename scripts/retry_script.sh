#!/bin/bash
set -v
set +e
kill -9 $(cat /tmp/relay.pid)
kill -9 $(cat /tmp/relay-ws.pid)
hedera restart -d
sleep 5
docker stop json-rpc-relay json-rpc-relay-ws
npm run start &
echo $! >/tmp/relay.pid
npm run start:ws &
echo $! >/tmp/relay-ws.pid
