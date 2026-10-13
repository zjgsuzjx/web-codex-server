function direction(value) {
  const paragraphs = value.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const latest = paragraphs.at(-1) || '';
  const heading = paragraphs.findLast(part => /^(?:\*\*[^*]+\*\*|#{1,6}\s+[^\n]+)$/.test(part));
  return [heading && heading !== latest ? heading : '', latest].filter(Boolean).join(' · ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ').replace(/[*`#_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 260);
}

// Reasoning summaries and commentary already appear in the process records.
// Codex does not provide a separate thinking label; do not repeat that body text.
export function currentThought(turn) {
  for (const item of [...(turn?.items || [])].reverse()) {
    let value = '';
    if (item.type === 'reasoning' || item.type === 'plan' || item.type === 'agentMessage' && item.phase === 'commentary') return '正在思考';
    if (item.type === 'commandExecution' && item.status === 'inProgress') value = `正在运行命令：${item.command || '检查项目'}`;
    else if (item.type === 'fileChange' && item.status === 'inProgress') value = `正在修改文件：${item.changes?.map(change => change.path?.split('/').at(-1)).filter(Boolean).join('、') || '项目文件'}`;
    else if (['mcpToolCall', 'dynamicToolCall'].includes(item.type) && item.status === 'inProgress') value = `正在使用 ${item.tool || '工具'}`;
    const label = direction(value);
    if (label) return label;
  }
  return '正在思考';
}
