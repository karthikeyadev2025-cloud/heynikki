#!/usr/bin/env bash
# Search a service's logs across deploys: the archives deploy.sh saves
# (logs/archive, 30 days) plus what the running container has printed since.
#
#   ./applogs.sh api "billsec missing"          # heynikki-api
#   ./applogs.sh pipeline 54ed3301              # heynikki-pipeline
#   ./applogs.sh outbound "" | tail -50         # everything, newest last
#
# Lines carry Docker's UTC timestamps, so the archive and live output merge
# in time order.
set -euo pipefail
cd "$(dirname "$0")"
svc="${1:?usage: applogs.sh <api|pipeline|scheduler|outbound> [pattern]}"
pat="${2:-}"
c="heynikki-$svc"
{
  for f in $(ls -1 logs/archive/"$c"-*.log.gz 2>/dev/null | sort); do zcat "$f"; done
  docker logs --timestamps "$c" 2>&1 || true
} | { if [ -n "$pat" ]; then grep -a -- "$pat"; else cat; fi; } | sort -s -k1,1 | uniq
