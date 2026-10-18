// These are rendering hints, not access to the browser's acceleration setting.
export function classifyGraphicsRenderer(renderer = '') {
  if (/swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic render|\bwarp\b/i.test(renderer)) return 'software';
  if (/\b(nvidia|geforce|quadro|intel|amd|radeon|apple|adreno|mali|powervr|qualcomm|vivante|broadcom)\b/i.test(renderer)) return 'hardware';
  return 'unknown';
}

export function detectBrowserGraphics(createCanvas = () => document.createElement('canvas')) {
  for (const type of ['webgl2', 'webgl']) {
    let gl;
    try {
      gl = createCanvas().getContext(type, { failIfMajorPerformanceCaveat: false });
      if (!gl) continue;
      if (gl.isContextLost()) return 'unknown';
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      // Masked/generic strings must never be treated as proof of acceleration.
      return info ? classifyGraphicsRenderer(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    } catch {
      if (gl) return 'unknown';
    } finally {
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* Best effort release. */ }
    }
  }
  return 'unavailable';
}

export function browserGraphicsGuide(userAgent = '') {
  if (!/Mobi|Android|iPhone|iPad|iPod/i.test(userAgent)) {
    if (/Edg\//.test(userAgent)) return { name: 'Microsoft Edge', path: '设置 → 系统和性能 → 系统', address: 'edge://settings/system' };
    if (/Chrome\//.test(userAgent) && !/OPR\//.test(userAgent)) return { name: 'Chrome', path: '设置 → 系统', address: 'chrome://settings/system' };
  }
  return { name: '当前浏览器', path: '浏览器设置，搜索“图形加速”或“硬件加速”', address: '' };
}
