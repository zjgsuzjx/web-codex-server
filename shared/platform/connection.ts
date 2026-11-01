const tiers = [
  { max: 80, level: 4, quality: 'good', label: '极佳' },
  { max: 150, level: 3, quality: 'good', label: '良好' },
  { max: 300, level: 2, quality: 'mid', label: '一般' },
  { max: Infinity, level: 1, quality: 'bad', label: '较差' },
];

export function connectionQuality(latency: number | null | undefined) {
  if (!Number.isFinite(latency) || latency! < 0) return null;
  return tiers.find((tier) => latency! <= tier.max);
}

export function signalLevel(latency: number | null | undefined) {
  return connectionQuality(latency)?.level ?? 0;
}
