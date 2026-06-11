# OpenSCAD — parts-pipeline dependency (installed 2026-06-11)

The `openscad_binary` Settings doc slot and `/api/settings/dependencies`
(`openscadInstalled()` spawns `openscad --version`) are now satisfiable:

| Host | Install | Version | Path |
|------|---------|---------|------|
| GX10 (loop + deploy) | `apt-get install openscad` | 2021.01 | `/usr/bin/openscad` |
| Windows dev box | winget `OpenSCAD.OpenSCAD` | 2021.01 | `C:\Program Files\OpenSCAD\openscad.exe` (added to user PATH) |

## Documentation (canonical sources)
- Downloads: https://openscad.org/downloads.html
- User manual: https://en.wikibooks.org/wiki/OpenSCAD_User_Manual
- Language cheat sheet: https://openscad.org/cheatsheet/
- Headless CLI usage: https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment

## Headless render recipe (the parts pipeline's contract)
```
openscad -o part.stl part.scad          # render to STL (binary)
openscad -o part.png --imgsize 512,512 part.scad   # preview image
```
- Exit code 0 + non-empty STL = render success; assert triangle count > 0.
- Deterministic: same .scad → same mesh (good for golden tests).
- Resolve the binary via env `OPENSCAD_BIN`, falling back to `openscad` on
  PATH, then the well-known Windows path above. Never silently skip a render
  failure — surface it (fail-closed; a proxy body must say it is a proxy).

## Why this matters (PRIORITIES #5 — parts pipeline)
155 catalog parts currently render with 126 nominal-fallback (proxy) bodies.
Parametric .scad emitters (pipe, elbow, tee, coupling, grooved fittings,
head bodies from cut-sheet dims) rendered headlessly to STL shrink that count
with honest `dimensioned parametric` provenance — never claimed
manufacturer-exact.
