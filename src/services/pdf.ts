export async function readPdfFile(filePath: string): Promise<Uint8Array> {
  const data = await window.bookMind?.readPdf(filePath)
  if (!data) {
    throw new Error('无法读取 PDF 文件')
  }
  return data
}
