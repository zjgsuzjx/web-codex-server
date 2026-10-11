const fallbackEfforts = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const labels = { none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: '超高' };

export const modelId = model => model.model || model.id;
export const effortLabel = effort => labels[effort] || effort;
export const effortTone = effort => ['high', 'xhigh', 'max', 'ultra'].includes(effort) ? effort : 'normal';
export function availableModels(models) {
  const seen = new Set();
  return models.filter(model => {
    const id = modelId(model);
    if (!id || model.hidden || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
export function selectedModel(models, id) {
  return id ? models.find(model => modelId(model) === id) : models.find(model => model.isDefault);
}
export function reasoningEfforts(model) {
  if (!Array.isArray(model?.supportedReasoningEfforts)) return fallbackEfforts;
  return [...new Set(model.supportedReasoningEfforts.map(item => typeof item === 'string' ? item : item.reasoningEffort).filter(Boolean))];
}
export function compatibleEffort(model, current) {
  const supported = reasoningEfforts(model);
  if (!supported.length || supported.includes(current)) return current;
  return [model?.defaultReasoningEffort, 'medium'].find(value => supported.includes(value)) || supported[0];
}
