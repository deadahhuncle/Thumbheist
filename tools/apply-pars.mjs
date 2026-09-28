// Write par times into js/levels.js from tools/results/*.json (all-coins optimum).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CHAPTERS } from '../js/levels.js';
let src = readFileSync('js/levels.js', 'utf8');
const par = (t) => Math.ceil((t * 1.12 + 1.2) * 2) / 2;
for (const ch of CHAPTERS) for (const def of ch.levels) {
  const f = `tools/results/${def.id}.json`;
  if (!existsSync(f)) { console.log('missing', def.id); continue; }
  const r = JSON.parse(readFileSync(f, 'utf8')).row;
  if (typeof r.coins !== 'number') { console.log('no coin route', def.id); continue; }
  const p = par(r.coins);
  const idLine = `        id: '${def.id}',\n`;
  const i = src.indexOf(idLine);
  const end = src.indexOf('\n      },', i);
  let block = src.slice(i, end);
  if (/\n        par: [\d.]+,/.test(block)) block = block.replace(/\n        par: [\d.]+,/, `\n        par: ${p},`);
  else block = block.replace(idLine, `${idLine}        par: ${p},\n`);
  src = src.slice(0, i) + block + src.slice(end);
  console.log(def.id, 'best', r.coins, '-> par', p);
}
writeFileSync('js/levels.js', src);
