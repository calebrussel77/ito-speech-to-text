import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app'

if (window.location.hash === '#/pill') {
  // La pill est une fenêtre transparente sans chrome : les styles globaux de
  // `body` de app.css la casseraient. Elle ne prend que les @font-face.
  import('@/app/styles/pill.css')
} else {
  import('@/app/styles/app.css')
}

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
