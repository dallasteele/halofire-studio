import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root element not found');
}

// NOTE: StrictMode is intentionally omitted. React 19's StrictMode double-invoke
// interacts badly with R3F useLoader (the resolved loader promise is discarded on
// the second mount, leaving the Suspense boundary pending forever -> blank parts).
createRoot(root).render(<App />);
