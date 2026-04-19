---
name: halofire-field
description: (Not yet implemented) Take install photos + as-built notes → produce a deviation report against the approved Design.
inputs: [Design, list[Photo + geo + note]]
outputs: [DeviationReport]
model: sonnet (vision) + deterministic matcher
budget_seconds: 60 per photo batch
---

# Field Agent (scoped, not implemented)

## Status

**Scoped only.** No `agent.py` module yet. Ships in a post-Beta
release when Halo has the install-phase capture workflow in place.

## Purpose

Compare the as-built system (photos + GPS + installer notes) against
the approved Design and flag deviations the AHJ review needs.

## Intended workflow

1. Installer takes tagged photos on iPad / phone during install
2. Upload batch to `/field/upload`
3. Claude Vision classifies each photo: head / pipe / fitting /
   valve / hanger / obstruction
4. Position estimated from EXIF + installer note + building GPS
5. Matched against nearest Design entity
6. Deviations > tolerance (10 cm lateral, 5° rotation, SKU
   mismatch) reported

## Schema (planned)

```
DeviationReport = {
  project_id: str,
  captured_at: ISO date,
  summary: {n_matches, n_deviations, n_unmatched},
  items: [Deviation],
}

Deviation = {
  design_entity_id: str | None,   # None = extra as-built piece
  photo_id: str,
  severity: "info" | "warning" | "error",
  kind: "position" | "sku" | "missing" | "extra" | "unknown",
  detail: str,
}
```

## Not in this plan

This agent is explicitly **out of scope** for the Internal Alpha →
Beta work. It exists here so the numbering (00–12) stays contiguous
and so Codex can see it's intentional, not forgotten.
