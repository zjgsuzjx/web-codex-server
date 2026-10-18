export function appearanceColors() {
  const style = getComputedStyle(document.documentElement);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const read = (name, fallback) => {
    const color = style.getPropertyValue(`--${name}`).trim() || fallback;
    if (!context) return fallback;
    // Monaco and xterm require concrete colors, including for CSS color-mix().
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = fallback; context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return '#' + [...context.getImageData(0, 0, 1, 1).data].map(value => value.toString(16).padStart(2, '0')).join('');
  };
  const colors = { background: read('editor', '#ffffff'), foreground: read('text', '#182230'), accent: read('accent', '#3b6cf6'), muted: read('muted', '#64748b'), line: read('line', '#e5e9f0'), selection: read('ui-selected', '#dbe7ff'), highlight: read('hover', '#f1f5f9') };
  for (const name of ['foreground','keyword','type','string','number','comment','line-number','line-number-active','current-line','indent','indent-active','selection']) colors[`code-${name}`] = read(`editor-${name}`, colors.foreground);
  return colors;
}
