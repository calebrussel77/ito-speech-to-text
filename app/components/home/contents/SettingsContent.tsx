import {
  CogFour,
  Keyboard,
  Microphone,
  UserCircle,
  Code,
} from '@mynaui/icons-react'
import { useMainStore } from '@/app/store/useMainStore'
import { PillTabs, type PillTabItem } from '../../ui/pill-tabs'
import GeneralSettingsContent from './settings/GeneralSettingsContent'
import AudioSettingsContent from './settings/AudioSettingsContent'
import AccountSettingsContent from './settings/AccountSettingsContent'
import KeyboardSettingsContent from './settings/KeyboardSettingsContent'
import AdvancedSettingsContent from './settings/AdvancedSettingsContent'
import PricingBillingSettingsContent from './settings/PricingBillingSettingsContent'

type SettingsPage =
  | 'general'
  | 'keyboard'
  | 'audio'
  | 'account'
  | 'advanced'

const TABS: PillTabItem<SettingsPage>[] = [
  { id: 'general', label: 'General', icon: CogFour },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'audio', label: 'Audio & Mic', icon: Microphone },
  { id: 'account', label: 'Account', icon: UserCircle },
  { id: 'advanced', label: 'Advanced', icon: Code },
]

export default function SettingsContent() {
  const { settingsPage, setSettingsPage } = useMainStore()

  const renderSettingsContent = () => {
    switch (settingsPage) {
      case 'general':
        return <GeneralSettingsContent />
      case 'keyboard':
        return <KeyboardSettingsContent />
      case 'audio':
        return <AudioSettingsContent />
      case 'pricing-billing':
        return <PricingBillingSettingsContent />
      case 'account':
        return <AccountSettingsContent />
      case 'advanced':
        return <AdvancedSettingsContent />
      default:
        return <GeneralSettingsContent />
    }
  }

  return (
    <div className="w-full">
      <div className="flex justify-center">
        <PillTabs
          items={TABS}
          value={settingsPage as SettingsPage}
          onChange={setSettingsPage}
        />
      </div>

      {/* Colonne bornée : sans plafond, le libellé colle à gauche et le
          contrôle part à droite du panneau, et l'œil ne les relie plus. */}
      <div className="mx-auto w-full max-w-[560px] pt-6">
        {renderSettingsContent()}
      </div>
    </div>
  )
}
