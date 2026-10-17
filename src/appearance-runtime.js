export function appearanceColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(`--${name}`).trim() || fallback;
  return { background: read('editor', '#ffffff'), foreground: read('text', '#172d50'), accent: read('accent', '#2563eb'), muted: read('muted', '#5c7091'), line: read('line', '#dce5f3'), selection: read('hover', '#eaf1fd') };
}
