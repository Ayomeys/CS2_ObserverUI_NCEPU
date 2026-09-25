import '../assets/main.css'
import './style.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import DirectorMap from './DirectorMap.vue'

createApp(DirectorMap).use(createPinia()).mount('#app')
