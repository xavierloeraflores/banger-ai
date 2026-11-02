import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
const bundle = await readFile(new URL('../dist/sandbox-runner.mjs', import.meta.url));
const hash = createHash('sha256').update(bundle).digest('hex');
const pathname = `runtime/${hash}/${randomUUID()}/sandbox-runner.mjs`;
await put(pathname, bundle, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'text/javascript' });
console.log(`SANDBOX_RUNNER_BLOB_PATH=${pathname}`);
