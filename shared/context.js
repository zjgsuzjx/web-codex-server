export function contextUsage(usage) {
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  const used = valid(usage?.last?.totalTokens), limit = valid(usage?.modelContextWindow);
  return {used,limit,percent:used != null && limit > 0 ? used / limit * 100 : null};
}
