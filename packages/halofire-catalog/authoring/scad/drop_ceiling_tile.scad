// 24" T-bar acoustic drop-ceiling tile + grid frame.
// One tile = 0.6 m × 0.6 m × 0.016 m. Local origin = tile center.
// V2 Phase 4.1.

tile_w_mm = 600;
tile_d_mm = 600;
tile_thick_mm = 16;
tbar_w_mm = 24;     // T-bar grid metal width
tbar_h_mm = 32;     // T-bar grid drop below tile face

// Tile body
translate([0, 0, tile_thick_mm / 2])
    cube(size = [tile_w_mm, tile_d_mm, tile_thick_mm], center = true);

// T-bar grid (4 sides — typical inverted-T profile)
for (axis = [0, 1]) {
    for (sign = [-1, 1]) {
        translate(axis == 0
            ? [sign * (tile_w_mm / 2 - tbar_w_mm / 2), 0, -tbar_h_mm / 2]
            : [0, sign * (tile_d_mm / 2 - tbar_w_mm / 2), -tbar_h_mm / 2])
            cube(
                size = axis == 0
                    ? [tbar_w_mm, tile_d_mm, tbar_h_mm]
                    : [tile_w_mm, tbar_w_mm, tbar_h_mm],
                center = true
            );
    }
}
