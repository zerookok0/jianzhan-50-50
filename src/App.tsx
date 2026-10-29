import { useEffect, useState } from 'react'
import { FavouritesProvider, useRoute, useReveal } from './lib/hooks'
import { CartProvider } from './lib/cart'
import { CatalogueProvider } from './lib/catalogue'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { CartDrawer } from './components/layout/CartDrawer'
import { QuickView } from './components/ui/QuickView'
import { Home } from './pages/Home'
import { Collection } from './pages/Collection'
import { ProductPage } from './pages/ProductPage'
import { Craft } from './pages/Craft'
import { About } from './pages/About'
import { Journal, JournalPost } from './pages/Journal'
import { Checkout } from './pages/Checkout'
import { OrderConfirmation } from './pages/OrderConfirmation'
import { MockPayment } from './pages/MockPayment'
import { Diagnostics } from './pages/Diagnostics'
import { NotFound } from './pages/NotFound'
import type { CatalogueProduct } from './lib/catalogue'

function ScrollToTop() {
  const route = useRoute()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [route.path])
  return null
}

function Routes({ onQuickView }: { onQuickView: (p: CatalogueProduct) => void }) {
  const { path } = useRoute()
  useReveal([path])

  const segments = path.split('/').filter(Boolean)

  if (path === '/') return <Home onQuickView={onQuickView} />
  if (path === '/collection') return <Collection onQuickView={onQuickView} />
  if (segments[0] === 'collection' && segments[1]) {
    return <ProductPage slug={segments[1]} onQuickView={onQuickView} />
  }
  if (path === '/craft') return <Craft />
  if (path === '/about') return <About />
  if (path === '/journal') return <Journal />
  if (segments[0] === 'journal' && segments[1]) return <JournalPost slug={segments[1]} />
  if (path === '/checkout') return <Checkout />

  // Order confirmation. The reference is unguessable and is the only
  // credential this page accepts; it re-reads state from the server.
  if (segments[0] === 'order' && segments[1]) {
    return <OrderConfirmation reference={decodeURIComponent(segments[1])} />
  }

  // Test gateway page. It refuses to function unless the Worker reports
  // itself as `development`, so shipping it costs nothing but a 404.
  if (path === '/mock-payment') return <MockPayment />

  if (path === '/diagnostics') return <Diagnostics />
  return <NotFound />
}

export default function App() {
  const [quickView, setQuickView] = useState<CatalogueProduct | null>(null)

  return (
    <FavouritesProvider>
      <CatalogueProvider>
        <CartProvider>
          <ScrollToTop />
          <Header />
          <main id="main">
            <Routes onQuickView={setQuickView} />
          </main>
          <Footer />
          <CartDrawer />
          <QuickView product={quickView} onClose={() => setQuickView(null)} />
        </CartProvider>
      </CatalogueProvider>
    </FavouritesProvider>
  )
}
