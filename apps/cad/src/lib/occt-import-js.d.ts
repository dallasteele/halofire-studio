// Ambient declaration for occt-import-js (no @types package exists).
// Mirrors apps/studio/src/lib/occt-import-js.d.ts. The runtime shape we depend
// on is fully described by OcctModule in part-geometry.ts; here we only describe
// the module's default export (the Emscripten WASM factory).
declare module 'occt-import-js' {
  type OcctReadStepFile = (content: Uint8Array) => {
    success: boolean;
    meshes: Array<{
      attributes: {
        position: { array: number[] | Float32Array };
        normal?: { array: number[] | Float32Array };
      };
      index?: { array: number[] | Uint32Array };
    }>;
  };
  const init: () => Promise<{ ReadStepFile: OcctReadStepFile }>;
  export default init;
}
