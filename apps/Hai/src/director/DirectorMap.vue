<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useGsiStore } from '@zhenhai/csgogsi/gsi-vue'
import { LexoRadars } from '../views/overlay_1/LexoRadars'
import { HaiSettings } from '../utils/useHaiSettings'

const gsi = useGsiStore()
const size = ref(420)
const markerScale = 0.39
let removeData: (() => void) | null = null
let removeEvent: (() => void) | null = null

function updateSize(): void {
  size.value = Math.max(320, Math.floor(Math.min(innerWidth, innerHeight) - 48))
}

onMounted(async () => {
  updateSize()
  window.addEventListener('resize', updateSize)
  removeData = window.directorMap.onData((data) => gsi.receiveData(data))
  removeEvent = window.directorMap.onEvent((name, args) => gsi.receiveEvent(name, args))

  const snapshot = await window.directorMap.getSnapshot()
  if (snapshot) gsi.receiveData(snapshot)
})

onUnmounted(() => {
  removeData?.()
  removeEvent?.()
  window.removeEventListener('resize', updateSize)
})
</script>

<template>
  <HaiSettings :settings="gsi.data?.settings">
    <main class="director-map">
      <LexoRadars v-if="gsi.data" :data="gsi.data" :size="size" :marker-scale="markerScale" />
      <p v-else>等待 CS2 比赛数据…</p>
    </main>
  </HaiSettings>
</template>
