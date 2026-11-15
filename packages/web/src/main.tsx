import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installCelebrationCommands } from './scene/celebrate.ts';
import './styles.css';

// `agentOffice.heraut('push')`, `agentOffice.feuArtifice()`: play the celebrations by hand (docs/commandes-console.md).
installCelebrationCommands(window);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
