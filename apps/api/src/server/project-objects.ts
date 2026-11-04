import { db } from './db';
import { blobs, type ObjectStore } from './blob';
import { ApiError } from './domain';

export const projectObjects: ObjectStore = {
  async write(path, body) {
    if (typeof body !== 'string' || Buffer.byteLength(body) > 4 * 1024 * 1024) throw new ApiError(413, 'Project source exceeds 4 MiB.');
    await db().query('INSERT INTO project_source_objects(pathname,source) VALUES($1,$2)', [path, body]);
  },
  async text(path) {
    const result = await db().query('SELECT source FROM project_source_objects WHERE pathname=$1', [path]);
    return result.rows[0] ? result.rows[0].source : blobs.text(path);
  },
};
