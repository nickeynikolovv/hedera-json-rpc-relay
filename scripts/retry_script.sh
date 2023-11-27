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
sleep 5
hedera restart -d
docker stop json-rpc-relay json-rpc-relay-ws