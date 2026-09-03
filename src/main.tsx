import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { registerServiceWorker } from '@/services/swUpdates'
import '@/styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// After the render call, not before: registration defers its own work to the
// `load` event anyway, and nothing here should sit between the user and first
// paint.
registerServiceWorker()
