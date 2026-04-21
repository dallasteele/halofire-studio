// Structural concrete column. Square or round, configurable size +
// height. Local origin = column geometric center (matches the
// connector-graph convention; see authoring README rule 2).
//
// Defaults: 16" square × 10' tall reinforced-concrete column,
// chamfered top + base for a real-building look.

size_in = 16;        // 12, 14, 16, 18, 20 — typical residential / commercial
height_ft = 10;      // 8 - 14 ft typical
shape = "square";    // "square" or "round"

mm_per_in = 25.4;
mm_per_ft = mm_per_in * 12;

w_mm = size_in * mm_per_in;
h_mm = height_ft * mm_per_ft;
chamfer_mm = 25;     // 1 inch chamfer top + bottom

module square_column() {
    // Base flare
    translate([0, 0, -h_mm / 2]) cube(size = [w_mm + 2 * chamfer_mm, w_mm + 2 * chamfer_mm, chamfer_mm], center = true);
    // Shaft
    translate([0, 0, 0]) cube(size = [w_mm, w_mm, h_mm - 2 * chamfer_mm], center = true);
    // Cap
    translate([0, 0, h_mm / 2]) cube(size = [w_mm + 2 * chamfer_mm, w_mm + 2 * chamfer_mm, chamfer_mm], center = true);
}

module round_column() {
    r = w_mm / 2;
    translate([0, 0, -h_mm / 2]) cylinder(h = chamfer_mm, r1 = r + chamfer_mm, r2 = r, center = true, $fn = 48);
    translate([0, 0, 0]) cylinder(h = h_mm - 2 * chamfer_mm, r = r, center = true, $fn = 48);
    translate([0, 0, h_mm / 2]) cylinder(h = chamfer_mm, r1 = r, r2 = r + chamfer_mm, center = true, $fn = 48);
}

if (shape == "round") {
    round_column();
} else {
    square_column();
}
