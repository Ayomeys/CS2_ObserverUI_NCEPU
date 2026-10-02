import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { GameState } from '@zhenhai/csgogsi/types'
import MatchBoxRoundInfo from '../MatchBoxRoundInfo.vue'

vi.mock('@zhenhai/csgogsi/gsi-vue', () => ({ useGsiEvent: vi.fn() }))

function snapshot(round: number, phase = 'live', regularMR = 12, overtimeMR = 3): GameState {
  return {
    map: { round, phase, regularMR, overtimeMR },
    phase_countdowns: { phase: 'freezetime', phase_ends_in: 25 },
  } as GameState
}
function label(gsi: GameState) {
  const wrapper = mount(MatchBoxRoundInfo, { props: { gsi } })
  const text = wrapper.find('.round-label').findAll('div').map(node => node.text()).join(' ')
  wrapper.unmount()
  return text
}

describe('round label', () => {
  it.each([
    [0, 'Round 1/24'], [23, 'Round 24/24'],
    [24, 'Overtime 1/6'], [25, 'Overtime 2/6'], [26, 'Overtime 3/6'],
    [27, 'Overtime 4/6'], [28, 'Overtime 5/6'], [29, 'Overtime 6/6'],
    [30, 'Overtime 1/6'], [35, 'Overtime 6/6'], [36, 'Overtime 1/6'],
  ])('shows the correct period-relative label at map.round=%i', (round, expected) => {
    expect(label(snapshot(round))).toBe(expected)
  })

  it('resets from the sixth overtime round to the first round of the next overtime', async () => {
    const wrapper = mount(MatchBoxRoundInfo, { props: { gsi: snapshot(29) } })
    expect(wrapper.find('.round-counter').text()).toBe('6/6')
    await wrapper.setProps({ gsi: snapshot(30) })
    expect(wrapper.find('.round-counter').text()).toBe('1/6')
    expect(wrapper.find('.round-label').findAll('div')).toHaveLength(2)
    wrapper.unmount()
  })

  it('uses the completed round when the map has ended', () => {
    expect(label(snapshot(30, 'gameover'))).toBe('Overtime 6/6')
  })

  it('respects the regulation and overtime MR values from the snapshot', () => {
    expect(label(snapshot(30, 'live', 15, 3))).toBe('Overtime 1/6')
    expect(label(snapshot(32, 'live', 12, 4))).toBe('Overtime 1/8')
  })
})
