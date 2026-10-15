export const AVATAR_SIZE = 256;
export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 16_000_000;

// Read dimensions before asking the browser to decode the original bitmap.
export function avatarDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let width, height;
  if (bytes.length >= 24 && text(0, 8) === '\x89PNG\r\n\x1a\n' && text(12, 4) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += size;
    }
  } else if (bytes.length >= 25 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const kind = text(12, 4);
    if (kind === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === 'VP8L' && bytes[20] === 47) {
      const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }
  if (!width || !height) throw new Error('请选择有效的 JPG、PNG、WebP 图片');
  if (width * height > AVATAR_MAX_PIXELS || Math.max(width, height) > 8192) throw new Error('图片过大，请缩小至 1600 万像素以内，且单边不超过 8192 像素');
  return { width, height };
}

// Position is normalized to the available travel, so resizing the editor keeps
// the same crop. The visible square is always completely covered by the image.
export function avatarCrop(width, height, zoom = 1, position = { x: 0, y: 0 }) {
  const side = Math.min(width, height) / Math.max(1, Math.min(3, zoom));
  const travelX = (width - side) / 2, travelY = (height - side) / 2;
  const x = Math.max(-1, Math.min(1, position.x)), y = Math.max(-1, Math.min(1, position.y));
  return { x: travelX * (1 - x), y: travelY * (1 - y), side, travelX, travelY };
}
