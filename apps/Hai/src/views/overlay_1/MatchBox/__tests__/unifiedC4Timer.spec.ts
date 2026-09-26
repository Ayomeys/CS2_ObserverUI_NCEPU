import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const script = readFileSync(resolve(process.cwd(), 'public/zhen-unified-ui.js'), 'utf8')

class FakeWebSocket extends EventTarget {
  constructor(_url: string) {
    super()
  }
}

let now = 0
let frames: FrameRequestCallback[] = []

function send(socket: WebSocket, phase: string, state: string, seconds: number): void {
  socket.dispatchEvent(
    new MessageEvent('message', {
      data: `42${JSON.stringify([
        'gsi:data',
        {
          map: { name: 'de_mirage', round: 8 },
          phase_countdowns: { phase, phase_ends_in: seconds },
          bomb: { state, countdown: seconds },
          players: [],
        },
      ])}`,
    }),
  )
}

beforeEach(() => {
  now = 0
  frames = []
  sessionStorage.clear()
  document.body.innerHTML = '<div class="top-(--hai-safe-y) left-1/2 unified-matchbar"><div></div><div></div></div>'
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(Date, 'now').mockImplementation(() => 1_000_000 + now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  window.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  ;(window as unknown as Record<string, unknown>).__ZHEN_UNIFIED_UI__ = false
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('red C4 and blue defuse bars', () => {
  it('keeps the C4 deadline when both GSI countdown fields switch to defuse time', () => {
    new Function(script)()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    const socket = new WebSocket('ws://localhost')

    send(socket, 'bomb', 'planted', 30)
    const red = document.querySelector<HTMLElement>('.zhen-c4-countdown__fill')!
    const blue = document.querySelector<HTMLElement>('.zhen-defuse-countdown__fill')!
    const matchbar = document.querySelector<HTMLElement>('.unified-matchbar')!
    expect(red.style.width).toBe('75%')
    expect(matchbar.classList.contains('zhen-c4-flashing')).toBe(true)
    expect(matchbar.classList.contains('zhen-c4-fast-flash')).toBe(false)

    now = 1000
    send(socket, 'defuse', 'defusing', 5)
    expect(Number.parseFloat(red.style.width)).toBeCloseTo(72.5)
    expect(blue.style.width).toBe('100%')
    expect(matchbar.classList.contains('zhen-c4-fast-flash')).toBe(false)

    now = 2000
    for (const callback of frames.splice(0)) callback(now)
    expect(Number.parseFloat(red.style.width)).toBeCloseTo(70)
    expect(Number.parseFloat(blue.style.width)).toBeCloseTo(80)

    send(socket, 'bomb', 'planted', 4)
    expect(Number.parseFloat(red.style.width)).toBeCloseTo(70)

    now = 21_000
    for (const callback of frames.splice(0)) callback(now)
    expect(matchbar.classList.contains('zhen-c4-fast-flash')).toBe(true)

    send(socket, 'over', 'defused', 0)
    expect(matchbar.classList.contains('zhen-c4-flashing')).toBe(false)
    expect(matchbar.classList.contains('zhen-c4-fast-flash')).toBe(false)
  })

  it('restores the C4 deadline after a browser-source reload during defuse', () => {
    sessionStorage.setItem('zhen:c4-clock', JSON.stringify({
      round: 'de_mirage:8',
      deadline: 1_030_000,
    }))
    new Function(script)()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    const socket = new WebSocket('ws://localhost')

    send(socket, 'defuse', 'defusing', 5)
    const red = document.querySelector<HTMLElement>('.zhen-c4-countdown__fill')!
    const blue = document.querySelector<HTMLElement>('.zhen-defuse-countdown__fill')!
    expect(red.style.width).toBe('75%')
    expect(blue.style.width).toBe('100%')
  })
})
