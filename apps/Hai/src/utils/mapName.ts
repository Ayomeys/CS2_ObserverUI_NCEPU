/** Match GSI workshop paths to the map keys used by radar and BP assets. */
export function normalizeMapName(name: string): string {
  const basename = name.trim().replace(/\\/g, '/').split('/').pop() ?? ''
  return basename.replace(/\.(?:bsp|vpk)$/i, '').toLowerCase()
}
