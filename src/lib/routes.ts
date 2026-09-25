export function builderUrl(repId: string, uci: string[]) {
  return `/rep/${repId}/build${uci.length ? `?m=${uci.join(',')}` : ''}`
}

export function planUrl(color: 'white' | 'black', path?: string[]) {
  return `/plan/${color}${path?.length ? `?at=${path.join(',')}` : ''}`
}
