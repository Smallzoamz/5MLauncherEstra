import { initDesktopBridge } from './services/desktopBridge';
import { initClientGuard } from './services/clientGuard';
initDesktopBridge();
const guardState = initClientGuard();
const isOverlayWindow =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('window') === 'overlay';
if (window.estraWindow && !isOverlayWindow) document.documentElement.classList.add('desktop-app');
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import OverlayApp from './components/OverlayApp';
import './index.css';

if (!guardState.blocked) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {isOverlayWindow ? <OverlayApp desktopWindow /> : <App />}
    </React.StrictMode>
  );
}
