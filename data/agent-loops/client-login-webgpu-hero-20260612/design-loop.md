# Halo Fire Secure Login Design Loop

Status: accepted for this slice after reference-gated iteration.

## Reference Gate

References used before the accepted code pass:
- Official brand asset: `apps/autosprink/public/brand/halo-fire-logo-glass.png`.
- Figma reference gate: `https://www.figma.com/design/41Et0LQ9n6YEutm2zknbOX`.
- Creative Production moodboard reference gate with rejected screenshot, generated flame/halo reference, and official logo.
- Apple design references for Liquid Glass-inspired material behavior.
- Codex in-app browser screenshots from the live local page.

## Rejected Passes

Rejected states recorded in the loop:
- Pasted/generated image plane: rejected because it looked like an image pasted over the old scene.
- Procedural beam/flame pass: rejected because it did not read as the Halo Fire flame.
- Shader/ribbon pass: rejected because it still read as abstract VFX rather than a brand flame.
- First extruded pass: rejected because it had a double halo, cartoon yellow core, poor logo fidelity, and hidden image dragging.

## Current Pass

The accepted slice uses:
- A single visible secure login page with no fake metrics or internal-alpha copy.
- Official Halo Fire logo in header and login panel, with `draggable="false"`.
- A Three.js canvas with extruded logo-derived flame outline, red flame body, bottom cutout mesh, one halo torus, sparse embers, and material deformation.
- Drag/tug material interaction instead of pointer-driven display rotation.
- Golden-ratio desktop split and Apple Liquid Glass-inspired login panel, input wells, focus ring, and dimensional amber button.

## Reject Criteria

Reject future regressions if any are true:
- The hero reads as a rectangle, image plane, card, bordered panel, or framed box.
- A second halo ring appears.
- The flame becomes generic triangles, blades, a yellow blob, or unrelated VFX.
- Dragging rotates the whole display instead of tugging/stretching the flame.
- Any logo image is selectable/draggable in the hero.
- Any implementation label appears in visible or selectable page text.
- The public page contains fake metrics, dev language, permit/AHJ overclaims, demo credentials, web-scraping/co-development explanation copy, or internal-alpha wording.
- A screenshot artifact is missing, corrupt, or not visually inspected.

## Pass Evidence

- Preview URL shown in Codex in-app browser: `http://localhost:5175/?codexFresh=1781231186866`.
- Screenshot: `apps/autosprink/out/agent-loops/client-login-webgpu-hero-20260612/preview-window-webgpu-red-flame.png`.
- Browser state: `canvasMode=webgpu`, `heroReady=true`, `fallbackOpacity=0`.
- Drag smoke: interaction returned `released` after drag; all logo images remained `draggable=false`.

## Remaining Risk

This is still a procedural/extruded brand flame, not a physically simulated volumetric flame. Do not describe it as a finished cinematic fire simulation. The completed scope is the secure login visual pass with reference-gated Three.js hero and Apple-glass UI.
