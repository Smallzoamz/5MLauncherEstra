import { initDesktopBridge } from './services/desktopBridge';
initDesktopBridge();
if (window.estraWindow) document.documentElement.classList.add('desktop-app');
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
