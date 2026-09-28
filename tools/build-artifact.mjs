// Build a single self-contained HTML file (for hosting as a claude.ai Artifact):
// JS bundled with esbuild, CSS and fonts inlined. No <html>/<head>/<body> wrapper.
// Usage: node tools/build-artifact.mjs <path-to-esbuild> [out]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

const esbuild = process.argv[2] || 'npx esbuild';
const out = process.argv[3] || 'dist/one-thumb-heist.html';
mkdirSync(dirname(out), { recursive: true });

const js = execFileSync(esbuild, ['js/main.js', '--bundle', '--format=iife', '--minify', '--target=es2020', '--legal-comments=none'], { encoding: 'utf8', maxBuffer: 1 << 26 });
let css = readFileSync('css/style.css', 'utf8');
css = css.replace(/url\("\.\.\/assets\/fonts\/([^"]+)"\) format\("woff2"\)/g, (_, f) => {
  const b64 = readFileSync(`assets/fonts/${f}`).toString('base64');
  return `url(data:font/woff2;base64,${b64}) format("woff2")`;
});
const html = readFileSync('index.html', 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script type="module"[^>]*><\/script>/, '').trim();
const page = `<title>One Thumb Heist</title>
<meta name="description" content="Draw one continuous route with your thumb. Lift, and watch the heist play out.">
<style>${css}</style>
${body}
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync(out, page);
console.log(out, (page.length / 1024).toFixed(0) + ' KB');
