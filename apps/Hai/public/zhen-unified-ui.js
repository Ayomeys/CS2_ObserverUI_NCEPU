(() => {
  'use strict'

  if (window.__ZHEN_UNIFIED_UI__) return
  window.__ZHEN_UNIFIED_UI__ = true

  const MAX_ITEMS = 5
  const ITEM_LIFETIME = 6000
  const CUSTOM_KILLFEED_ENABLED = false
  const C4_TIMER_SECONDS = 40
  const C4_CLOCK_STORAGE_KEY = 'zhen:c4-clock'
  const DEFUSE_KIT_SECONDS = 5
  const DEFUSE_NO_KIT_SECONDS = 10
  const TIMEOUT_FALLBACK_SECONDS = 30
  const TIMEOUT_PANEL_MS = 700
  const TIMEOUT_TEXT_DELAY_MS = 500
  const TIMEOUT_TEXT_MS = 220
  const TIMEOUT_RING_RADIUS = 25
  const TIMEOUT_RING_CIRCUMFERENCE = 2 * Math.PI * TIMEOUT_RING_RADIUS
  const playerSnapshot = new Map()
  const itemTimers = new Map()
  const recentKills = new Map()
  let itemId = 0
  let currentMap = ''
  let killfeedEnabled = false
  let c4EndTime = 0
  let c4TimerActive = false
  let c4ClockInitialized = false
  let c4RoundKey = ''
  let defuseEndTime = 0
  let defuseMaxSeconds = DEFUSE_KIT_SECONDS
  let defuseTimerActive = false
  let c4FrameId = null
  let latestGsi = null
  let tacticalTimeoutSide = null
  let tacticalTimeoutMaxSeconds = TIMEOUT_FALLBACK_SECONDS
  let tacticalTimeoutEndTime = 0
  let tacticalTimeoutFrameId = null
  let tacticalTimeoutHideTimer = null
  let tacticalTimeoutEventLatched = false
  let tacticalTimeoutEventTeam = null
  let technicalPauseLatched = false

  function sideOf(player) {
    return String(player && player.team && player.team.side || '').toLowerCase()
  }

  function normalizeWeapon(value) {
    return String(value || 'knife').replace(/^weapon_/, '')
  }

  function activeWeapon(player) {
    if (!player) return 'knife'
    const weapon = player.primaryweapon || player.secondaryweapon || player.knifeweapon
    return normalizeWeapon(weapon && weapon.name)
  }

  function ensureFocusedSponsor() {
    const root = document.querySelector('.Focused__Player')
    if (!root) return null
    let sponsor = root.querySelector(':scope > .focused-player-sponsor')
    if (!sponsor) {
      sponsor = document.createElement('div')
      sponsor.className = 'focused-player-sponsor'
      sponsor.setAttribute('aria-hidden', 'true')
      const image = document.createElement('img')
      image.src = './assets/ncepu-major.png'
      image.alt = ''
      sponsor.appendChild(image)
      root.appendChild(sponsor)
    }
    return sponsor
  }

  function ensureBpBrandLogo() {
    const logoSlot = document.querySelector('.unified-matchbar__logo')
    if (!logoSlot) return null

    const bpVisible = Boolean(document.querySelector('.veto-feed'))
    let brandLogo = logoSlot.querySelector(':scope > .zhen-bp-brand-logo')
    if (!brandLogo) {
      brandLogo = document.createElement('img')
      brandLogo.className = 'zhen-bp-brand-logo'
      brandLogo.src = './assets/ncepu-logo-ui.png'
      brandLogo.alt = ''
      brandLogo.setAttribute('aria-hidden', 'true')
      logoSlot.appendChild(brandLogo)
    }

    brandLogo.classList.toggle('is-visible', bpVisible)
    for (const image of logoSlot.querySelectorAll(':scope > img:not(.zhen-bp-brand-logo)')) {
      image.classList.toggle('zhen-hidden-by-bp-logo', bpVisible)
    }

    return brandLogo
  }

  function timeoutTeamSide(team, gsi) {
    const directSide = String(team && team.side || '').toLowerCase()
    if (directSide === 'ct' || directSide === 't') return directSide

    const map = gsi && gsi.map
    const ct = map && map.team_ct
    const t = map && map.team_t
    if (team && ct && (team.id && team.id === ct.id || team.name && team.name === ct.name)) return 'ct'
    if (team && t && (team.id && team.id === t.id || team.name && team.name === t.name)) return 't'
    return null
  }

  function timeoutPhaseSide(gsi) {
    const countdown = gsi && gsi.phase_countdowns
    const phase = String(countdown && countdown.phase || '').toLowerCase()
    if (phase === 'timeout_ct') return 'ct'
    if (phase === 'timeout_t') return 't'
    return timeoutTeamSide(countdown && countdown.timeout_team, gsi)
  }

  function timeoutTeamName(gsi, side, eventTeam) {
    const map = gsi && gsi.map
    const team = side === 'ct' ? map && map.team_ct : map && map.team_t
    const db = team && team._db
    const eventDb = eventTeam && eventTeam._db
    return String(
      db && (db.teamShortName || db.teamName)
      || eventDb && (eventDb.teamShortName || eventDb.teamName)
      || eventTeam && eventTeam.name
      || team && team.name
      || side.toUpperCase(),
    )
  }

  function timeoutRemainingText(gsi, side, eventTeam, preferEventTeam = false) {
    const map = gsi && gsi.map
    const team = side === 'ct' ? map && map.team_ct : map && map.team_t
    const remainingValue = preferEventTeam && eventTeam
      ? eventTeam.timeouts_remaining
      : team && team.timeouts_remaining != null ? team.timeouts_remaining : eventTeam && eventTeam.timeouts_remaining
    const remaining = remainingValue != null && remainingValue !== '' ? Number(remainingValue) : NaN
    const regularMR = Number(map && map.regularMR) || 12
    // map.round 从 0 开始；第一个加时回合为 2 * regularMR。
    const overtime = Number(map && map.round) >= regularMR * 2
      || Number(map && map.team_ct && map.team_ct.score) >= regularMR
        && Number(map && map.team_t && map.team_t.score) >= regularMR
    const limit = overtime ? 1 : 3
    const count = Number.isInteger(remaining) && remaining >= 0 ? remaining : '—'
    return `TIMEOUTS LEFT ${count}/${limit}`
  }

  function timeoutCharacterTime(index, total, rowDelay = 0) {
    if (total <= 1) return TIMEOUT_TEXT_DELAY_MS + rowDelay
    const progress = index / (total - 1)
    const fastSlowFast = progress - Math.sin(2 * Math.PI * progress) / (2 * Math.PI)
    return TIMEOUT_TEXT_DELAY_MS + rowDelay + fastSlowFast * TIMEOUT_TEXT_MS
  }

  function fillTimeoutText(node, text, rowDelay = 0) {
    node.replaceChildren()
    const characters = Array.from(String(text || ''))
    characters.forEach((character, index) => {
      const span = document.createElement('span')
      span.className = 'zhen-timeout-character'
      span.textContent = character === ' ' ? '\u00a0' : character
      span.style.animationDelay = `${timeoutCharacterTime(index, characters.length, rowDelay)}ms`
      node.appendChild(span)
    })
  }

  function ensureTacticalTimeout(root) {
    const sourceOverlay = root.querySelector(':scope > .zhen-timeout-overlay[data-timeout-source="vue"]')
    if (sourceOverlay) return sourceOverlay

    let overlay = root.querySelector(':scope > .zhen-timeout-overlay[data-timeout-source="runtime"]')
    if (overlay) return overlay

    overlay = document.createElement('div')
    overlay.className = 'zhen-timeout-overlay'
    overlay.dataset.timeoutSource = 'runtime'
    overlay.setAttribute('aria-hidden', 'true')
    overlay.innerHTML = [
      '<div class="zhen-timeout-panel">',
      '<div class="zhen-timeout-copy zhen-timeout-copy--title"></div>',
      '<div class="zhen-timeout-copy zhen-timeout-copy--team"></div>',
      '<div class="zhen-timeout-copy zhen-timeout-copy--remaining"></div>',
      '</div>',
      '<div class="zhen-timeout-clock">',
      '<svg viewBox="0 0 60 60" aria-hidden="true">',
      `<circle class="zhen-timeout-clock__track" cx="30" cy="30" r="${TIMEOUT_RING_RADIUS}"></circle>`,
      `<circle class="zhen-timeout-clock__progress" cx="30" cy="30" r="${TIMEOUT_RING_RADIUS}"></circle>`,
      '</svg>',
      '<span>0</span>',
      '</div>',
    ].join('')

    const progress = overlay.querySelector('.zhen-timeout-clock__progress')
    progress.style.strokeDasharray = String(TIMEOUT_RING_CIRCUMFERENCE)
    progress.style.strokeDashoffset = String(TIMEOUT_RING_CIRCUMFERENCE)
    root.appendChild(overlay)
    return overlay
  }

  function renderTacticalTimeoutFrame() {
    tacticalTimeoutFrameId = null
    if (!tacticalTimeoutSide || tacticalTimeoutSide === 'tech') return

    const root = document.querySelector('.unified-matchbar')
    const overlay = root && ensureTacticalTimeout(root)
    if (!overlay || overlay.dataset.timeoutSource === 'vue') return

    const remaining = Math.max(0, (tacticalTimeoutEndTime - performance.now()) / 1000)
    const percent = tacticalTimeoutMaxSeconds > 0
      ? Math.min(1, remaining / tacticalTimeoutMaxSeconds)
      : 0
    const progress = overlay.querySelector('.zhen-timeout-clock__progress')
    const number = overlay.querySelector('.zhen-timeout-clock > span')
    if (progress) progress.style.strokeDashoffset = String(TIMEOUT_RING_CIRCUMFERENCE * (1 - percent))
    if (number) number.textContent = String(Math.ceil(remaining))
    tacticalTimeoutFrameId = requestAnimationFrame(renderTacticalTimeoutFrame)
  }

  function startTacticalTimeout(gsi, side, seconds, eventTeam = null, preferEventTeam = false) {
    const root = document.querySelector('.unified-matchbar')
    if (!root) return
    const overlay = ensureTacticalTimeout(root)
    if (!overlay || overlay.dataset.timeoutSource === 'vue') return

    if (tacticalTimeoutHideTimer !== null) {
      window.clearTimeout(tacticalTimeoutHideTimer)
      tacticalTimeoutHideTimer = null
    }

    const isNewTimeout = tacticalTimeoutSide !== side || !overlay.classList.contains('is-active')
    if (isNewTimeout) {
      tacticalTimeoutSide = side
      tacticalTimeoutMaxSeconds = seconds > 0 ? seconds : TIMEOUT_FALLBACK_SECONDS
      fillTimeoutText(overlay.querySelector('.zhen-timeout-copy--title'), side === 'tech' ? 'TECHNICAL PAUSE' : 'TAC TIMEOUT')
      fillTimeoutText(overlay.querySelector('.zhen-timeout-copy--team'), side === 'tech' ? '' : timeoutTeamName(gsi, side, eventTeam), TIMEOUT_TEXT_MS)
      overlay.classList.remove('is-active', 'is-leaving', 'is-ct', 'is-t', 'is-tech')
      void overlay.offsetWidth
      overlay.classList.add('is-active', `is-${side}`)
    } else if (seconds > tacticalTimeoutMaxSeconds) {
      tacticalTimeoutMaxSeconds = seconds
    }

    const isTechnical = side === 'tech'
    overlay.querySelector('.zhen-timeout-clock').hidden = isTechnical
    overlay.querySelector('.zhen-timeout-copy--team').hidden = isTechnical
    const counter = overlay.querySelector('.zhen-timeout-copy--remaining')
    counter.hidden = isTechnical
    if (isTechnical) {
      tacticalTimeoutEndTime = 0
      if (tacticalTimeoutFrameId !== null) cancelAnimationFrame(tacticalTimeoutFrameId)
      tacticalTimeoutFrameId = null
      return
    }

    const counterText = timeoutRemainingText(gsi, side, eventTeam, preferEventTeam)
    if (isNewTimeout || counter.dataset.value !== counterText) {
      // 次数必须始终完整可见，不使用默认透明的逐字动画。
      counter.textContent = counterText
      counter.dataset.value = counterText
    }
    if (seconds >= 0) tacticalTimeoutEndTime = performance.now() + seconds * 1000
    if (tacticalTimeoutFrameId === null) tacticalTimeoutFrameId = requestAnimationFrame(renderTacticalTimeoutFrame)
  }

  function stopTacticalTimeout() {
    if (!tacticalTimeoutSide) return
    const overlay = document.querySelector('.unified-matchbar > .zhen-timeout-overlay[data-timeout-source="runtime"]')
    tacticalTimeoutSide = null
    if (tacticalTimeoutFrameId !== null) {
      cancelAnimationFrame(tacticalTimeoutFrameId)
      tacticalTimeoutFrameId = null
    }
    if (!overlay) return

    overlay.classList.remove('is-active')
    overlay.classList.add('is-leaving')
    tacticalTimeoutHideTimer = window.setTimeout(() => {
      overlay.classList.remove('is-leaving', 'is-ct', 'is-t', 'is-tech')
      tacticalTimeoutHideTimer = null
    }, TIMEOUT_PANEL_MS)
  }

  function updateTacticalTimeout(gsi) {
    const phase = String(gsi && gsi.phase_countdowns && gsi.phase_countdowns.phase || '').toLowerCase()
    if (phase === 'paused') {
      technicalPauseLatched = true
      tacticalTimeoutEventLatched = false
      tacticalTimeoutEventTeam = null
      startTacticalTimeout(gsi, 'tech', 0)
      return
    }
    const side = timeoutPhaseSide(gsi)
    if (phase && !side) {
      technicalPauseLatched = false
      tacticalTimeoutEventLatched = false
      tacticalTimeoutEventTeam = null
    }
    if (side) technicalPauseLatched = false
    if (!side) {
      if (tacticalTimeoutEventLatched && tacticalTimeoutSide) {
        const rawSeconds = Number(gsi && gsi.phase_countdowns && gsi.phase_countdowns.phase_ends_in)
        const localSeconds = Math.max(0, (tacticalTimeoutEndTime - performance.now()) / 1000)
        const seconds = Number.isFinite(rawSeconds) && rawSeconds > 0
          ? rawSeconds
          : localSeconds > 0 ? localSeconds : TIMEOUT_FALLBACK_SECONDS
        startTacticalTimeout(gsi, tacticalTimeoutSide, seconds, tacticalTimeoutEventTeam)
        return
      }
      if (technicalPauseLatched && tacticalTimeoutSide === 'tech') {
        startTacticalTimeout(gsi, 'tech', 0)
        return
      }
      stopTacticalTimeout()
      return
    }

    const rawSeconds = Number(gsi && gsi.phase_countdowns && gsi.phase_countdowns.phase_ends_in)
    const seconds = Number.isFinite(rawSeconds) ? Math.max(0, rawSeconds) : TIMEOUT_FALLBACK_SECONDS
    startTacticalTimeout(gsi, side, seconds, tacticalTimeoutEventTeam)
  }

  function startTacticalTimeoutFromEvent(team) {
    const gsi = latestGsi || {}
    const side = timeoutTeamSide(team, gsi)
    if (!side) return

    technicalPauseLatched = false
    tacticalTimeoutEventLatched = true
    tacticalTimeoutEventTeam = team || null
    const rawSeconds = Number(gsi && gsi.phase_countdowns && gsi.phase_countdowns.phase_ends_in)
    const seconds = Number.isFinite(rawSeconds) && rawSeconds > 0
      ? rawSeconds
      : TIMEOUT_FALLBACK_SECONDS
    startTacticalTimeout(gsi, side, seconds, team, true)
  }

  function stopTacticalTimeoutFromEvent() {
    tacticalTimeoutEventLatched = false
    tacticalTimeoutEventTeam = null
    stopTacticalTimeout()
  }

  function startTechnicalPauseFromEvent() {
    technicalPauseLatched = true
    tacticalTimeoutEventLatched = false
    tacticalTimeoutEventTeam = null
    startTacticalTimeout(latestGsi || {}, 'tech', 0)
  }

  function stopTechnicalPauseFromEvent() {
    technicalPauseLatched = false
    if (tacticalTimeoutSide === 'tech') stopTacticalTimeout()
  }

  function ensureC4Timer(root) {
    let timer = root.querySelector('.zhen-c4-countdown')
    if (!timer) {
      timer = document.createElement('div')
      timer.className = 'zhen-c4-countdown'
      timer.setAttribute('aria-label', 'C4 countdown')
      const fill = document.createElement('div')
      fill.className = 'zhen-c4-countdown__fill'
      timer.appendChild(fill)
      root.appendChild(timer)
    }
    return timer
  }

  function ensureDefuseTimer(root) {
    let timer = root.querySelector('.zhen-defuse-countdown')
    if (!timer) {
      timer = document.createElement('div')
      timer.className = 'zhen-defuse-countdown'
      timer.setAttribute('aria-label', 'Defuse countdown')
      const fill = document.createElement('div')
      fill.className = 'zhen-defuse-countdown__fill'
      timer.appendChild(fill)
      root.appendChild(timer)
    }
    return timer
  }

  function scheduleC4Frame() {
    if (c4FrameId === null) c4FrameId = requestAnimationFrame(renderC4Frame)
  }

  function renderC4Frame() {
    c4FrameId = null
    const remaining = c4TimerActive ? Math.max(0, (c4EndTime - performance.now()) / 1000) : 0
    const percent = Math.min(100, Math.max(0, remaining / C4_TIMER_SECONDS * 100))
    const defuseRemaining = defuseTimerActive
      ? Math.max(0, (defuseEndTime - performance.now()) / 1000)
      : 0
    const defusePercent = Math.min(100, Math.max(0, defuseRemaining / defuseMaxSeconds * 100))
    const roots = document.querySelectorAll('.unified-matchbar')

    for (const root of roots) {
      const timer = ensureC4Timer(root)
      const fill = timer.querySelector('.zhen-c4-countdown__fill')
      const defuseTimer = ensureDefuseTimer(root)
      const defuseFill = defuseTimer.querySelector('.zhen-defuse-countdown__fill')
      root.classList.toggle('zhen-c4-active', c4TimerActive)
      root.classList.toggle('zhen-c4-flashing', c4TimerActive && remaining > 0)
      root.classList.toggle('zhen-c4-fast-flash', c4TimerActive && remaining > 0 && remaining <= 10)
      root.classList.toggle('zhen-defuse-active', defuseTimerActive)
      timer.classList.toggle('is-active', c4TimerActive)
      defuseTimer.classList.toggle('is-active', defuseTimerActive)
      timer.setAttribute('aria-valuenow', remaining.toFixed(1))
      defuseTimer.setAttribute('aria-valuenow', defuseRemaining.toFixed(1))
      if (fill) fill.style.width = `${percent}%`
      if (defuseFill) defuseFill.style.width = `${defusePercent}%`
    }

    if ((c4TimerActive && remaining > 0) || (defuseTimerActive && defuseRemaining > 0)) {
      scheduleC4Frame()
    }
  }

  function bombRoundKey(gsi) {
    const map = gsi && gsi.map
    return map && map.name && Number.isFinite(Number(map.round))
      ? `${map.name}:${map.round}`
      : ''
  }

  function saveC4Clock(seconds) {
    if (!c4RoundKey) return
    try {
      window.sessionStorage.setItem(C4_CLOCK_STORAGE_KEY, JSON.stringify({
        round: c4RoundKey,
        deadline: Date.now() + seconds * 1000,
      }))
    } catch (_) {}
  }

  function restoreC4Clock() {
    if (!c4RoundKey) return false
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(C4_CLOCK_STORAGE_KEY) || 'null')
      const remaining = Number(saved && saved.deadline) - Date.now()
      if (saved && saved.round === c4RoundKey && remaining > 0 && remaining <= C4_TIMER_SECONDS * 1000) {
        c4EndTime = performance.now() + remaining
        c4ClockInitialized = true
        return true
      }
    } catch (_) {}
    return false
  }

  function clearC4Clock() {
    c4EndTime = 0
    c4ClockInitialized = false
    try { window.sessionStorage.removeItem(C4_CLOCK_STORAGE_KEY) } catch (_) {}
  }

  function updateC4Timer(gsi) {
    const phase = String(gsi && gsi.phase_countdowns && gsi.phase_countdowns.phase || '')
    const state = String(gsi && gsi.bomb && gsi.bomb.state || '')
    const roundKey = bombRoundKey(gsi)
    if (roundKey !== c4RoundKey) {
      c4EndTime = 0
      c4ClockInitialized = false
      c4RoundKey = roundKey
    }
    const finished = state === 'defused' || state === 'exploded' || phase === 'over'
    const active = !finished && (phase === 'bomb' || phase === 'defuse' || state === 'planted' || state === 'defusing')
    const bombSeconds = Number(gsi && gsi.bomb && gsi.bomb.countdown || 0)
    const phaseSeconds = phase === 'bomb'
      ? Number(gsi && gsi.phase_countdowns && gsi.phase_countdowns.phase_ends_in || 0)
      : 0
    const nextDefuseActive = phase === 'defuse' || state === 'defusing'
    const defuseSeconds = phase === 'defuse'
      ? Number(gsi && gsi.phase_countdowns && gsi.phase_countdowns.phase_ends_in || 0)
      : 0
    const wasDefuseActive = defuseTimerActive

    if (!active) {
      clearC4Clock()
    } else if (!c4ClockInitialized) {
      if (nextDefuseActive) {
        restoreC4Clock()
      } else {
        const seconds = bombSeconds > 0 ? bombSeconds : phaseSeconds
        if (Number.isFinite(seconds) && seconds > 0) {
          c4EndTime = performance.now() + seconds * 1000
          c4ClockInitialized = true
          saveC4Clock(seconds)
        }
      }
    }
    // During defuse, both GSI countdown fields describe the defuse timer.
    // The C4 bar always follows the deadline captured while the bomb was planted.
    c4TimerActive = active && c4ClockInitialized

    defuseTimerActive = nextDefuseActive
    if (!nextDefuseActive) {
      defuseEndTime = 0
      defuseMaxSeconds = DEFUSE_KIT_SECONDS
    } else if (Number.isFinite(defuseSeconds) && defuseSeconds > 0) {
      if (!wasDefuseActive || !defuseEndTime) {
        defuseMaxSeconds = defuseSeconds > DEFUSE_KIT_SECONDS
          ? DEFUSE_NO_KIT_SECONDS
          : DEFUSE_KIT_SECONDS
      }
      const nextDefuseEndTime = performance.now() + defuseSeconds * 1000
      if (!defuseEndTime || Math.abs(nextDefuseEndTime - defuseEndTime) >= 120) {
        defuseEndTime = nextDefuseEndTime
      }
    }

    addMatchHooks()
    renderC4Frame()
    if (c4TimerActive || defuseTimerActive) scheduleC4Frame()
  }

  function vetoTeamLabel(matchInfo, teamId) {
    if (!teamId) return 'Unknown'
    const teamA = matchInfo && matchInfo.teamA
    const teamB = matchInfo && matchInfo.teamB
    const team = teamA && teamA.id === teamId ? teamA : teamB && teamB.id === teamId ? teamB : null
    return team && (team.teamShortName || team.teamName) || String(teamId).slice(0, 6)
  }

  function vetoResult(matchInfo, map) {
    let firstScore = 0
    let secondScore = 0
    let firstTeam = ''
    let secondTeam = ''

    if (map && map.mapVetoType === 'pick') {
      firstScore = Number(map.mapPickTeamScore || 0)
      secondScore = Number(map.mapPickEnemyScore || 0)
      firstTeam = vetoTeamLabel(matchInfo, map.mapPickTeam)
      secondTeam = matchInfo && matchInfo.teamA && map.mapPickTeam === matchInfo.teamA.id
        ? vetoTeamLabel(matchInfo, matchInfo.teamB && matchInfo.teamB.id)
        : vetoTeamLabel(matchInfo, matchInfo.teamA && matchInfo.teamA.id)
    } else {
      firstScore = Number(map && map.mapTeamAScore || 0)
      secondScore = Number(map && map.mapTeamBScore || 0)
      firstTeam = vetoTeamLabel(matchInfo, matchInfo && matchInfo.teamA && matchInfo.teamA.id)
      secondTeam = vetoTeamLabel(matchInfo, matchInfo && matchInfo.teamB && matchInfo.teamB.id)
    }

    const completed = firstScore !== secondScore && (firstScore > 0 || secondScore > 0)
    return {
      completed,
      winner: completed ? (firstScore > secondScore ? firstTeam : secondTeam) : '',
      score: `${firstScore}–${secondScore}`,
    }
  }

  function setNodeText(node, value) {
    if (node && node.textContent !== value) node.textContent = value
  }

  function updateVetoCards(gsi) {
    latestGsi = gsi || latestGsi
    const matchInfo = latestGsi && latestGsi.matchinfo
    const vetoes = matchInfo && Array.isArray(matchInfo.matchVeto)
      ? matchInfo.matchVeto.filter((map) => map.mapVetoType === 'pick' || map.mapVetoType === 'decider')
      : []
    const cards = document.querySelectorAll('.veto-feed .veto-card')

    cards.forEach((card, index) => {
      const map = vetoes[index]
      const result = map ? vetoResult(matchInfo, map) : { completed: false }
      const original = card.children[2]
      let summary = card.querySelector(':scope > .zhen-veto-result')

      card.classList.toggle('zhen-veto-complete', Boolean(result.completed))
      if (!result.completed) {
        if (summary) summary.remove()
        return
      }

      if (original) original.classList.add('zhen-veto-original')
      if (!summary) {
        summary = document.createElement('div')
        summary.className = 'zhen-veto-result'
        summary.innerHTML = '<div class="zhen-veto-result__map"></div><div class="zhen-veto-result__winner"></div><div class="zhen-veto-result__score"></div>'
        card.appendChild(summary)
      }

      const mapName = String(map.mapName || '').replace(/^de_/, '').replace(/_/g, ' ').slice(0, 3).toUpperCase()
      setNodeText(summary.querySelector('.zhen-veto-result__map'), mapName)
      setNodeText(summary.querySelector('.zhen-veto-result__winner'), `WIN ${result.winner}`)
      setNodeText(summary.querySelector('.zhen-veto-result__score'), result.score)
    })
  }

  function ensureKillfeed() {
    if (!document.body) return null
    let feed = document.getElementById('zhen-unified-killfeed')
    if (!CUSTOM_KILLFEED_ENABLED) {
      if (feed) feed.remove()
      return null
    }
    if (!feed) {
      feed = document.createElement('div')
      feed.id = 'zhen-unified-killfeed'
      feed.className = 'zhen-killfeed'
      feed.setAttribute('aria-live', 'polite')
      document.body.appendChild(feed)
    }
    feed.style.display = killfeedEnabled ? 'flex' : 'none'
    return feed
  }

  function removeItem(id) {
    const item = document.querySelector(`[data-zhen-kill-id="${id}"]`)
    if (item) {
      item.classList.add('is-leaving')
      window.setTimeout(() => item.remove(), 180)
    }
    const timer = itemTimers.get(id)
    if (timer) window.clearTimeout(timer)
    itemTimers.delete(id)
  }

  function clearKillfeed() {
    itemTimers.forEach((timer) => window.clearTimeout(timer))
    itemTimers.clear()
    const feed = ensureKillfeed()
    if (feed) feed.replaceChildren()
  }

  function nameNode(player, fallback) {
    const node = document.createElement('span')
    node.className = `zhen-killfeed__name ${sideOf(player)}`
    node.textContent = player && player.name || fallback
    return node
  }

  function iconNode(symbol, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('class', className)
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', `#${symbol}`)
    svg.appendChild(use)
    return svg
  }

  function addKill(kill) {
    if (!killfeedEnabled || !kill || !kill.victim) return
    const killerId = kill.killer && kill.killer.steamid || 'world'
    const victimId = kill.victim.steamid || kill.victim.name || 'unknown'
    const key = `${killerId}:${victimId}`
    const now = Date.now()
    if (now - (recentKills.get(key) || 0) < 1200) return
    recentKills.set(key, now)

    const feed = ensureKillfeed()
    if (!feed) return
    while (feed.children.length >= MAX_ITEMS) {
      const oldest = feed.firstElementChild
      const oldId = Number(oldest && oldest.getAttribute('data-zhen-kill-id'))
      if (oldId) removeItem(oldId)
      else if (oldest) oldest.remove()
      else break
    }

    const id = ++itemId
    const item = document.createElement('div')
    item.className = 'zhen-killfeed__item'
    item.setAttribute('data-zhen-kill-id', String(id))
    item.appendChild(nameNode(kill.killer, 'WORLD'))

    const weapon = normalizeWeapon(kill.weapon)
    const weaponSymbol = document.getElementById(`icon-equipment-${weapon}`)
      ? `icon-equipment-${weapon}`
      : 'icon-equipment-knife'
    item.appendChild(iconNode(weaponSymbol, 'zhen-killfeed__weapon'))

    if (kill.headshot) {
      if (document.getElementById('icon-ui-kill_headshot')) {
        item.appendChild(iconNode('icon-ui-kill_headshot', 'zhen-killfeed__headshot'))
      } else {
        const headshot = document.createElement('span')
        headshot.className = 'zhen-killfeed__headshot-fallback'
        headshot.textContent = '◆'
        item.appendChild(headshot)
      }
    }

    item.appendChild(nameNode(kill.victim, 'UNKNOWN'))
    feed.appendChild(item)
    requestAnimationFrame(() => item.classList.add('is-visible'))
    itemTimers.set(id, window.setTimeout(() => removeItem(id), ITEM_LIFETIME))
  }

  function handleData(gsi) {
    if (!gsi) return
    latestGsi = gsi
    ensureFocusedSponsor()
    updateTacticalTimeout(gsi)
    updateC4Timer(gsi)
    requestAnimationFrame(() => updateVetoCards(gsi))
    if (!Array.isArray(gsi.players)) return
    killfeedEnabled = CUSTOM_KILLFEED_ENABLED && Boolean(gsi.settings && gsi.settings.overlayKillfeedMode)
    const feed = ensureKillfeed()
    if (feed) feed.style.display = killfeedEnabled ? 'flex' : 'none'
    if (!killfeedEnabled) {
      playerSnapshot.clear()
      return
    }

    const mapName = gsi.map && gsi.map.name || ''
    if (currentMap && mapName !== currentMap) clearKillfeed()
    currentMap = mapName

    if (playerSnapshot.size) {
      const victims = gsi.players.filter((player) => {
        const previous = playerSnapshot.get(player.steamid)
        return previous && previous.health > 0 && Number(player.state && player.state.health) <= 0
      })

      for (const killer of gsi.players) {
        const previous = playerSnapshot.get(killer.steamid)
        if (!previous || Number(killer.stats && killer.stats.kills) <= previous.kills) continue
        const victim = victims.find((candidate) => sideOf(candidate) !== sideOf(killer))
        if (!victim) continue
        addKill({
          killer,
          victim,
          weapon: activeWeapon(killer),
          headshot: Number(killer.state && killer.state.round_killshs) > previous.headshots,
        })
      }
    }

    if (gsi.phase_countdowns && gsi.phase_countdowns.phase === 'freezetime') clearKillfeed()
    playerSnapshot.clear()
    for (const player of gsi.players) {
      playerSnapshot.set(player.steamid, {
        kills: Number(player.stats && player.stats.kills || 0),
        health: Number(player.state && player.state.health || 0),
        headshots: Number(player.state && player.state.round_killshs || 0),
      })
    }
  }

  function addMatchHooks() {
    const candidates = document.querySelectorAll('[class*="top-(--hai-safe-y)"][class*="left-1/2"]')
    for (const root of candidates) {
      if (root.children.length < 2) continue
      if (root.classList.contains('unified-matchbar')) {
        ensureC4Timer(root)
        ensureDefuseTimer(root)
        continue
      }
      const meta = root.children[0]
      const score = root.children[1]
      if (!score || score.children.length !== 3) continue

      root.classList.add('unified-matchbar')
      meta.classList.add('unified-matchbar__meta')
      score.classList.add('unified-matchbar__score')
      if (meta.children[0]) meta.children[0].classList.add('unified-matchbar__event')
      if (meta.children[1]) meta.children[1].classList.add('unified-matchbar__logo')
      if (meta.children[2]) meta.children[2].classList.add('unified-matchbar__type')

      for (const index of [0, 2]) {
        const team = score.children[index]
        const panel = team && team.firstElementChild
        if (!team || !panel) continue
        team.classList.add('unified-match-team')
        panel.classList.add('unified-match-team__panel')
        if (panel.children[0]) panel.children[0].classList.add('unified-match-team__logo')
        if (panel.children[1]) panel.children[1].classList.add('unified-match-team__name')
        if (panel.children[2]) panel.children[2].classList.add('unified-match-team__score')
        if (panel.children[3]) panel.children[3].classList.add('unified-match-team__series')
      }
      score.children[1].classList.add('unified-match-round')
      if (score.children[1].children[0]) score.children[1].children[0].classList.add('unified-match-round__time')
      if (score.children[1].children[1]) score.children[1].children[1].classList.add('unified-match-round__label')
      ensureC4Timer(root)
      ensureDefuseTimer(root)
      ensureTacticalTimeout(root)
    }
    ensureFocusedSponsor()
    ensureBpBrandLogo()
    if (latestGsi) updateVetoCards(latestGsi)
  }

  function handleSocketPacket(data) {
    if (typeof data !== 'string') return
    for (const packet of data.split('\x1e')) {
      if (!packet.startsWith('42')) continue
      try {
        const payload = JSON.parse(packet.slice(2))
        if (!Array.isArray(payload)) continue
        if (payload[0] === 'gsi:data') handleData(payload[1])
        if (payload[0] === 'gsi:kill') addKill(payload[1])
        if (payload[0] === 'gsi:timeoutStart') startTacticalTimeoutFromEvent(payload[1])
        if (payload[0] === 'gsi:timeoutEnd') stopTacticalTimeoutFromEvent()
        if (payload[0] === 'gsi:pauseStart') startTechnicalPauseFromEvent()
        if (payload[0] === 'gsi:pauseEnd') stopTechnicalPauseFromEvent()
      } catch (_) {}
    }
  }

  const NativeWebSocket = window.WebSocket
  if (NativeWebSocket) {
    function ObservedWebSocket(...args) {
      const socket = new NativeWebSocket(...args)
      socket.addEventListener('message', (event) => handleSocketPacket(event.data))
      return socket
    }
    ObservedWebSocket.prototype = NativeWebSocket.prototype
    Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket)
    window.WebSocket = ObservedWebSocket
  }

  function start() {
    ensureKillfeed()
    addMatchHooks()
    const observer = new MutationObserver(addMatchHooks)
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
