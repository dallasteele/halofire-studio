// ESFR upright, K=11.2 — large-drop storage sprinkler.
frame_d = 22;
deflector_d = 56;
total_h = 72;
union() {
    cylinder(h = total_h * 0.55, d = frame_d, $fn = 36);
    translate([0, 0, total_h * 0.55])
        cylinder(h = total_h * 0.15, d1 = frame_d, d2 = frame_d * 0.7, $fn = 36);
    translate([0, 0, total_h * 0.78])
        cylinder(h = 2.5, d = deflector_d, $fn = 48);
    for (a = [0:60:300]) rotate([0, 0, a])
        translate([deflector_d * 0.42, 0, total_h * 0.78])
            cylinder(h = 1.2, d = 3.5, $fn = 16);
}
