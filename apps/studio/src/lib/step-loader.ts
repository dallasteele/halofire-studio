// In-browser STEP-file loader using occt-import-js (WebAssembly).
//
// PURE except for the injected fetch + the occt-import-js WASM factory. No
// network call happens at module load — the factory is constructed lazily
// inside loadStepGeometry so unit tests can inject a mock factory and so the
// production import is on-demand (avoids loading WASM for users who never
// open a manufacturer-verified part).
//
// HONESTY: this loader only decodes operator-supplied STEP files. It NEVER
// fetches STEP files from manufacturer sites. The caller (PartViewer) only
// hits this path when a record has source==="manufacturer-step" AND a real
// stepUrl — i.e. an operator already supplied the file.

/** Minimal geometry payload consumed by PartViewer. */
export interface StepGeometry {
  positions: Float32Array;
  normals: Float32Array;
  triangleCount: number;
}

/** Shape of one mesh inside the occt-import-js result. */
interface OcctMesh {
  attributes: {
    position: { array: number[] | Float32Array };
    normal?: { array: number[] | Float32Array };
  };
  index?: { array: number[] | Uint32Array };
}

/** Shape of the object returned by occt-import-js ReadStepFile. */
interface OcctResult {
  success: boolean;
  meshes: OcctMesh[];
}

/** The occt-import-js public entrypoint after the WASM module initializes. */
export interface OcctModule {
  ReadStepFile(content: Uint8Array): OcctResult;
}

/**
 * Factory that produces an initialized OcctModule. occt-import-js ships an
 * Emscripten factory function that returns a promise. We accept this shape so
 * tests can pass a mock with the same surface (no real WASM required).
 */
export type OcctFactory = () => Promise<OcctModule>;

/**
 * Lazy default factory. Calls into occt-import-js only when actually invoked.
 * Kept as a function so the module load itself has zero side effects.
 */
async function defaultOcctFactory(): Promise<OcctModule> {
  // Dynamic import so module load does not require the WASM to be present.
  const mod = (await import('occt-import-js')) as unknown as {
    default?: () => Promise<OcctModule>;
  };
  const init = mod.default;
  if (typeof init !== 'function') {
    throw new Error('occt-import-js default export is not a factory function');
  }
  return init();
}

/**
 * Load + decode a STEP file into a flat positions/normals/triangleCount buffer
 * for direct upload into a three.js BufferGeometry. Throws on non-2xx fetch and
 * on parse failure. NO network call at module load.
 */
export async function loadStepGeometry(
  url: string,
  fetchImpl?: typeof fetch,
  occtFactory?: OcctFactory,
): Promise<StepGeometry> {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('loadStepGeometry: empty url');
  }
  const f = fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (typeof f !== 'function') {
    throw new Error('loadStepGeometry: no fetch implementation available');
  }
  const res = await f(url);
  if (!res.ok) {
    throw new Error(
      `loadStepGeometry: HTTP ${res.status} ${res.statusText} for ${url}`.trim(),
    );
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const factory = occtFactory ?? defaultOcctFactory;
  const occt = await factory();
  const result = occt.ReadStepFile(bytes);
  if (!result || !result.success || !Array.isArray(result.meshes) || result.meshes.length === 0) {
    throw new Error('loadStepGeometry: occt-import-js failed to parse STEP file');
  }

  // Concatenate all mesh attribute arrays (occt-import-js returns one mesh per
  // top-level part). triangleCount is derived from the concatenated positions
  // (positions length / 3 vertices / 3 vertices-per-triangle).
  const positionsArrays: Float32Array[] = [];
  const normalsArrays: Float32Array[] = [];
  for (const m of result.meshes) {
    const pos = m.attributes.position.array;
    const nrm = m.attributes.normal?.array;
    positionsArrays.push(pos instanceof Float32Array ? pos : new Float32Array(pos));
    if (nrm) {
      normalsArrays.push(nrm instanceof Float32Array ? nrm : new Float32Array(nrm));
    }
  }
  const positions = concatFloat32(positionsArrays);
  const normals = normalsArrays.length > 0
    ? concatFloat32(normalsArrays)
    : new Float32Array(positions.length);
  const triangleCount = Math.floor(positions.length / 9);
  return { positions, normals, triangleCount };
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
