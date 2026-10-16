import { CircleHelp } from 'lucide-react'
import { PagePlaceholder } from '../components/PagePlaceholder'

export function NotFoundPage() {
  return (
    <PagePlaceholder
      eyebrow="Page not found"
      title="This destination isn't available"
      description="Choose one of the GreenOps workspace pages from the navigation."
      icon={CircleHelp}
    />
  )
}
