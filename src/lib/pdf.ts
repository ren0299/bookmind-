import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorker

let pdfOperation: Promise<void> = Promise.resolve()

export function withPdfLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = pdfOperation.then(fn, fn)
  pdfOperation = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** PDF.js 需要 wasmUrl 才能解码 JBIG2/JPEG2000 等图像（v5+ 必填） */
function getPdfWasmUrl(): string {
  return new URL('wasm/', window.location.href).href
}

export async function loadPdfDocument(
  data: Uint8Array,
): Promise<{ doc: PDFDocumentProxy; task: PDFDocumentLoadingTask }> {
  const task = getDocument({
    data: data.slice(),
    wasmUrl: getPdfWasmUrl(),
    useWorkerFetch: true,
    useSystemFonts: true,
  })
  const doc = await task.promise
  return { doc, task }
}

/**
 * 释放 PDF 文档。已加载完成的文档只用 doc.cleanup()；
 * 切勿对已完成加载的 task 调用 destroy()，否则会销毁全局 Worker，导致无法渲染。
 */
export async function releasePdfDocument(
  doc: PDFDocumentProxy | null,
  task: PDFDocumentLoadingTask | null,
): Promise<void> {
  if (doc) {
    await doc.cleanup().catch(() => {})
    return
  }

  if (task) {
    await task.destroy().catch(() => {})
  }
}

/** 默认 100% 显示；仅当页面宽于容器时缩小以适应窗口 */
export const DEFAULT_ZOOM = 1
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4

export function calcFitWidthScale(
  pageWidth: number,
  containerWidth: number,
  zoomLevel: number = DEFAULT_ZOOM,
): number {
  const fitWidthScale = containerWidth / pageWidth

  if (zoomLevel === DEFAULT_ZOOM) {
    return Math.min(DEFAULT_ZOOM, fitWidthScale)
  }

  return zoomLevel
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}
