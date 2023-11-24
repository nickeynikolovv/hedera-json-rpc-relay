#!/bin/bash
set -v
set +e
docker kill $(docker ps -q)
docker rm -v $(docker ps -qa)
hedera stop
sleep 5
hedera restart -d
docker stop json-rpc-relay json-rpc-relay-ws