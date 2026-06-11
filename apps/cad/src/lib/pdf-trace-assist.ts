/**
 * PDF wall-suggestion assist (W11B).
 *
 * Pipeline: cluster raw PDF strokes into colinear runs, score the runs as
 * wall candidates, keep the strong ones, convert to feet. The output is a set
 * of OPERATOR-CONFIRMED proposals for the trace tool — suggestions only,
 * never auto-committed walls.
 */
import { clusterColinear, type RawStroke } from './pdf-line-cluster';
import { scoreWallCandidates, type ScoredLine, type WallScore } from './wall-extract-score';

export interface WallSuggestion {
  a: { x: number; y: number };
  b: { x: number; y: number };
  scoreInfo: WallScore;
}

export interface TraceAssistOpts {
  minScore?: number;
}

/** Suggests wall candidates (in feet) from raw PDF linework. */
export function suggestWalls(
  strokes: RawStroke[],
  scaleFtPerPt: number,
  opts?: TraceAssistOpts,
): WallSuggestion[] {
  if (strokes.length === 0) return [];
  const minScore = opts?.minScore ?? 0.6;

  const runs = clusterColinear(strokes);
  if (runs.length === 0) return [];

  // Score in feet so the scorer's length threshold applies to real geometry.
  const linesFt: ScoredLine[] = runs.map((r) => ({
    x1: r.a.x * scaleFtPerPt,
    y1: r.a.y * scaleFtPerPt,
    x2: r.b.x * scaleFtPerPt,
    y2: r.b.y * scaleFtPerPt,
    strokeWidthPt: r.widthPt,
  }));

  return scoreWallCandidates(linesFt)
    .filter((s) => s.score >= minScore)
    .map((s) => ({
      a: { x: linesFt[s.index].x1, y: linesFt[s.index].y1 },
      b: { x: linesFt[s.index].x2, y: linesFt[s.index].y2 },
      scoreInfo: s,
    }));
}
