import { initDesktopBridge } from './services/desktopBridge';
import { initClientGuard } from './services/clientGuard';
initDesktopBridge();
const guardState = initClientGuard();
const windowMode =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('window')
    : null;
const isOverlayWindow = windowMode === 'overlay';
const isPerfWindow = windowMode === 'perf';
if (window.estraWindow && !isOverlayWindow && !isPerfWindow) document.documentElement.classList.add('desktop-app');
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import OverlayApp from './components/OverlayApp';
import PerfOverlayApp from './components/PerfOverlayApp';
import './index.css';

if (!guardState.blocked) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {isOverlayWindow ? <OverlayApp desktopWindow /> : isPerfWindow ? <PerfOverlayApp desktopWindow /> : <App />}
    </React.StrictMode>
  );
}
