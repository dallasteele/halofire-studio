/// <reference types="vite/client" />

// Vite `?url` asset imports resolve to a string URL at build time. The pdfjs
// worker bundle is imported this way so it can be handed to GlobalWorkerOptions.
declare module '*?url' {
  const src: string;
  export default src;
}
