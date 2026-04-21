// Globe valve 2" threaded (used for drains + test valves).
body_d = 85;
body_l = 110;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = 50, center = true, $fn = 32);
    sphere(d = body_d, $fn = 32);
    // Yoke + handwheel
    translate([0, 0, body_d / 2])
        cylinder(h = 50, d = 20, $fn = 24);
    translate([0, 0, body_d / 2 + 50])
        difference() {
            cylinder(h = 5, d = 70, $fn = 32);
            translate([0, 0, -0.1]) cylinder(h = 5.2, d = 40, $fn = 32);
        }
}
