#!/bin/bash
# run.sh <tag> <level> <procs> <gamesPerProc> <seedBase> [overrides]
tag=$1; level=$2; procs=$3; per=$4; base=$5; ov=$6
for i in $(seq 0 $((procs-1))); do
  node "$(dirname "$0")/study.js" "${CSV:-unit-cards-source.csv}" $((base + i*per)) $per $level ${RUNS:-runs}/$tag-$i.json "$ov" 2>${RUNS:-runs}/$tag-$i.log &
done
wait
echo done $tag
