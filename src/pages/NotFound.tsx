import { AppLink } from '../components/ui/Media'
import { useDocumentMeta } from '../lib/hooks'

export function NotFound() {
  useDocumentMeta('Page not found | JIANZHAN', 'The page you were looking for is not here.')

  return (
    <div className="shell not-found-page">
      <p className="eyebrow">404</p>
      <h1 className="display display--lg">This page has left the kiln</h1>
      <p className="body">
        The address does not match anything in the catalogue. Everything currently available lives
        in the collection.
      </p>
      <div className="not-found-page__links">
        <AppLink href="/collection" className="btn btn--outline">
          Collection
        </AppLink>
        <AppLink href="/" className="btn">
          Home
        </AppLink>
      </div>
    </div>
  )
}
