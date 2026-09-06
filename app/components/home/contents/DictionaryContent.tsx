import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Pencil, Trash, Plus } from '@mynaui/icons-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../ui/tooltip'
import { Switch } from '../../ui/switch'
import { StatusIndicator } from '../../ui/status-indicator'
import { useDictionaryStore } from '../../../store/useDictionaryStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../ui/dialog'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'

export default function DictionaryContent() {
  const {
    entries,
    loadEntries,
    addEntry,
    addReplacement,
    updateEntry,
    deleteEntry,
  } = useDictionaryStore()
  const [showScrollToTop, setShowScrollToTop] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [editingEntry, setEditingEntry] = useState<{
    id: string
    type: 'normal' | 'replacement'
    content?: string
    from?: string
    to?: string
  } | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newEntryContent, setNewEntryContent] = useState('')
  const [newFrom, setNewFrom] = useState('')
  const [newTo, setNewTo] = useState('')
  const [isReplacement, setIsReplacement] = useState(false)
  const [statusIndicator, setStatusIndicator] = useState<
    'success' | 'error' | null
  >(null)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [successMessage, setSuccessMessage] = useState<string>('')
  const containerRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const editFromRef = useRef<HTMLInputElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const addFromRef = useRef<HTMLInputElement>(null)

  // Reload entries every time the component mounts (e.g., when switching back
  // to the dictionary tab). Mount-only on purpose: `loadEntries` reads the
  // store, it is not an input of this effect.
  useEffect(() => {
    loadEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle scroll events
  useEffect(() => {
    const handleScroll = () => {
      if (containerRef.current) {
        const scrollTop = containerRef.current.scrollTop
        setShowScrollToTop(scrollTop > 200) // Show button after scrolling 200px
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('scroll', handleScroll)
      return () => container.removeEventListener('scroll', handleScroll)
    }

    return undefined
  }, [])

  const scrollToTop = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    }
  }

  const getDisplayText = (entry: (typeof entries)[0]) => {
    if (entry.type === 'replacement') {
      return `${entry.from} → ${entry.to}`
    }
    return entry.content
  }

  const handleEdit = (id: string) => {
    const entry = entries.find(e => e.id === id)
    if (entry) {
      if (entry.type === 'normal') {
        setEditingEntry({ id, type: 'normal', content: entry.content })
        setEditContent(entry.content)
        setEditFrom('')
        setEditTo('')
        // Focus the input after the dialog opens
        setTimeout(() => {
          editInputRef.current?.focus()
        }, 100)
      } else {
        setEditingEntry({
          id,
          type: 'replacement',
          from: entry.from,
          to: entry.to,
        })
        setEditContent('')
        setEditFrom(entry.from)
        setEditTo(entry.to)
        // Focus the first input after the dialog opens
        setTimeout(() => {
          editFromRef.current?.focus()
        }, 100)
      }
    }
  }

  const handleSaveEdit = async () => {
    if (!editingEntry) return

    try {
      if (editingEntry.type === 'normal' && editContent.trim() !== '') {
        await updateEntry(editingEntry.id, {
          type: 'normal',
          content: editContent.trim(),
        } as any)
        setEditingEntry(null)
        setEditContent('')
        setErrorMessage('')
        setSuccessMessage(`"${editContent.trim()}" updated successfully`)
        setStatusIndicator('success')
      } else if (
        editingEntry.type === 'replacement' &&
        editFrom.trim() !== '' &&
        editTo.trim() !== ''
      ) {
        await updateEntry(editingEntry.id, {
          type: 'replacement',
          from: editFrom.trim(),
          to: editTo.trim(),
        } as any)
        setEditingEntry(null)
        setEditFrom('')
        setEditTo('')
        setErrorMessage('')
        setSuccessMessage(
          `"${editFrom.trim()}" → "${editTo.trim()}" updated successfully`,
        )
        setStatusIndicator('success')
      }
    } catch (error: any) {
      console.error('Failed to update dictionary entry:', error)
      const errorMsg = error?.message || 'Failed to update dictionary entry'
      setErrorMessage(errorMsg)
      setStatusIndicator('error')
    }
  }

  const handleCancelEdit = () => {
    setEditingEntry(null)
    setEditContent('')
    setEditFrom('')
    setEditTo('')
  }

  const handleDelete = async (id: string) => {
    const entryToDelete = entries.find(e => e.id === id)
    if (entryToDelete) {
      const deletedItemText = getDisplayText(entryToDelete)
      try {
        await deleteEntry(id)
        setErrorMessage('')
        setSuccessMessage(`"${deletedItemText}" deleted successfully`)
        setStatusIndicator('success')
      } catch (error) {
        console.error('Failed to delete dictionary entry:', error)
        setErrorMessage(`Failed to delete "${deletedItemText}"`)
        setStatusIndicator('error')
      }
    }
  }

  const handleAddNew = () => {
    setShowAddDialog(true)
    setNewEntryContent('')
    setNewFrom('')
    setNewTo('')
    setIsReplacement(false)
    // Focus the input after the dialog opens
    setTimeout(() => {
      addInputRef.current?.focus()
    }, 100)
  }

  const handleSaveNew = async () => {
    try {
      if (isReplacement) {
        if (newFrom.trim() !== '' && newTo.trim() !== '') {
          await addReplacement(newFrom.trim(), newTo.trim())
          setShowAddDialog(false)
          setNewFrom('')
          setNewTo('')
          setErrorMessage('')
          setSuccessMessage(
            `"${newFrom.trim()}" → "${newTo.trim()}" added successfully`,
          )
          setStatusIndicator('success')
        }
      } else {
        if (newEntryContent.trim() !== '') {
          await addEntry(newEntryContent.trim())
          setShowAddDialog(false)
          setNewEntryContent('')
          setErrorMessage('')
          setSuccessMessage(`"${newEntryContent.trim()}" added successfully`)
          setStatusIndicator('success')
        }
      }
    } catch (error: any) {
      console.error('Failed to add dictionary entry:', error)
      const errorMsg = error?.message || 'Failed to add dictionary entry'
      setErrorMessage(errorMsg)
      setStatusIndicator('error')
    }
  }

  const handleCancelNew = () => {
    setShowAddDialog(false)
    setNewEntryContent('')
    setNewFrom('')
    setNewTo('')
    setIsReplacement(false)
  }

  const handleReplacementToggle = (checked: boolean) => {
    setIsReplacement(checked)
    // Focus appropriate input when toggling
    setTimeout(() => {
      if (checked) {
        addFromRef.current?.focus()
      } else {
        addInputRef.current?.focus()
      }
    }, 100)
  }

  // Handle keyboard shortcuts in dialogs
  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveNew()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelNew()
    }
  }

  const noEntries = entries.length === 0

  return (
    <div ref={containerRef} className="w-full relative">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-heading font-semibold tracking-tight text-foreground">
          Dictionary
        </h1>
        <Button onClick={handleAddNew} className="cursor-pointer">
          <Plus className="w-3.5 h-3.5" />
          Add new
        </Button>
      </div>

      <div className="mb-4 h-px w-full bg-border"></div>
      {noEntries && (
        <div className="text-muted-foreground">
          <p className="text-xs text-foreground">No entries yet</p>
          <p className="mt-0.5 text-[11px] text-[var(--subtle-foreground)]">
            Dictionary entries make the transcription more accurate
          </p>
        </div>
      )}
      {!noEntries && (
        <div className="surface-1 overflow-hidden rounded-xl divide-y divide-border">
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className="group flex items-center justify-between gap-4 px-3 py-2 transition-colors duration-150 hover:bg-[var(--surface-2)]"
              onMouseEnter={() => setHoveredRow(index)}
              onMouseLeave={() => setHoveredRow(null)}
            >
              <div className="min-w-0 flex-1 truncate text-xs text-foreground">
                {getDisplayText(entry)}
              </div>

              {/* Action Icons - shown on hover */}
              <div
                className={`flex items-center gap-2 transition-opacity duration-200 ${
                  hoveredRow === index ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleEdit(entry.id)}
                      className="cursor-pointer rounded-md p-1 transition-colors hover:bg-[var(--surface-3)]"
                      aria-label="Edit entry"
                    >
                      <Pencil className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={5}>
                    Edit
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="cursor-pointer rounded-md p-1 transition-colors hover:bg-[var(--destructive-soft)]"
                      aria-label="Delete entry"
                    >
                      <Trash className="w-3.5 h-3.5 text-[var(--muted-foreground)] hover:text-destructive" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={5}>
                    Delete
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Scroll to Top Button */}
      {showScrollToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 bg-primary text-primary-foreground right-8 w-8 h-8 rounded-full shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-200 flex items-center justify-center group z-50 cursor-pointer"
          aria-label="Scroll to top"
        >
          <ArrowUp className="w-4 h-4 font-bold" />
        </button>
      )}

      {/* Status Indicator */}
      <StatusIndicator
        status={statusIndicator}
        onHide={() => {
          setStatusIndicator(null)
          setErrorMessage('')
          setSuccessMessage('')
        }}
        successMessage={successMessage || 'Dictionary entry added successfully'}
        errorMessage={errorMessage || 'Failed to add dictionary entry'}
      />

      {/* Edit Entry Dialog */}
      <Dialog
        open={!!editingEntry}
        onOpenChange={open => !open && handleCancelEdit()}
      >
        <DialogContent
          className="!border-0 shadow-lg p-0"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="sr-only">
              {editingEntry?.type === 'replacement'
                ? 'Edit replacement'
                : 'Edit Dictionary Entry'}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6">
            <h2 className="text-base font-semibold text-foreground mb-3">
              {editingEntry?.type === 'replacement'
                ? 'Edit replacement'
                : 'Edit entry'}
            </h2>

            {editingEntry?.type === 'normal' ? (
              <Input
                ref={editInputRef}
                type="text"
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="w-full p-4"
                placeholder="Enter dictionary entry..."
              />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Input
                    ref={editFromRef}
                    type="text"
                    value={editFrom}
                    onChange={e => setEditFrom(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    className="flex-1 p-4"
                    placeholder="Misspelling"
                  />
                  <span className="text-muted-foreground">→</span>
                  <Input
                    type="text"
                    value={editTo}
                    onChange={e => setEditTo(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    className="flex-1 p-4"
                    placeholder="Correct spelling"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="p-4">
            <Button
              variant="secondary"
              className="cursor-pointer"
              onClick={handleCancelEdit}
            >
              Cancel
            </Button>
            <Button
              className="cursor-pointer"
              onClick={handleSaveEdit}
              disabled={
                editingEntry?.type === 'normal'
                  ? !editContent.trim()
                  : !editFrom.trim() || !editTo.trim()
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add New Entry Dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={open => !open && handleCancelNew()}
      >
        <DialogContent
          className="!border-0 shadow-lg p-0"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="sr-only">Add to vocabulary</DialogTitle>
          </DialogHeader>
          <div className="px-6">
            <h2 className="text-base font-semibold text-foreground mb-3">
              Add to vocabulary
            </h2>

            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-foreground">
                Make it a replacement
              </span>
              <Switch
                checked={isReplacement}
                onCheckedChange={handleReplacementToggle}
              />
            </div>

            {!isReplacement ? (
              <Input
                ref={addInputRef}
                type="text"
                value={newEntryContent}
                onChange={e => setNewEntryContent(e.target.value)}
                onKeyDown={handleAddKeyDown}
                className="w-full p-4"
                placeholder="Enter dictionary entry..."
              />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Input
                    ref={addFromRef}
                    type="text"
                    value={newFrom}
                    onChange={e => setNewFrom(e.target.value)}
                    onKeyDown={handleAddKeyDown}
                    className="flex-1 p-4"
                    placeholder="Misspelling"
                  />
                  <span className="text-muted-foreground">→</span>
                  <Input
                    type="text"
                    value={newTo}
                    onChange={e => setNewTo(e.target.value)}
                    onKeyDown={handleAddKeyDown}
                    className="flex-1 p-4"
                    placeholder="Correct spelling"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="p-4">
            <Button
              variant="secondary"
              className="cursor-pointer"
              onClick={handleCancelNew}
            >
              Cancel
            </Button>
            <Button
              className="cursor-pointer"
              onClick={handleSaveNew}
              disabled={
                isReplacement
                  ? !newFrom.trim() || !newTo.trim()
                  : !newEntryContent.trim()
              }
            >
              Add word
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
