// Grooved union coupling (two halves + ring).
od = 60.3;
body_l = 70;
ring_d = od + 18;
ring_h = 20;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = od, center = true, $fn = 48);
    // Outer ring at midpoint
    rotate([0, 90, 0])
        cylinder(h = ring_h, d = ring_d, center = true, $fn = 48);
}
