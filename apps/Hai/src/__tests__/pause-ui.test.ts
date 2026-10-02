import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(new NodeURL('../../public/zhen-unified-ui.js', import.meta.url), 'utf8')
const css = readFileSync(new NodeURL('../../public/focused-player-scale.css', import.meta.url), 'utf8')
const pauseCssStart = css.indexOf('/* Tactical timeout:')
const pauseCss = css.slice(pauseCssStart, css.indexOf('.unified-match-team__panel,', pauseCssStart))
let socket: WebSocket
let frames: Map<number, FrameRequestCallback>
let nextFrame: number

class MockSocket extends EventTarget {}

function emit(event: string, data?: unknown) {
  socket.dispatchEvent(new MessageEvent('message', { data: '42' + JSON.stringify([event, data]) }))
}
function snapshot(phase: string, remaining: number | undefined = 2, round = 1) {
  return {
    map: {
      name: 'de_mirage', regularMR: 12, round,
      team_ct: { side: 'CT', name: 'CT TEAM', score: round >= 24 ? 12 : 0, timeouts_remaining: remaining },
      team_t: { side: 'T', name: 'team_Ayomeys', score: round >= 24 ? 12 : 1, timeouts_remaining: remaining },
    },
    round: { phase: 'freezetime' },
    phase_countdowns: { phase, phase_ends_in: phase === 'paused' ? 0 : 30 },
  }
}
function overlay() {
  return document.querySelector('.zhen-timeout-overlay') as HTMLElement
}
function counter() {
  return overlay().querySelector('.zhen-timeout-copy--remaining') as HTMLElement
}
function clock() {
  return overlay().querySelector('.zhen-timeout-clock') as HTMLElement
}
function flushFrames() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach(callback => callback(0))
}

beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  nextFrame = 0
  Reflect.deleteProperty(window, '__ZHEN_UNIFIED_UI__')
  document.body.innerHTML = '<div class="unified-matchbar"></div>'
  const style = document.createElement('style')
  style.textContent = pauseCss
  style.id = 'pause-test-style'
  document.head.appendChild(style)
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('WebSocket', MockSocket)
  new Function(source)()
  socket = new window.WebSocket('ws://pause-test')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.getElementById('pause-test-style')?.remove()
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, '__ZHEN_UNIFIED_UI__')
})

describe('pause UI from Socket.IO packets', () => {
  it('keeps an unlimited technical pause visible without a clock or tactical count', () => {
    emit('gsi:pauseStart')
    expect(overlay().querySelector('.zhen-timeout-copy--title')?.textContent).toBe('TECHNICAL\u00a0PAUSE')
    expect(clock().hidden).toBe(true)
    expect(counter().hidden).toBe(true)
    expect(getComputedStyle(clock()).display).toBe('none')
    expect(getComputedStyle(overlay().querySelector('.zhen-timeout-panel')!).borderColor).toBe('rgb(197, 203, 211)')
    vi.advanceTimersByTime(120000)
    expect(overlay().classList.contains('is-active')).toBe(true)
    expect(frames.size).toBe(0)
    emit('gsi:pauseEnd')
    vi.advanceTimersByTime(700)
    expect(overlay().classList.contains('is-active')).toBe(false)
    expect(overlay().classList.contains('is-leaving')).toBe(false)
  })

  it('restores technical pause on a mid-pause refresh and clears it from the resumed snapshot', () => {
    emit('gsi:data', snapshot('paused'))
    expect(overlay().classList.contains('is-tech')).toBe(true)
    expect(clock().hidden).toBe(true)
    emit('gsi:data', snapshot('freezetime'))
    vi.advanceTimersByTime(700)
    expect(overlay().classList.contains('is-active')).toBe(false)
  })

  it.each([['timeout_t', 'is-t', 'rgb(225, 182, 0)'], ['timeout_ct', 'is-ct', 'rgb(0, 140, 255)']])(
    'shows the requesting side, live countdown and remaining count for %s', (phase, sideClass, color) => {
      emit('gsi:data', snapshot(phase, 3))
      expect(overlay().classList.contains(sideClass)).toBe(true)
      expect(clock().hidden).toBe(false)
      expect(counter().textContent).toBe('TIMEOUTS LEFT 3/3')
      expect(getComputedStyle(overlay().querySelector('.zhen-timeout-panel')!).borderColor).toBe(color)
      flushFrames()
      expect(clock().querySelector('span')?.textContent).toBe('30')
      for (const remaining of [2, 1, 0]) {
        emit('gsi:data', snapshot(phase, remaining))
        expect(counter().textContent).toBe('TIMEOUTS LEFT ' + remaining + '/3')
      }
      const firstCharacter = counter().firstChild
      emit('gsi:data', snapshot(phase, 0))
      expect(counter().firstChild).toBe(firstCharacter)
    },
  )

  it('uses the timeout event count before the new snapshot arrives', () => {
    emit('gsi:data', snapshot('freezetime', 3))
    emit('gsi:timeoutStart', { side: 'T', name: 'team_Ayomeys', timeouts_remaining: 2 })
    expect(counter().textContent).toBe('TIMEOUTS LEFT 2/3')
  })

  it('uses the overtime allowance on first and repeated overtime blocks', () => {
    for (const round of [24, 30, 36]) {
      emit('gsi:data', snapshot('timeout_t', 1, round))
      expect(counter().textContent).toBe('TIMEOUTS LEFT 1/1')
      emit('gsi:data', snapshot('timeout_t', 0, round))
      expect(counter().textContent).toBe('TIMEOUTS LEFT 0/1')
    }
  })

  it('shows the whole remaining-count line immediately and preserves it through rapid packets', () => {
    emit('gsi:data', snapshot('timeout_t', 0, 24))
    const line = counter()
    expect(line.textContent).toBe('TIMEOUTS LEFT 0/1')
    expect(getComputedStyle(line).opacity).toBe('1')
    expect(line.querySelector('.zhen-timeout-character')).toBeNull()
    const textNode = line.firstChild
    for (let i = 0; i < 100; i++) {
      emit('gsi:data', snapshot('timeout_t', 0, 24))
      vi.advanceTimersByTime(10)
      expect(line.textContent).toBe('TIMEOUTS LEFT 0/1')
      expect(line.firstChild).toBe(textNode)
    }
    emit('gsi:data', snapshot('timeout_t', 1, 30))
    expect(line.textContent).toBe('TIMEOUTS LEFT 1/1')
  })

  it('keeps a missing count distinct from zero', () => {
    const data = snapshot('timeout_t')
    delete (data.map.team_t as { timeouts_remaining?: number }).timeouts_remaining
    emit('gsi:data', data)
    expect(counter().textContent).toBe('TIMEOUTS LEFT —/3')
  })

  it('switches between tactical and technical pauses without retaining a hidden clock or stale hide timer', () => {
    emit('gsi:data', snapshot('timeout_t'))
    flushFrames()
    emit('gsi:pauseStart')
    expect(overlay().classList.contains('is-tech')).toBe(true)
    expect(clock().hidden).toBe(true)
    emit('gsi:pauseEnd')
    emit('gsi:data', snapshot('timeout_ct', 1))
    vi.advanceTimersByTime(700)
    expect(overlay().classList.contains('is-ct')).toBe(true)
    expect(overlay().classList.contains('is-active')).toBe(true)
    expect(clock().hidden).toBe(false)
    expect(counter().hidden).toBe(false)
    expect(counter().textContent).toBe('TIMEOUTS LEFT 1/3')
  })
})
