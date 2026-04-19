# @halofire/takeoff

Browser-side client for the halopenclaw gateway's PDF takeoff pipeline.

Upload architect PDFs, get back structured walls + rooms + openings for
feeding into Pascal's node tree.

## Pipeline layers (all run server-side in halopenclaw-gateway)

1. **pdfplumber** — vector line extraction (free, deterministic)
2. **opencv Hough** — raster line detection (free, fallback)
3. **CubiCasa5k** — pretrained ML floor-plan segmentation (free, self-hosted)
4. **Claude Vision** — semantic labeling + ambiguity resolution (cheap, OAuth)

See `HALOFIRE_TECHNICAL_PLAN.md` at repo root for the full architecture.

## Usage

```ts
import { uploadPdfForTakeoff, pollTakeoffJob } from '@halofire/takeoff'

const { jobId } = await uploadPdfForTakeoff({
  pdfBytes: arrayBuffer,
  projectId: 'bid-1881',
})

for await (const update of pollTakeoffJob(jobId)) {
  if (update.status === 'succeeded') {
    console.log('Extracted:', update.walls.length, 'walls')
    break
  }
}
```

## Status

Phase M1 scaffold. The TypeScript client is ready; it awaits the
Python gateway's endpoints (`/takeoff/upload`, `/takeoff/status/:jobId`,
`/takeoff/stream/:jobId`) to come online at `services/halopenclaw-gateway`.
