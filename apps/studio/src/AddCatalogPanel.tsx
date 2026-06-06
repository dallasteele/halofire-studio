// HaloFire Studio — "Add Catalog" panel (T54).
//
// Two clearly-labelled paths the user asked for:
//   (a) Convert drawing to CAD (SAM) — wires the T48 SAM lane, DISABLED-BY-DEFAULT
//       / fail-closed. With no configured SAM endpoint it shows the honest
//       "SAM endpoint not configured" state and NEVER fabricates geometry.
//   (b) Import / download available models — a client-side STEP file input that
//       renders the chosen .stp/.step via occt-import-js (a PREVIEW), and documents
//       the DURABLE path (drop a folder into manufacturer-incoming/ then run the
//       import script) so real downloaded models register at manufacturer_verified.
//
// HONESTY: a client-side preview is JUST a preview — it is NOT a registered
// manufacturer_verified part until it is staged + sha256'd by the import script.
// The caption states this. Imported manufacturer CAD is licensed, not for
// redistribution.

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { CatalogPartViewer } from './CatalogPartViewer';
import {
  DURABLE_IMPORT_INSTRUCTIONS,
  SAM_NOT_CONFIGURED_MESSAGE,
  samLaneState,
  validateImportFileName,
  type AddCatalogPath,
} from './lib/add-catalog';
import type { SamInvoker } from './lib/sam-floorplan';
import { colors, radii, spacing, typeScale } from './lib/tokens';

export interface AddCatalogPanelProps {
  /**
   * The configured SAM invoker, or undefined when no SAM endpoint is configured
   * (the default — fail-closed). Same gate the building lane uses.
   */
  samInvoker?: SamInvoker;
}

export function AddCatalogPanel({ samInvoker }: AddCatalogPanelProps): ReactElement {
  const [path, setPath] = useState<AddCatalogPath>('import-model');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedName, setImportedName] = useState<string | null>(null);

  const sam = samLaneState(samInvoker);

  // Revoke the blob URL when it changes / on unmount (no leak).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onFile(file: File | null): void {
    setImportError(null);
    const validation = validateImportFileName(file?.name);
    if (!validation.ok) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setImportedName(null);
      setImportError(
        validation.reason === 'no_file'
          ? 'No file chosen.'
          : 'Not a STEP file. Choose a .stp or .step file (real manufacturer CAD).',
      );
      return;
    }
    const url = URL.createObjectURL(file as File);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setImportedName((file as File).name);
  }

  return (
    <section style={wrapStyle} aria-label="Add catalog" data-testid="add-catalog-panel">
      <header style={headerStyle}>
        <h2 style={titleStyle}>Add Catalog</h2>
        <p style={subtitleStyle}>
          Bring real models into the studio. Two paths — pick one.
        </p>
      </header>

      <div role="radiogroup" aria-label="Add catalog path" style={pathGroupStyle}>
        <PathButton
          active={path === 'sam-drawing'}
          label="Convert drawing to CAD (SAM)"
          onClick={() => setPath('sam-drawing')}
        />
        <PathButton
          active={path === 'import-model'}
          label="Import / download available models"
          onClick={() => setPath('import-model')}
        />
      </div>

      {path === 'sam-drawing' ? (
        <div style={cardStyle} data-testid="add-catalog-sam">
          <h3 style={cardTitleStyle}>Convert drawing to CAD (SAM)</h3>
          {sam.available ? (
            <p style={bodyText}>
              SAM endpoint configured. Use the Building mode to segment a scanned /
              raster plan into a footprint (2D mask only — NOT a 3D model, NOT
              vector-exact, NOT AHJ / PE / for-construction).
            </p>
          ) : (
            <div
              role="status"
              style={disabledNoteStyle}
              data-testid="sam-not-configured"
            >
              <strong style={{ color: colors.textPrimary }}>
                SAM endpoint not configured
              </strong>
              <p style={{ ...bodyText, marginTop: spacing[2] }}>
                {SAM_NOT_CONFIGURED_MESSAGE}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div style={cardStyle} data-testid="add-catalog-import">
          <h3 style={cardTitleStyle}>Import / download available models</h3>
          <p style={bodyText}>
            Preview a downloaded manufacturer STEP file in-browser. This is a
            PREVIEW only — it is NOT a registered manufacturer-verified part until
            it is staged by the import script below.
          </p>

          <label style={fileLabelStyle}>
            <input
              type="file"
              accept=".stp,.step"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              style={fileInputStyle}
              data-testid="step-file-input"
            />
          </label>

          {importError ? (
            <p role="alert" style={errorStyle} data-testid="import-error">
              {importError}
            </p>
          ) : null}

          {previewUrl ? (
            <div style={{ marginTop: spacing[3] }} data-testid="import-preview">
              <div style={previewTitleStyle}>{importedName}</div>
              <CatalogPartViewer stepUrl={previewUrl} />
              <p style={captionStyle}>
                Client-side STEP preview (occt-import-js). PREVIEW ONLY — NOT yet a
                registered manufacturer-verified part. Manufacturer CAD is licensed,
                not for redistribution.
              </p>
            </div>
          ) : null}

          <div style={durableStyle}>
            <strong style={{ color: colors.textPrimary }}>
              Register permanently (manufacturer-verified):
            </strong>
            <p style={{ ...bodyText, marginTop: spacing[2] }}>
              {DURABLE_IMPORT_INSTRUCTIONS}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function PathButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      style={{
        ...pathBtnStyle,
        background: active ? colors.interactiveActive : 'transparent',
        color: active ? '#ffffff' : colors.textSecondary,
        fontWeight: active ? 600 : 500,
      }}
    >
      {label}
    </button>
  );
}

/* -------------------------------------------------------------- styles */

const wrapStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[4],
  padding: spacing[5],
  overflowY: 'auto',
  background: colors.bg,
};

const headerStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: spacing[1] };

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: typeScale.lg.size,
  fontWeight: 700,
  color: colors.textPrimary,
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontSize: typeScale.sm.size,
  color: colors.textSecondary,
};

