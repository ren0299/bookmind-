import { AppLayout } from './components/layout/AppLayout.tsx'
import { MainContent } from './components/layout/MainContent.tsx'
import { Sidebar } from './components/layout/Sidebar.tsx'
import { useLibrary } from './features/library/hooks/useLibrary.ts'
import './styles/app.css'
import { useCallback, useState } from 'react'
import { NovelDownloader } from './features/novel/components/NovelDownloader.tsx'
import { AIWorkbench } from './features/ai/AIWorkbench.tsx'

function App() {
  const [showDownloader, setShowDownloader] = useState(false)
  const [showAiWorkbench, setShowAiWorkbench] = useState(false)
  const {
    books,
    selectedBookId,
    selectedBook,
    selectedProgress,
    defaultProgress,
    importPdf,
    importDownloadedNovel,
    selectBook,
    removeBook,
    removeNovelBook,
    handleProgressChange,
  } = useLibrary()

  const handleDownloadedNovel = useCallback(async (taskId: string) => {
    await importDownloadedNovel(taskId)
  }, [importDownloadedNovel])

  return (
    <AppLayout
      sidebar={
        <Sidebar
          books={books}
          selectedBookId={selectedBookId}
          onSelect={selectBook}
          onRemove={removeBook}
          onImport={importPdf}
          showDownloader={showDownloader}
          onShowDownloader={() => {setShowAiWorkbench(false);setShowDownloader((current) => !current)}}
          showAiWorkbench={showAiWorkbench}
          onShowAiWorkbench={() => {setShowDownloader(false);setShowAiWorkbench((current)=>!current)}}
        />
      }
    >
      {showAiWorkbench ? <AIWorkbench books={books} selectedBookId={selectedBookId} onSelectBook={selectBook} /> : showDownloader ? <NovelDownloader onImport={handleDownloadedNovel} onRemoveNovel={removeNovelBook} /> : <MainContent
        selectedBook={selectedBook}
        savedProgress={selectedProgress ?? defaultProgress}
        onProgressChange={handleProgressChange}
        onAnalyze={() => {setShowDownloader(false);setShowAiWorkbench(true)}}
      />}
    </AppLayout>
  )
}

export default App
