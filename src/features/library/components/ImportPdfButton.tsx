interface ImportPdfButtonProps {
  onClick: () => void
}

export function ImportPdfButton({ onClick }: ImportPdfButtonProps) {
  return (
    <button type="button" className="import-btn" onClick={onClick}>
      Import PDF
    </button>
  )
}