const pathGroupStyle: CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: spacing[0.5],
  background: colors.bgInset,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing[0.5],
  alignSelf: 'flex-start',
};

const pathBtnStyle: CSSProperties = {
  border: 'none',
  borderRadius: radii.md,
  padding: `${spacing[2]} ${spacing[4]}`,
  fontSize: typeScale.sm.size,
  cursor: 'pointer',
};

const cardStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  background: colors.surface,
  padding: spacing[4],
  maxWidth: 640,
};

const cardTitleStyle: CSSProperties = {
  margin: `0 0 ${spacing[2]}`,
  fontSize: typeScale.base.size,
  fontWeight: 700,
  color: colors.textPrimary,
};

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: typeScale.sm.size,
  lineHeight: 1.5,
  color: colors.textSecondary,
};

const disabledNoteStyle: CSSProperties = {
  border: `1px dashed ${colors.border}`,
  borderRadius: radii.md,
  background: colors.bgInset,
  padding: spacing[3],
};

const fileLabelStyle: CSSProperties = { display: 'block', marginTop: spacing[3] };

const fileInputStyle: CSSProperties = {
  fontSize: typeScale.sm.size,
  color: colors.textPrimary,
};

const errorStyle: CSSProperties = {
  marginTop: spacing[2],
  fontSize: typeScale.sm.size,
  color: colors.danger,
};

const previewTitleStyle: CSSProperties = {
  fontSize: typeScale.sm.size,
  fontWeight: 700,
  color: colors.textPrimary,
  marginBottom: spacing[2],
};

const captionStyle: CSSProperties = {
  marginTop: spacing[2],
  fontSize: typeScale.xs.size,
  lineHeight: 1.5,
  color: colors.accentText,
};

const durableStyle: CSSProperties = {
  marginTop: spacing[4],
  paddingTop: spacing[3],
  borderTop: `1px solid ${colors.border}`,
};
