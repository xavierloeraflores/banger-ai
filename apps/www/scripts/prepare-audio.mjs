import { mkdir, writeFile } from 'node:fs/promises';
import { SIDECHAIN_WORKLET_SOURCE } from '@banger/engine';

const directory = new URL('../public/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('banger-sidechain.js', directory), SIDECHAIN_WORKLET_SOURCE, 'utf8');
