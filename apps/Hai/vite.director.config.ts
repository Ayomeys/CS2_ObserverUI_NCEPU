import { fileURLToPath, URL } from 'node:url'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { mergeConfig } from 'vite'
import overlayConfig from './vite.config.ts'

const directorOut = fileURLToPath(new URL('../Zhen/resources/director-map/', import.meta.url))

export default mergeConfig(overlayConfig, {
  base: './',
  publicDir: false,
  plugins: [
    {
      name: 'director-map-equipment-icons',
      async closeBundle() {
        const equipmentOut = join(directorOut, 'equipment')
        await mkdir(equipmentOut, { recursive: true })
        for (const file of ['c4.svg', 'defuser.svg']) {
          await copyFile(
            fileURLToPath(new URL(`./public/equipment/${file}`, import.meta.url)),
            join(equipmentOut, file),
          )
        }
      },
    },
  ],
  build: {
    outDir: directorOut,
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./director.html', import.meta.url)),
    },
  },
})
