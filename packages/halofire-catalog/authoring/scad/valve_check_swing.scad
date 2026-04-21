// Swing-check valve, 4" flanged.
body_l = 260;
body_d = 140;
flange_od = 229;
flange_t = 22;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = body_d, center = true, $fn = 48);
    for (sgn = [-1, 1])
        translate([sgn * body_l / 2, 0, 0]) rotate([0, 90, 0])
            cylinder(h = flange_t, d = flange_od, center = true, $fn = 48);
    // Bonnet / cap on top
    translate([0, 0, body_d / 2])
        cylinder(h = 40, d = 90, $fn = 32);
}
