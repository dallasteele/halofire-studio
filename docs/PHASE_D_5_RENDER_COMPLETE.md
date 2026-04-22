# Phase D.5 — SCAD → GLB render complete

**Date:** 2026-04-21
**Status:** Done — 192/192 authored SCAD parts rendered to GLB.

## Install method

**Docker (`openscad/openscad:dev`)** — the workstation had no `winget`,
no `choco`, and no native `openscad`. The 2021.01 MSI listed in the
task brief is 404 on `files.openscad.org` (only
`OpenSCAD-2021.01-x86-64-Installer.exe` is still published). Docker
was already installed (v29.2.1) so we pulled the upstream dev image
and wrapped the invocation from the host.

- Image digest: `sha256:0af06bc2aa7a45d18b01a23cfb9dae6dddcd9542611e7be50edea6beb3b52fa7`
- OpenSCAD version: `2026.01.19` (dev branch)

## GLB pipeline caveat

Upstream OpenSCAD — including 2021.01 stable AND the current dev
build — does **not** support `--export-format glb`. Listed output
formats: `stl, off, wrl, amf, 3mf, csg, dxf, svg, pdf, png, echo,
ast, term, nef3, nefdbg, param, pov`. Attempting `-o foo.glb` or
`--export-format glb` produces an error.

Workaround: render to STL inside the container, convert STL → GLB on
the host with `trimesh 4.11.5`. `scripts/render_catalog_glbs.py` was
updated with a `--docker <image>` flag that:

1. `docker run --rm -v <scad>:/scad:ro -v <out>:/out <image>
   openscad -o /out/.<sku>.stl /scad/<sku>.scad`
2. `trimesh.load(stl, force="mesh").export(glb, file_type="glb")`
3. Unlinks the intermediate STL.

Cache and report semantics are unchanged — `.render_cache.json`
still keys on SCAD content hash.

## Results

| Metric | Value |
|---|---|
| Authored SCADs in lane | 204 total (192 after excluding 12 templates) |
| Rendered this phase | 192 |
| Cached (unchanged) | 0 (first full run) |
| Failed | 0 |
| Pre-existing `SM_*.glb` (template pipeline) | 50 |
| **Total GLBs on disk** | **242** |
| Wall-clock (workers=1) | ~334s first pass + retry of 1 timeout = ~9 min |
| GLB size min / median / max | 1636 / 6396 / 84476 bytes |

### Transient failure (resolved on retry)

- `wheatland_sch40_black_2in_21ft.glb` — timed out at 180s on first
  pass (long CGAL op on a 21ft pipe extrusion). Re-ran with
  `--timeout 900`; completed in well under the new budget and
  rendered cleanly (10068 bytes, 256 verts, bounds span 6.4m on Z).
  Cache now reflects the successful render.

## Validation

Spot-checked 5 random non-`SM_*` GLBs with trimesh — all load to
non-degenerate meshes with plausible bounds:

- `viking_vk100_upright_155f.glb` — 6396 B, 158 verts
- `globe_gl5616_pendent_286f.glb` — 6396 B, 158 verts
- `anvil_concentric_reducer_threaded_4x3in.glb` — 4256 B, 96 verts
- `wheatland_sch40_black_2in_21ft.glb` — 10068 B, 256 verts
- `reliable_model_dv_deluge_3in.glb` — 12512 B, 328 verts

Every rendered GLB is > 100 bytes (enforced by the runner's size
guard).

## Reproduce

```bash
cd halofire-studio
python scripts/render_catalog_glbs.py --docker openscad/openscad:dev --workers 1 --timeout 900
```

The runner is idempotent — re-running is a no-op because every SCAD
content hash is now in the cache.

## Lane

- Outputs: `packages/halofire-catalog/assets/glb/*.glb` (committed)
- Runner edit: `scripts/render_catalog_glbs.py` (added `--docker`
  mode + STL→GLB via trimesh)
- Untouched: `.scad` authoring (D.3 lane), `src/*.ts` (D.1 lane)
- `.render_report.json` and `.render_cache.json` remain gitignored.
