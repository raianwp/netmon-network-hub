export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function parseMikrotikUptime(uptime: string) {
  // Usually formats like "1w2d3h4m5s" or similar
  return uptime; // Can be enhanced later if needed
}

export function formatBitsPerSecond(bps: number | null | undefined): string {
  if (bps == null) return "--";
  if (bps < 1000) return `${bps.toFixed(0)} bps`;
  const k = 1000;
  const sizes = ["Kbps", "Mbps", "Gbps"];
  const i = Math.min(Math.floor(Math.log(bps) / Math.log(k)) - 1, sizes.length - 1);
  return `${(bps / Math.pow(k, i + 1)).toFixed(1)} ${sizes[i]}`;
}
