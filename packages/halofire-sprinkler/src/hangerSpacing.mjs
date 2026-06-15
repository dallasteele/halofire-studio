const MAX_HANGER_SPACING_FT = Object.freeze({
  1: 10,
  1.25: 12,
  1.5: 14,
  2: 16,
  2.5: 18,
  3: 20,
  4: 24,
  6: 30,
})

export function maxHangerSpacingFt(pipeSizeIn) {
  return MAX_HANGER_SPACING_FT[pipeSizeIn] ?? 0
}
