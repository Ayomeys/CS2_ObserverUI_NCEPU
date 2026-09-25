import { afterEach, describe, expect, it } from 'vitest'
import type { Grenade, Player } from '@zhenhai/csgogsi/types'
import map from '../maps/de_mirage'
import {
  extendGrenade,
  parsePlayerPosition,
  parsePosition,
  playersStates,
  resetStates,
} from '../utils'

afterEach(resetStates)

describe('雷达位置', () => {
  it('选手位置使用当前数据包的坐标，不受历史坐标拖慢', () => {
    const older = { steamid: 'p1', position: [0, 0, 0] } as Player
    const current = {
      steamid: 'p1',
      position: [100, 50, 0],
      forward: [0, 1],
      state: { health: 100 },
    } as Player
    playersStates.push([current], [older])

    const [x, y] = parsePlayerPosition(current, map.config)
    expect([x, y]).toEqual(parsePosition(current.position, map.config))
  })

  it('投掷物位置使用当前数据包的坐标', () => {
    const position = [100, 50, 0]
    const grenade = {
      id: 'g1',
      type: 'smoke',
      position,
      effecttime: 0,
    } as Grenade

    const rendered = extendGrenade({ grenade, mapName: 'de_mirage', side: 'CT' })
    expect(rendered?.[0]?.position).toEqual(parsePosition(position, map.config))
  })
})
