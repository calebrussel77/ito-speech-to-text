import { Button } from '@/app/components/ui/button'
import DiscordIcon from '@/app/components/icons/DiscordIcon'
import XIcon from '@/app/components/icons/XIcon'
import GitHubIcon from '@/app/components/icons/GitHubIcon'
import { Globe, Telephone } from '@mynaui/icons-react'
import { EXTERNAL_LINKS } from '@/lib/constants/external-links'
import ItoIcon from '../../icons/ItoIcon'

interface AboutCardProps {
  icon: React.ReactNode
  title: string
  description: string
  buttonText: string
  onClick: () => void
}

function AboutCard({
  icon,
  title,
  description,
  buttonText,
  onClick,
}: AboutCardProps) {
  return (
    <div className="w-1/3 bg-card rounded-lg border border-border p-4 flex flex-col items-start text-left">
      <div className="w-8 h-8 bg-card rounded-lg flex items-center justify-center mb-3">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-1">{title}</h2>
      <p className="text-muted-foreground mb-6 leading-relaxed">{description}</p>
      <Button
        onClick={onClick}
        variant="outline"
        className="w-fit rounded-full cursor-pointer"
        style={{
          padding: '20px 28px',
        }}
      >
        {buttonText}
      </Button>
    </div>
  )
}

export default function AboutContent() {
  const handleDiscordClick = () => {
    window.open(EXTERNAL_LINKS.DISCORD, '_blank')
  }

  const handleTeamCallClick = () => {
    window.open(EXTERNAL_LINKS.TEAM_CALL, '_blank')
  }

  const handleXClick = () => {
    window.open(EXTERNAL_LINKS.X_TWITTER, '_blank')
  }

  const handleGitHubClick = () => {
    window.open(EXTERNAL_LINKS.GITHUB, '_blank')
  }

  const handleWebsiteClick = () => {
    window.open(EXTERNAL_LINKS.WEBSITE, '_blank')
  }

  return (
    <div className="w-full px-24">
      <div className="mb-8">
        <h1 className="text-2xl font-medium text-foreground">About</h1>
      </div>

      <div className="flex flex-col gap-4">
        {/* First Row: 3 items */}
        <div className="flex flex-row gap-4">
          <AboutCard
            icon={<DiscordIcon width={24} height={24} className="text-foreground" />}
            title="Discord"
            description="Join the community, share feedback, and grow with Ito."
            buttonText="Join Discord"
            onClick={handleDiscordClick}
          />

          <AboutCard
            icon={<Telephone className="w-6 h-6 text-foreground" />}
            title="Team Call"
            description="Got feedback or ideas? Book a quick call with the Ito team."
            buttonText="Book a Call"
            onClick={handleTeamCallClick}
          />

          <AboutCard
            icon={<XIcon width={24} height={24} className="text-foreground" />}
            title="X (Twitter)"
            description="Get updates, tips, and behind-the-scenes insights from the Ito team."
            buttonText="Follow on X"
            onClick={handleXClick}
          />
        </div>

        {/* Second Row: 2 items */}
        <div className="flex flex-row gap-4">
          <AboutCard
            icon={<GitHubIcon width={24} height={24} className="text-foreground" />}
            title="GitHub"
            description="Check out the code, contribute, or star the repo."
            buttonText="View on GitHub"
            onClick={handleGitHubClick}
          />

          <AboutCard
            icon={<Globe className="w-6 h-6 text-foreground" />}
            title="ito.ai"
            description="Learn more about Ito, explore features, and see what's next."
            buttonText="Go to Website"
            onClick={handleWebsiteClick}
          />

          <div className="w-1/3 bg-card rounded-lg border border-border p-4 flex flex-col items-start text-left">
            <div className="bg-card rounded-lg flex items-center justify-center mb-4">
              <ItoIcon
                className="w-6 h-6 text-foreground"
                style={{ height: '24px' }}
              />
              <span className="text-lg font-bold text-foreground ml-2">ito</span>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Version {import.meta.env.VITE_ITO_VERSION}
            </h2>
            <p className="text-muted-foreground mb-6 leading-relaxed">
              Made with 🩷 in San Francisco.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
