import tar from 'tar-stream';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function tarBuffer(entries) {
  const pack = tar.pack(), chunks = [];
  const reading = (async () => { for await (const chunk of pack) chunks.push(chunk); })();
  for (const { name, data = '', ...header } of entries) {
    await new Promise((resolve, reject) => pack.entry({ name, ...header }, data, error => error ? reject(error) : resolve()));
  }
  pack.finalize(); await reading; return Buffer.concat(chunks);
}

export async function archiveBuffer(dir, extension, entries) {
  const source = await tarBuffer(entries);
  if (extension === '.tar') return source;
  if (extension === '.tar.gz' || extension === '.tgz') return gzipSync(source);
  const input = path.join(dir, 'fixture-input.tar'), output = path.join(dir, 'fixture-output' + extension);
  await fs.writeFile(input, source);
  const flags = {
    '.7z': ['--format=7zip'], '.tar.bz2': ['-j'], '.tbz2': ['-j'], '.tbz': ['-j'],
    '.tar.xz': ['-J'], '.txz': ['-J'], '.tar.zst': ['--zstd'], '.tzst': ['--zstd'],
  }[extension];
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'bsdtar', ['-c', '-f', output, '-P', ...flags, '@' + input], { windowsHide: true });
  return fs.readFile(output);
}

// Stored RAR5 fixture from libarchive's BSD-licensed test suite:
// https://github.com/libarchive/libarchive/blob/master/libarchive/test/test_read_format_rar5_stored.rar.uu
export const rarStored = Buffer.from('UmFyIRoHAQAzkrXlCgEFBgAFAQGAgAA4MAZjLAIDC50ABJ0ApIMCtEOglYAAAQ5oZWxsb3dvcmxkLnR4dAoDE34Oq1tW6Q4aaGVsbG8gbGliYXJjaGl2ZSB0ZXN0IHN1aXRlIQodd1ZRAwUEAA==', 'base64');

export async function encryptedRar() {
  const uu = await fs.readFile(new URL('../fixtures/archives/encrypted.rar.uu', import.meta.url), 'utf8'), bytes = [];
  for (const line of uu.trim().split(/\r?\n/).slice(1, -1)) {
    const length = (line.charCodeAt(0) - 32) & 63, decoded = [];
    for (let i = 1; i < line.length; i += 4) {
      const values = Array.from({length:4}, (_, n) => (line.charCodeAt(i + n) - 32) & 63);
      decoded.push((values[0] << 2) | (values[1] >> 4), ((values[1] & 15) << 4) | (values[2] >> 2), ((values[2] & 3) << 6) | values[3]);
    }
    bytes.push(...decoded.slice(0, length));
  }
  return Buffer.from(bytes);
}
