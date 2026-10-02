<script setup lang="ts">
import type { GameState } from '@zhenhai/csgogsi/types'
import SvgIcon from '@/views/components/SvgIcon.vue'
import { computed, onUnmounted, ref } from 'vue'
import { useGsiEvent } from '@zhenhai/csgogsi/gsi-vue'

const props = defineProps<{
  gsi: GameState
}>()

const DEFAULT_REGULATION_MR = 12
const DEFAULT_OVERTIME_MR = 3
const ROUND_PULSE_MS = 240

function secondToTime(totalSeconds: number) {
  totalSeconds = Math.max(0, totalSeconds)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

const formattedTime = computed(() => {
  const countdown = props.gsi?.phase_countdowns
  if (countdown?.phase === 'timeout_ct' || countdown?.phase === 'timeout_t') return 'TAC'
  if (countdown?.phase === 'paused') return 'TECH'
  return secondToTime(countdown?.phase_ends_in ?? 0)
})

const showBombIcon = computed(() => {
  const phase = props.gsi?.phase_countdowns.phase
  const bombState = props.gsi?.bomb?.state
  return bombState !== 'defused' && bombState !== 'exploded' && (phase === 'bomb' || phase === 'defuse')
})

/**
 * map.round 是「已结束回合数」：常规情况 +1，gameover 时保持原值，
 * 与 Zhen 端 DatabaseOverview 的口径保持一致。
 */
const currentRound = computed(() => {
  const map = props.gsi?.map

  if (!map) {
    return 1
  }

  return map.phase === 'gameover' ? map.round : map.round + 1
})

const regulationMR = computed(() => props.gsi?.map?.regularMR ?? DEFAULT_REGULATION_MR)
const overtimeMR = computed(() => props.gsi?.map?.overtimeMR ?? DEFAULT_OVERTIME_MR)

const isOvertime = computed(() => currentRound.value > regulationMR.value * 2)
const overtimeRounds = computed(() => Math.max(1, overtimeMR.value) * 2)

/** 从总回合数推算当前加时段内的回合数，每次加时重新从 1 开始。 */
const displayedRound = computed(() => {
  if (!isOvertime.value) return currentRound.value
  return ((currentRound.value - regulationMR.value * 2 - 1) % overtimeRounds.value) + 1
})
const totalRounds = computed(() => isOvertime.value ? overtimeRounds.value : regulationMR.value * 2)

/**
 * roundStart 只用来触发数字切换动画；数值仍然是上面的派生计算结果，
 * 避免出现两套「当前回合」真源。
 */
const roundPulse = ref(false)
let pulseTimer: number | null = null

useGsiEvent('roundStart', () => {
  roundPulse.value = true

  if (pulseTimer !== null) {
    window.clearTimeout(pulseTimer)
  }

  pulseTimer = window.setTimeout(() => {
    roundPulse.value = false
    pulseTimer = null
  }, ROUND_PULSE_MS)
})

onUnmounted(() => {
  if (pulseTimer !== null) {
    window.clearTimeout(pulseTimer)
    pulseTimer = null
  }
})
</script>

<template>
  <div
    class="flex-1 flex flex-col items-center justify-center bg-pri/70 ring-2 ring-sec/30 rounded-(--hai-radius)"
  >
    <div v-if="!showBombIcon" class="font-semibold text-2xl">
      {{ formattedTime }}
    </div>
    <SvgIcon
      v-else
      size="32px"
      name="icon-ui-bomb_c4"
      custom-class-name="zhen-c4-icon"
      :drop-shadow="false"
    />
    <div
      class="round-label flex flex-row items-center justify-center gap-1 text-sec/60"
      :class="{ 'is-overtime': isOvertime }"
    >
      <div class="font-semibold text-xs">{{ isOvertime ? 'Overtime' : 'Round' }}</div>
      <div
        class="round-counter font-semibold text-xs transition-transform duration-200 ease-out"
        :class="{ 'scale-110': roundPulse }"
      >
        {{ displayedRound }}/{{ totalRounds }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.round-label {
  max-width: calc(100% - 8px);
  white-space: nowrap;
}

.round-label.is-overtime {
  text-transform: none;
}

.round-label.is-overtime > div {
  font-size: 11px;
}

@media (prefers-reduced-motion: reduce) {
  .round-counter {
    transition: none;
  }
}
</style>
