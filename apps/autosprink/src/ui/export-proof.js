function toByteView(data, isText) {
  if (isText) return new TextEncoder().encode(String(data ?? ''));
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(0);
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function textPreview(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, 80);
}

export async function summarizeExportArtifact(format, data, opts = {}) {
  const isText = !!opts.text;
  const bytes = toByteView(data, isText);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    format,
    byteLength: bytes.byteLength,
    sha256: toHex(new Uint8Array(digest)),
    registered: Number(opts.registered || 0),
    downloadName: `halofire-cad.${format}`,
    mimeType: isText ? 'text/plain' : 'application/octet-stream',
    preview: isText ? textPreview(data) : null,
  };
}

export function buildExportProofMessage(proof) {
  return `${proof.format.toUpperCase()} proof: ${proof.byteLength.toLocaleString()} bytes · sha256 ${proof.sha256} · shapes ${proof.registered}`;
}
