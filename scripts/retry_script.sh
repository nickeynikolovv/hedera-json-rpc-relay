#!/bin/bash
set -v
set +e
hedera stop
sleep 5
docker ps -a
docker volume ls
docker network ls
docker kill $(docker ps -q)
docker rm -v $(docker ps -qa)
docker system prune --volumes -f
ls -lah$(dirname $(realpath $(which hedera)))/network-logs
rm -rf $(dirname $(realpath $(which hedera)))/network-logs
sleep 5
hedera restart -d
docker stop json-rpc-relay json-rpc-relay-ws