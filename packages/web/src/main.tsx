import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installConsoleCommands } from './scene/celebrate.ts';
import './styles.css';

// `iaia.heraut('push')`, `iaia.feuArtifice()`: play the celebrations by hand (purely visual).
installConsoleCommands();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
