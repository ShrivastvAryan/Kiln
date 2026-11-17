import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageDriver, StoredObject } from './index';
import { contentTypeFor, walk } from './utils';

/** Local-disk object storage. Same key layout as S3, useful when Docker/MinIO isn't available. */
export class FsStorage implements StorageDriver {
  readonly name = 'fs' as const;
  constructor(private root: string) {}

  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`Invalid key: ${key}`);
    return p;
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true });
  }

  async putFile(key: string, filePath: string) {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(filePath, target);
  }

  async getObject(key: string): Promise<StoredObject | null> {
    try {
      const p = this.resolve(key);
      const stat = await fs.stat(p);
      if (!stat.isFile()) return null;
      return {
        body: createReadStream(p),
        size: stat.size,
        contentType: contentTypeFor(p),
        etag: `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`,
      };
    } catch {
      return null;
    }
  }

  async listKeys(prefix: string) {
    const dir = this.resolve(prefix);
    try {
      return (await walk(dir)).map((rel) => prefix + rel);
    } catch {
      return [];
    }
  }

  async downloadToFile(key: string, filePath: string) {
    await fs.copyFile(this.resolve(key), filePath);
  }

  async deletePrefix(prefix: string) {
    const keys = await this.listKeys(prefix);
    await fs.rm(this.resolve(prefix), { recursive: true, force: true });
    return keys.length;
  }

  async ping() {
    try {
      await fs.access(this.root);
      return true;
    } catch {
      return false;
    }
  }
}
