import React, { useState } from 'react'
import { useNotesStore } from '../../../../store/useNotesStore'
import { useDictionaryStore } from '../../../../store/useDictionaryStore'
import { useOnboardingStore } from '../../../../store/useOnboardingStore'
import { Button } from '../../../ui/button'
import { Input } from '../../../ui/input'
import { SettingsGroup, SettingsRow, CONTROL_WIDTH } from '../../../ui/settings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../ui/dialog'
import { useAuthStore } from '@/app/store/useAuthStore'
import { useAuth } from '@/app/components/auth/useAuth'

export default function AccountSettingsContent() {
  const { user, setName, clearAuth } = useAuthStore()
  const { logoutUser } = useAuth()
  const { loadNotes } = useNotesStore()
  const { loadEntries } = useDictionaryStore()
  const { resetOnboarding } = useOnboardingStore()

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const handleSignOut = async () => {
    try {
      await logoutUser()
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  const handleDeleteAccount = async () => {
    try {
      // Delete user data from both local and server databases
      // Server now extracts userId from authenticated user's token
      await window.api.deleteUserData()

      // Clear KV-backed app state
      window.electron.store.set('settings', {})
      window.electron.store.set('main', {})
      window.electron.store.set('onboarding', {})
      window.electron.store.set('auth', {})

      // Clear auth state
      clearAuth(false)

      // Reset all stores to their initial state
      resetOnboarding()
      loadNotes()
      loadEntries()

      // Close the dialog
      setShowDeleteDialog(false)

      // Note: The app will automatically navigate to onboarding since user is no longer authenticated
    } catch (error) {
      console.error('Failed to delete account data:', error)
      // Still proceed with local cleanup even if server deletion fails
      // Clear KV-backed app state
      window.electron.store.set('settings', {})
      window.electron.store.set('main', {})
      window.electron.store.set('onboarding', {})
      window.electron.store.set('auth', {})

      // Clear auth state
      clearAuth(false)

      // Reset all stores to their initial state
      resetOnboarding()
      loadNotes()
      loadEntries()

      // Close the dialog
      setShowDeleteDialog(false)
    }
  }

  return (
    <div>
      <SettingsGroup>
        <SettingsRow title="Name" description="How Ito addresses you.">
          <Input
            id="name"
            type="text"
            value={user?.name ?? ''}
            onChange={e => setName(e.target.value)}
            className={CONTROL_WIDTH}
          />
        </SettingsRow>

        {/* L'e-mail vient du fournisseur d'identité : lisible, pas modifiable.
            Il s'affichait dans un div nu, donc invisible quand la valeur était
            vide — il a maintenant le même gabarit qu'un champ désactivé. */}
        <SettingsRow title="Email" description="Tied to your sign-in provider.">
          <div
            className={`${CONTROL_WIDTH} truncate rounded-lg border border-border bg-[var(--surface)] px-2.5 py-1 text-right text-xs text-[var(--muted-foreground)]`}
            title={user?.email ?? undefined}
          >
            {user?.email || '—'}
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* Actions alignées à droite comme tous les autres contrôles — elles
          étaient centrées, seules de tout l'écran à l'être. */}
      <div className="mt-5 flex items-center justify-end gap-2 border-t border-border/70 pt-4">
        <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
          Delete account
        </Button>
        <Button variant="outline" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Delete Account
            </DialogTitle>
            <DialogDescription>
              Are you absolutely sure you want to delete your account? This
              action cannot be undone and will permanently remove:
              <br />
              <br />
              • All your personal information
              <br />
              • All saved notes
              <br />
              • All dictionary entries
              <br />
              • All app settings and preferences
              <br />
              <br />
              This will reset Ito to its initial state.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAccount}>
              Yes, delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
