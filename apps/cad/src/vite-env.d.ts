/// <reference types="vite/client" />

// Vite `?url` asset imports resolve to a string URL at build time (e.g. the
// pdfjs worker bundle handed to GlobalWorkerOptions in W1).
declare module '*?url' {
  const src: string;
  export default src;
}

// Preview verification handle (see src/lib/cad-window.ts). Kept loosely typed
// here so any module touching `window.__cad` type-checks; the canonical shape
// lives in CadWindowState.
interface Window {
  __cad?: import('./lib/cad-window').CadWindowState;
}
