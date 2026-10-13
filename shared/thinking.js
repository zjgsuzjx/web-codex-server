const text = value => typeof value === 'string' ? value : value?.text || '';
function direction(value) {
  const paragraphs = value.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const latest = paragraphs.at(-1) || '';
  const heading = paragraphs.findLast(part => /^(?:\*\*[^*]+\*\*|#{1,6}\s+[^\n]+)$/.test(part));
  return [heading && heading !== latest ? heading : '', latest].filter(Boolean).join(' · ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ').replace(/[*`#_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 260);
}

// The status line uses readable summaries and public progress messages only.
export function currentThought(turn) {
  for (const item of [...(turn?.items || [])].reverse()) {
    let value = '';
    if (item.type === 'reasoning') {
      const summaries = (item.summary || []).map(text), streamed = item.streamedSummaryParts || [];
      const index = Math.max(summaries.findLastIndex(Boolean), streamed.findLastIndex(Boolean));
      const complete = summaries[index] || '';
      const stream = streamed[index] || (!streamed.length ? item.streamedReasoning : '') || '';
      value = complete && !(stream.startsWith(complete) && stream.length > complete.length) ? complete : stream || complete;
    } else if (item.type === 'agentMessage' && item.phase === 'commentary') value = item.text || '';
    else if (item.type === 'commandExecution' && item.status === 'inProgress') value = `正在运行命令：${item.command || '检查项目'}`;
    else if (item.type === 'fileChange' && item.status === 'inProgress') value = `正在修改文件：${item.changes?.map(change => change.path?.split('/').at(-1)).filter(Boolean).join('、') || '项目文件'}`;
    else if (['mcpToolCall', 'dynamicToolCall'].includes(item.type) && item.status === 'inProgress') value = `正在使用 ${item.tool || '工具'}`;
    const label = direction(value);
    if (label) return label;
  }
  return turn?.plan?.find(step => step.status === 'inProgress')?.step || '正在梳理任务与下一步方向';
}
