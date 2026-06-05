import { createRoot } from 'react-dom/client';
import { App } from './App';
import { cssVariablesBlock } from './lib/tokens';

// Self-hosted variable fonts (no Google-CDN runtime fetch).
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

// Global reset + base typography + focus ring + reduced-motion.
import './styles/tokens.css';

// Inject the :root design-token CSS variables from the single typed source of
// truth (src/lib/tokens.ts), so the CSS never drifts from the tokens.
function installDesignTokens(): void {
  const id = 'hf-design-tokens';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = cssVariablesBlock(':root');
  document.head.appendChild(style);
}

installDesignTokens();

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root element not found');
}

// NOTE: StrictMode is intentionally omitted. React 19's StrictMode double-invoke
// interacts badly with R3F useLoader (the resolved loader promise is discarded on
// the second mount, leaving the Suspense boundary pending forever -> blank parts).
createRoot(root).render(<App />);
