import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config';
import { FsStorage } from './fs';
import { S3Storage } from './s3';
import { contentTypeFor, pool, walk } from './utils';

export { contentTypeFor, pool, walk };

export interface StoredObject {
  body: Readable;
  size: number;
  contentType: string;
  etag?: string;
}

/** Minimal object-storage contract implemented by MinIO/S3 and local disk drivers. */
export interface StorageDriver {
  readonly name: 'fs' | 's3';
  init(): Promise<void>;
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  getObject(key: string): Promise<StoredObject | null>;
  listKeys(prefix: string): Promise<string[]>;
  downloadToFile(key: string, filePath: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  ping(): Promise<boolean>;
}

export interface UploadProgress {
  done: number;
  total: number;
  bytes: number;
}

export async function uploadDirectory(
  storage: StorageDriver,
  dir: string,
  prefix: string,
  opts: { ignore?: (rel: string, isDir: boolean) => boolean; onProgress?: (p: UploadProgress) => void } = {},
) {
  const files = await walk(dir, opts.ignore);
  let done = 0;
  let bytes = 0;
  await pool(files, 16, async (rel) => {
    const abs = path.join(dir, rel);
    const { size } = await fs.stat(abs);
    await storage.putFile(`${prefix}${rel}`, abs, contentTypeFor(rel));
    done++;
    bytes += size;
    opts.onProgress?.({ done, total: files.length, bytes });
  });
  return { fileCount: files.length, totalBytes: bytes };
}

export async function downloadPrefix(storage: StorageDriver, prefix: string, dir: string) {
  const keys = await storage.listKeys(prefix);
  await pool(keys, 16, async (key) => {
    const rel = key.slice(prefix.length);
    const target = path.join(dir, rel);
    if (!target.startsWith(dir)) return; // path traversal guard
    await fs.mkdir(path.dirname(target), { recursive: true });
    await storage.downloadToFile(key, target);
  });
  return keys.length;
}

let instance: StorageDriver | null = null;

export async function getStorage(): Promise<StorageDriver> {
  if (instance) return instance;
  if (config.storage.driver === 's3' && (!config.storage.s3.accessKeyId || !config.storage.s3.secretAccessKey)) {
    throw new Error('S3_ACCESS_KEY and S3_SECRET_KEY must be set (see .env.example), or use STORAGE_DRIVER=fs.');
  }
  const driver: StorageDriver =
    config.storage.driver === 'fs' ? new FsStorage(config.storage.fsDir) : new S3Storage(config.storage.s3);
  await driver.init();
  instance = driver;
  return driver;
}

export const storageKeys = {
  source: (id: string) => `source/${id}/`,
  output: (id: string) => `dist/${id}/`,
};
