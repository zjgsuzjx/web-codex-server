export const isProcessItem = item => !['userMessage', 'imageGeneration'].includes(item.type) && !toolContent(item).some(contentImage) && (item.type !== 'agentMessage' || item.phase === 'commentary');
export const textParts = values => (Array.isArray(values) ? values : []).map(value => typeof value === 'string' ? value : value?.text || '').filter(Boolean).join('\n\n');
export function reasoningText(item) {
  const summary = textParts(item.summary), content = textParts(item.content);
  const streamedSummary = textParts(item.streamedSummaryParts) || item.streamedReasoning || '';
  const streamedContent = textParts(item.streamedContentParts) || item.streamedReasoningContent || '';
  const preferComplete = (complete, stream) => complete && !(stream.startsWith(complete) && stream.length > complete.length) ? complete : stream || complete;
  const parts = [preferComplete(summary, streamedSummary), preferComplete(content, streamedContent)].filter(Boolean);
  return [...new Set(parts)].join('\n\n');
}
export function mediaUrl(value, threadId) {
  if (typeof value !== 'string' || !value) return '';
  if (/^https?:\/\//i.test(value) || /^\/api\//.test(value) || /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value;
  if (!threadId || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return '';
  return `/api/threads/${encodeURIComponent(threadId)}/media?path=${encodeURIComponent(value.replace(/^\.\//, ''))}`;
}
export function toolContent(item) {
  let content = item.result?.content;
  if (item.type === 'dynamicToolCall') content = item.contentItems;
  if (item.type === 'functionCallOutput') content = typeof item.output === 'string' ? [{ type: 'text', text: item.output }] : item.output;
  return Array.isArray(content) ? content.filter(block => block && typeof block === 'object') : [];
}
export function contentImage(block) {
  if (block?.type === 'image' && typeof block.data === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(block.mimeType || '')) return `data:${block.mimeType};base64,${block.data}`;
  return ['inputImage', 'input_image', 'image'].includes(block?.type) ? block.imageUrl || block.image_url || block.url || '' : '';
}
