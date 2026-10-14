export function signalLevel(latency) {
  if (latency === null || latency === undefined) return 0;
  return latency < 150 ? 3 : latency < 500 ? 2 : 1;
}
