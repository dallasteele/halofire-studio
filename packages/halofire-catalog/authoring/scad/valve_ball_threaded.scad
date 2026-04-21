// Ball valve 1" threaded with lever handle.
body_od = 50;
body_l = 90;
handle_l = 120;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = body_od, center = true, $fn = 40);
    // Stem + handle
    translate([0, 0, body_od / 2 + 2])
        cylinder(h = 12, d = 12, $fn = 24);
    translate([0, 0, body_od / 2 + 15])
        cube(size = [handle_l, 15, 6], center = true);
}
