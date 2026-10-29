import { useEffect, useState } from 'react'
import { FavouritesProvider, useRoute, useReveal } from './lib/hooks'
import { CartProvider } from './lib/cart'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { CartDrawer } from './components/cart/CartDrawer'
import { QuickView } from './components/ui/QuickView'
import { Home } from './pages/Home'
import { Collection } from './pages/Collection'
import { ProductPage } from './pages/ProductPage'
import { Craft } from './pages/Craft'
import { About } from './pages/About'
import { Journal, JournalPost } from './pages/Journal'
import { NotFound } from './pages/NotFound'
import type { Product } from './data/types'

function ScrollToTop() {
  const route = useRoute()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [route.path])
  return null
}

function Routes({ onQuickView }: { onQuickView: (p: Product) => void }) {
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
  return <NotFound />
}

export default function App() {
  const [quickView, setQuickView] = useState<Product | null>(null)

  return (
    <FavouritesProvider>
      <CartProvider>
        <ScrollToTop />
        <Header />
        <main id="main">
          <Routes onQuickView={setQuickView} />
        </main>
        <Footer />
        <QuickView product={quickView} onClose={() => setQuickView(null)} />
        <CartDrawer />
      </CartProvider>
    </FavouritesProvider>
  )
}
