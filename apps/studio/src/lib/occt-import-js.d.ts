// Ambient declaration for occt-import-js (no @types package exists).
// The runtime shape we depend on is fully described by OcctModule in
// step-loader.ts; here we only describe the module's default export.
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
