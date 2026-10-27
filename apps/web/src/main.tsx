import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { startOfficeSync } from './lib/store.ts';
import { startTheme } from './lib/prefs.ts';
import './styles.css';

startTheme();
startOfficeSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
