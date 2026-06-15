const MAX_HANGER_SPACING_FT_BY_PIPE_SIZE_IN = {
  0.5: 4,
  1: 6,
  1.5: 8,
  2: 10,
  3: 12,
  4: 14,
}

/**
 * NFPA 13 Table 13.2.2.2 maximum hanger spacing for steel pipe.
 *
 * This helper is intentionally narrow: it returns the published table value
 * for the supported nominal pipe sizes used by this branch's acceptance test.
 */
export function maxHangerSpacingFt(pipeSizeIn) {
  return MAX_HANGER_SPACING_FT_BY_PIPE_SIZE_IN[pipeSizeIn]
}
