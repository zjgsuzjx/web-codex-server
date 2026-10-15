import { inflateSync } from 'node:zlib';
import { fail } from './files.js';
import { AVATAR_SIZE, AVATAR_MAX_BYTES } from '../shared/avatar.js';

const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export function pngCrc(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Accept only a small, fully uploaded raster. Check the compressed scanlines,
// not just the signature, and discard ancillary metadata (including EXIF).
export function validateAvatar(data) {
  if (data.length > AVATAR_MAX_BYTES) fail(413, '裁剪后的头像不能超过 256 KB');
  const invalid = () => fail(400, '头像图片无效，请重新裁剪后上传');
  if (!data.subarray(0, 8).equals(signature)) invalid();
  let offset = 8, header, ended = false, idatEnded = false;
  const image = [], chunks = [signature];
  while (offset < data.length) {
    if (offset + 12 > data.length) invalid();
    const length = data.readUInt32BE(offset), end = offset + length + 12;
    if (end > data.length) invalid();
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (pngCrc(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) invalid();
    if (!header && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (header || length !== 13) invalid();
      header = data.subarray(offset + 8, end - 4);
      if (header.readUInt32BE(0) !== AVATAR_SIZE || header.readUInt32BE(4) !== AVATAR_SIZE) fail(400, '头像尺寸必须为 256 × 256');
      if (header[8] !== 8 || ![2, 6].includes(header[9]) || header[10] || header[11] || header[12]) invalid();
      chunks.push(data.subarray(offset, end));
    } else if (type === 'IDAT') {
      if (idatEnded) invalid();
      image.push(data.subarray(offset + 8, end - 4)); chunks.push(data.subarray(offset, end));
    } else if (type === 'IEND') {
      if (length || !image.length || end !== data.length) invalid();
      ended = true; chunks.push(data.subarray(offset, end));
    } else {
      if (!/^[a-z][A-Za-z]{3}$/.test(type)) invalid();
      if (image.length) idatEnded = true;
    }
    offset = end;
  }
  if (!ended) invalid();
  const stride = AVATAR_SIZE * (header[9] === 6 ? 4 : 3) + 1, expected = stride * AVATAR_SIZE;
  let pixels;
  try { pixels = inflateSync(Buffer.concat(image), { maxOutputLength: expected }); } catch { invalid(); }
  if (pixels.length !== expected) invalid();
  for (let row = 0; row < AVATAR_SIZE; row++) if (pixels[row * stride] > 4) invalid();
  return Buffer.concat(chunks);
}
