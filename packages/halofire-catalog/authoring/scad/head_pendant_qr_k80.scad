// Quick-response pendant, K=8.0 (≈ Tyco TY-B).
// Y-up in consumer; authored Z-up here, converted at render.
k = 8.0;
frame_d = 14;          // 1/2" NPT body
bulb_d = 3;
deflector_d = 34;
total_h = 58;
union() {
    cylinder(h = total_h * 0.55, d = frame_d, $fn = 32);
    translate([0, 0, total_h * 0.55])
        cylinder(h = total_h * 0.10, d1 = frame_d, d2 = frame_d * 0.6, $fn = 32);
    translate([0, 0, total_h * 0.70])
        sphere(d = bulb_d, $fn = 24);
    translate([0, 0, total_h - 2])
        cylinder(h = 2, d = deflector_d, $fn = 48);
}
