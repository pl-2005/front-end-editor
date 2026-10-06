/** Resolve repeated profile colors by assigning a distinct hue per visible user.
 * The same user's tabs share a color; sorted IDs make every peer agree. */
export function presenceColors(userIds: number[]): Map<number, string> {
  const colors = new Map<number, string>(), used = new Set<number>()
  for (const id of [...new Set(userIds)].filter(Number.isSafeInteger).sort((a, b) => a - b)) {
    let hue = ((id % 360) * 137) % 360
    while (used.has(hue)) hue = (hue + 137) % 360
    used.add(hue); colors.set(id, `hsl(${hue} 85% 70%)`)
  }
  return colors
}
