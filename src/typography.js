// Canvas-based editors need the resolved family list rather than a CSS var().
export function codeFontFamily() {
  return getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim();
}
