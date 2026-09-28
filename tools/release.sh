#!/bin/sh
# Final checks + builds: merge solver results, apply pars, run tests, build the single-file artifact.
set -e
cd "$(dirname "$0")/.."
node tools/merge-results.mjs > /dev/null
node tools/apply-pars.mjs
node tests/unit.mjs | tail -3
node tools/build-artifact.mjs "${ESBUILD:-npx esbuild}"
