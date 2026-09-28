#!/bin/sh
# Solve levels in parallel: tools/solve-all.sh [ids...]  (default: all)
cd "$(dirname "$0")/.."
IDS="$*"
[ -z "$IDS" ] && IDS=$(node -e "import('./js/levels.js').then(m=>console.log(m.CHAPTERS.flatMap(c=>c.levels.map(l=>l.id)).join(' ')))")
echo $IDS | tr ' ' '\n' | xargs -P 4 -I{} sh -c 'node tools/solve.mjs {} --out > /dev/null 2>&1 || echo "failed {}"'
node tools/merge-results.mjs
