import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { GameState, Team } from '@zhenhai/csgogsi/types'
import { useGsiEvent, useGsiStore } from '@zhenhai/csgogsi/gsi-vue'
import MatchBoxTeamInfo from '../MatchBoxTeamInfo.vue'

vi.mock('@zhenhai/csgogsi/gsi-vue', () => ({
  useGsiStore: vi.fn(),
  useGsiEvent: vi.fn(),
}))
vi.mock('@/utils/useHaiSettings', () => ({
  useHaiSettings: () => ({ teamAttrs: () => ({}) }),
}))

const team = { side: 'T', name: 'T', score: 0 } as Team
const gsi = reactive({ data: null as GameState | null })
const listeners = new Map<string, (...args: unknown[]) => void>()
let now = 0
let frame: FrameRequestCallback | null = null

function packet(state: 'planted' | 'defusing', countdown: number, phase: 'bomb' | 'defuse'): GameState {
  return {
    bomb: { state, countdown },
    phase_countdowns: { phase, phase_ends_in: countdown },
  } as GameState
}

beforeEach(() => {
  now = 0
  frame = null
  listeners.clear()
  gsi.data = null
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.mocked(useGsiStore).mockReturnValue(gsi as ReturnType<typeof useGsiStore>)
  vi.mocked(useGsiEvent).mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
    listeners.set(event, listener)
  }) as typeof useGsiEvent)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('C4 progress bar', () => {
  it('keeps the planted bomb clock when the defuse countdown becomes five seconds', async () => {
    const wrapper = mount(MatchBoxTeamInfo, {
      props: { team },
      global: { stubs: { TeamAvatar: true } },
    })

    listeners.get('bombPlant')?.()
    gsi.data = packet('planted', 30, 'bomb')
    await nextTick()
    const bar = wrapper.find('.progress-bar').element as HTMLDivElement
    expect(bar.style.width).toBe('75%')

    gsi.data = packet('defusing', 5, 'defuse')
    listeners.get('defuseStart')?.()
    await nextTick()
    expect(bar.style.width).toBe('75%')

    now = 1000
    frame?.(now)
    expect(Number.parseFloat(bar.style.width)).toBeCloseTo(72.5)

    // A briefly stale "planted/bomb" packet must not replace the C4 clock.
    gsi.data = packet('planted', 4, 'bomb')
    await nextTick()
    expect(Number.parseFloat(bar.style.width)).toBeCloseTo(72.5)

    listeners.get('bombPlant')?.()
    expect(Number.parseFloat(bar.style.width)).toBeCloseTo(72.5)

    wrapper.unmount()
  })
})
