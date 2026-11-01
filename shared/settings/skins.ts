import type { SkinConfig } from '../contracts/domain.ts';
import type { ProtocolRecord } from '../contracts/protocol.ts';
export const WALLPAPER_MAX_BYTES = 6 * 1024 * 1024;
export const SKIN_PRESET_LIMIT = 12;
export const skinDevice = (userAgent: string | undefined) =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent || '') ? 'mobile' : 'desktop';
export const skinSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    mode: { type: 'string', enum: ['light', 'dark'] },
    palette: {
      type: 'object',
      additionalProperties: false,
      properties: {
        background: { type: 'string' },
        surface: { type: 'string' },
        accent: { type: 'string' },
      },
      required: ['background', 'surface', 'accent'],
    },
    wallpaper: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fit: { type: 'string', enum: ['cover', 'contain'] },
        x: { type: 'number' },
        y: { type: 'number' },
        shade: { type: 'number' },
      },
      required: ['fit', 'x', 'y', 'shade'],
    },
  },
  required: ['name', 'description', 'mode', 'palette', 'wallpaper'],
};

const rgb = (hex: string) =>
  hex
    .slice(1)
    .match(/../g)!
    .map((n) => parseInt(n, 16));
export function mix(a: string, b: string, weight: number) {
  const end = rgb(b);
  return (
    '#' +
    rgb(a)
      .map((n, i) =>
        Math.round(n + (end[i] - n) * weight)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const luminance = (hex: string) =>
  rgb(hex)
    .map((n) => n / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
    .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
export const contrast = (a: string, b: string) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
function readable(color: string, backgrounds: string[], minimum = 4.5) {
  if (backgrounds.every((bg) => contrast(color, bg) >= minimum)) return color;
  const target = luminance(backgrounds[0]) > 0.3 ? '#000000' : '#ffffff';
  for (let step = 1; step <= 20; step++) {
    const next = mix(color, target, step / 20);
    if (backgrounds.every((bg) => contrast(next, bg) >= minimum)) return next;
  }
  return target;
}
export function normalizeSkin(value: ProtocolRecord) {
  if (!value || !['light', 'dark'].includes(value.mode)) throw new Error('主题模式无效');
  const palette: Record<string, string> = {};
  for (const key of ['background', 'surface', 'accent']) {
    if (!/^#[0-9a-f]{6}$/i.test(value.palette?.[key] || ''))
      throw new Error('主题颜色必须为六位十六进制色值');
    palette[key] = value.palette[key].toLowerCase();
  }
  // Keep surfaces in one luminance family so every derived text token remains readable.
  for (const key of ['background', 'surface']) {
    const target = value.mode === 'dark' ? '#101318' : '#ffffff';
    if (value.mode === 'dark' ? luminance(palette[key]) > 0.08 : luminance(palette[key]) < 0.75)
      palette[key] = mix(palette[key], target, 0.9);
  }
  const w = value.wallpaper;
  if (
    !w ||
    !['cover', 'contain'].includes(w.fit) ||
    ['x', 'y', 'shade'].some((k) => typeof w[k] !== 'number' || !Number.isFinite(w[k]))
  )
    throw new Error('壁纸构图配置无效');
  return {
    version: 1,
    name:
      String(value.name || '我的壁纸')
        .trim()
        .slice(0, 40) || '我的壁纸',
    description: String(value.description || '').slice(0, 160),
    mode: value.mode,
    palette,
    wallpaper: {
      fit: w.fit,
      x: Math.max(0, Math.min(100, w.x)),
      y: Math.max(0, Math.min(100, w.y)),
      shade: Math.max(0.12, Math.min(0.7, w.shade)),
    },
  };
}
export function skinTokens(config: SkinConfig) {
  const { background: bg, surface, accent: seed } = config.palette,
    dark = config.mode === 'dark';
  const side = mix(surface, bg, 0.25),
    panel = surface,
    hover = mix(surface, seed, dark ? 0.15 : 0.09),
    backgrounds = [bg, side, panel, hover];
  const text = readable(dark ? '#f2f5fa' : '#18212e', backgrounds, 7);
  const accent = readable(seed, backgrounds);
  return {
    bg,
    side,
    panel,
    hover,
    text,
    muted: readable(mix(text, surface, 0.28), backgrounds),
    subtle: readable(mix(text, surface, 0.4), backgrounds),
    line: mix(surface, text, 0.18),
    accent,
    'accent-ink': contrast(accent, '#ffffff') >= 4.5 ? '#ffffff' : '#101318',
    editor: surface,
    danger: readable(dark ? '#ffb0bb' : '#b72942', backgrounds),
    success: readable(dark ? '#8eddb7' : '#16643d', backgrounds),
    warning: readable(dark ? '#f2cf90' : '#805618', backgrounds),
    'code-bg': mix(surface, bg, 0.5),
    'code-text': text,
    'accent-soft': mix(surface, seed, 0.12),
    'on-dark': '#f3f5fa',
    shadow: dark ? '#00000055' : '#18212e18',
  };
}
