import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', '.vercel'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) scan(filename);
    else if (/\.(mjs|js)$/.test(entry.name)) execFileSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
  }
}
scan(root);
execFileSync(process.execPath, ['--test', 'tests/api.test.mjs'], { cwd: root, stdio: 'inherit' });
console.log('Build checks passed. Static output: public/; API: api/gateway.mjs');
