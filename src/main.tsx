import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { RouterProvider } from './lib/hooks'
import './styles/global.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/pages.css'
import './styles/refine.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>,
)
