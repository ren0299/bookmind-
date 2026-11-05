/// <reference types="vite-plugin-electron/electron-env" />

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  /**
   * 使用相对路径加载资源。Electron 生产环境通过 file:// 打开 index.html，
   * 若 base 为 '/' 会导致 JS/CSS 绝对路径解析失败。
   */
  base: './',
  plugins: [
    react(),
    /**
     * vite-plugin-electron/simple 在 Vite 生命周期内完成：
     * - 编译 electron/main.ts、electron/preload.ts → dist-electron/
     * - dev 时注入 VITE_DEV_SERVER_URL 并自动启动/重启 Electron
     * 因此 npm run dev 只需一条 vite 命令即可同时跑起 dev server 与桌面窗口。
     */
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
