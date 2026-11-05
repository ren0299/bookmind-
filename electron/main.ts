import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpcHandlers } from './ipc/register.ts'
import { initializeAiAnalysisService, shutdownAiAnalysisService } from './services/ai-analysis-service.ts'

/**
 * ESM 模块没有 Node 内置的 __dirname，需从 import.meta.url 推导。
 * 打包后主进程代码位于 dist-electron/，此处用于解析 preload 与静态资源路径。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

/** 持有主窗口引用，便于在 macOS activate 事件中复用或重建 */
let mainWindow: BrowserWindow | null = null

function registerDevToolsShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return

    if (input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      /**
       * preload 在独立隔离上下文中运行，是将来通过 contextBridge 安全暴露 API 的唯一入口。
       * 路径指向 vite-plugin-electron 构建产物（开发/生产均为 dist-electron/preload.mjs）。
       */
      preload: path.join(__dirname, 'preload.mjs'),
      /** 启用上下文隔离：渲染进程无法直接访问 Node/Electron API，降低 XSS 风险 */
      contextIsolation: true,
      /** 禁用渲染进程 Node 集成：React 页面按普通 Web 应用运行 */
      nodeIntegration: false,
    },
  })

  registerDevToolsShortcuts(mainWindow)

  /**
   * 等内容绘制完成再显示窗口，避免白屏闪烁（常见 Electron 体验优化）。
   */
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  /**
   * vite-plugin-electron 在 dev 模式下注入 VITE_DEV_SERVER_URL，
   * 主进程加载 Vite 开发服务器地址，渲染进程即可获得 HMR。
   */
  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    /**
     * 生产环境加载 Vite 构建产物；路径相对于 dist-electron/main.js 定位到 dist/index.html。
     * vite.config 中 base: './' 确保静态资源使用相对路径，file:// 协议下可正常加载。
     */
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  registerIpcHandlers()
  await initializeAiAnalysisService()
  createWindow()
})

app.on('before-quit', () => shutdownAiAnalysisService())

/**
 * 非 macOS：所有窗口关闭后退出应用（Windows/Linux 常规桌面行为）。
 * macOS 应用通常保持运行，直到用户显式 Cmd+Q 退出。
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/** macOS：Dock 图标被点击且没有窗口时，重新创建主窗口 */
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
