/**
 * Raw SVG string for the default HaloFire title block.
 *
 * Kept inline (rather than `import … from './halofire-standard.svg?raw'`)
 * so the renderer works in Next.js, Vite, Node tests, and Tauri without
 * needing a bundler-specific raw-loader plugin. The canonical source is
 * `halofire-standard.svg` — if you edit the SVG, keep this string in
 * sync (or load it with a bundler raw import in a future refactor).
 */
export const HALOFIRE_STANDARD_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 914 610"
     width="914mm" height="610mm"
     font-family="Inter, Helvetica, Arial, sans-serif"
     stroke="#000" fill="#000">

  <rect x="5" y="5" width="904" height="600"
        fill="none" stroke="#000" stroke-width="0.8"/>

  <g id="title-block" transform="translate(729 485)">
    <rect x="0" y="0" width="180" height="120"
          fill="#fff" stroke="#000" stroke-width="0.6"/>

    <rect x="0" y="0" width="180" height="18"
          fill="#0a0a0a" stroke="#000" stroke-width="0.4"/>
    <circle cx="9" cy="9" r="3.2" fill="#e8432d" stroke="none"/>
    <text x="16" y="12"
          font-size="8" font-weight="700"
          fill="#fff" stroke="none"
          letter-spacing="0.6">HALOFIRE STUDIO</text>
    <text x="178" y="12"
          font-size="5" fill="#bbb" stroke="none"
          text-anchor="end">NFPA 13 · FP SUBMITTAL</text>

    <line x1="0"   y1="50"  x2="180" y2="50"  stroke="#000" stroke-width="0.4"/>
    <line x1="0"   y1="75"  x2="180" y2="75"  stroke="#000" stroke-width="0.4"/>
    <line x1="0"   y1="95"  x2="180" y2="95"  stroke="#000" stroke-width="0.4"/>

    <line x1="60"  y1="75"  x2="60"  y2="120" stroke="#000" stroke-width="0.4"/>
    <line x1="120" y1="75"  x2="120" y2="120" stroke="#000" stroke-width="0.4"/>
    <line x1="140" y1="18"  x2="140" y2="50"  stroke="#000" stroke-width="0.4"/>

    <g font-size="3" fill="#666" stroke="none">
      <text x="3"   y="23">PROJECT</text>
      <text x="3"   y="42">ADDRESS</text>
      <text x="143" y="23">REV</text>
      <text x="3"   y="55">SHEET TITLE</text>
      <text x="3"   y="80">DATE</text>
      <text x="63"  y="80">DRAWN BY</text>
      <text x="123" y="80">REVIEWED BY</text>
      <text x="3"   y="100">SHEET NUMBER</text>
    </g>

    <text data-field="project_name"
          x="3" y="32" font-size="6" font-weight="600"
          stroke="none" fill="#000">{{project_name}}</text>

    <text data-field="project_address"
          x="3" y="48" font-size="4" stroke="none" fill="#333">{{project_address}}</text>

    <text data-field="revision"
          x="160" y="34" font-size="7" font-weight="700"
          stroke="none" fill="#000" text-anchor="middle">{{revision}}</text>

    <text data-field="sheet_title"
          x="3" y="68" font-size="5" stroke="none" fill="#000">{{sheet_title}}</text>

    <text data-field="date"
          x="3" y="89" font-size="4" stroke="none" fill="#000">{{date}}</text>

    <text data-field="drawn_by"
          x="63" y="89" font-size="4" stroke="none" fill="#000">{{drawn_by}}</text>

    <text data-field="reviewed_by"
          x="123" y="89" font-size="4" stroke="none" fill="#000">{{reviewed_by}}</text>

    <text data-field="sheet_number"
          x="90" y="113" font-size="10" font-weight="700"
          stroke="none" fill="#000" text-anchor="middle">{{sheet_number}}</text>

    <text data-field="pe_stamp_placeholder"
          x="90" y="118" font-size="2.2" fill="#666" stroke="none"
          text-anchor="middle">{{pe_stamp_placeholder}}</text>
  </g>

  <g data-slot="pe-seal" transform="translate(735 480)">
    <rect x="0" y="0" width="60" height="60"
          fill="none" stroke="#000" stroke-width="0.4"
          stroke-dasharray="2 2"/>
    <text x="30" y="31" font-size="3" fill="#999" stroke="none"
          text-anchor="middle">PE SEAL</text>
  </g>

</svg>`

export const HALOFIRE_STANDARD_TEMPLATE_ID = 'halofire.standard'
export const HALOFIRE_STANDARD_PAPER_MM: readonly [number, number] = [914, 610]
