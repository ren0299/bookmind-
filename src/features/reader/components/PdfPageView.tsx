import { useEffect, useRef, type RefObject } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { calcFitWidthScale } from '../../../lib/pdf.ts'

interface PdfPageViewProps {
  document: PDFDocumentProxy
  pageNum: number
  zoomLevel: number
  containerRef: RefObject<HTMLDivElement | null>
  onError: (message: string) => void
}

function getViewportWidth(container: HTMLDivElement): number {
  const reader = container.parentElement
  const style = getComputedStyle(container)
  const paddingX =
    parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)

  if (reader) {
    return reader.clientWidth - paddingX
  }

  return container.clientWidth
}

export function PdfPageView({
  document,
  pageNum,
  zoomLevel,
  containerRef,
  onError,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const lastWidthRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let cancelled = false

    async function draw() {
      const containerWidth = getViewportWidth(container!)
      if (containerWidth <= 0) {
        window.requestAnimationFrame(() => {
          if (!cancelled) void draw()
        })
        return
      }

      try {
        const page = await document.getPage(pageNum)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        const scale = calcFitWidthScale(
          baseViewport.width,
          containerWidth,
          zoomLevel,
        )
        const viewport = page.getViewport({ scale })
        const context = canvas!.getContext('2d')
        if (!context || cancelled) return

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel()
          await renderTaskRef.current.promise.catch(() => {})
          renderTaskRef.current = null
        }

        if (cancelled) return

        canvas!.width = viewport.width
        canvas!.height = viewport.height

        const task = page.render({
          canvasContext: context,
          viewport,
          canvas: canvas!,
          intent: 'display',
        })
        renderTaskRef.current = task
        await task.promise

        if (cancelled) return
        renderTaskRef.current = null
        lastWidthRef.current = containerWidth
      } catch (err) {
        if (cancelled) return
        if (err instanceof Error && err.name === 'RenderingCancelledException') {
          return
        }
        onError(err instanceof Error ? err.message : '渲染失败')
      }
    }

    void draw()

    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [document, pageNum, zoomLevel, containerRef, onError])

  useEffect(() => {
    const container = containerRef.current
    const reader = container?.parentElement
    if (!container || !reader) return

    let timer = 0

    const observer = new ResizeObserver(() => {
      const width = getViewportWidth(container)
      if (width <= 0) return
      if (Math.abs(width - lastWidthRef.current) < 2) return

      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        void (async () => {
          try {
            const page = await document.getPage(pageNum)
            const baseViewport = page.getViewport({ scale: 1 })
            const scale = calcFitWidthScale(
              baseViewport.width,
              width,
              zoomLevel,
            )
            const viewport = page.getViewport({ scale })
            const context = canvas.getContext('2d')
            if (!context) return

            renderTaskRef.current?.cancel()
            await renderTaskRef.current?.promise.catch(() => {})

            canvas.width = viewport.width
            canvas.height = viewport.height

            const task = page.render({
              canvasContext: context,
              viewport,
              canvas,
              intent: 'display',
            })
            renderTaskRef.current = task
            await task.promise
            renderTaskRef.current = null
            lastWidthRef.current = width
          } catch {
            // resize 重绘失败时忽略，避免打断正常阅读
          }
        })()
      }, 250)
    })

    observer.observe(reader)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [document, pageNum, zoomLevel, containerRef])

  return <canvas ref={canvasRef} className="reader-canvas" />
}
