// End cap — grooved.
od = 60.3;
cap_h = 30;
groove_w = 8;
union() {
    cylinder(h = cap_h, d = od, $fn = 48);
    translate([0, 0, cap_h])
        sphere(d = od, $fn = 32);
    // Groove ring
    difference() {
        cylinder(h = groove_w, d = od + 1, $fn = 48);
        translate([0, 0, -0.1])
            cylinder(h = groove_w + 0.2, d = od - 2, $fn = 48);
    }
}
