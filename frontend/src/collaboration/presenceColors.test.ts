import { expect, it } from 'vitest'
import { presenceColors } from './presenceColors'

it('assigns distinct colors even when user hues collide and agrees across peers', () => {
  const ids = [1, 361, 721, 1081],
    colors = presenceColors(ids)
  expect(new Set(colors.values()).size).toBe(ids.length)
  expect([...presenceColors([...ids].reverse())]).toEqual([...colors])
})
it('uses one color for multiple connections of the same user', () => {
  expect([...presenceColors([2, 2, 3])]).toEqual([...presenceColors([3, 2])])
})
