export function builderUrl(repId: string, uci: string[]) {
  return `/rep/${repId}/build${uci.length ? `?m=${uci.join(',')}` : ''}`
}
