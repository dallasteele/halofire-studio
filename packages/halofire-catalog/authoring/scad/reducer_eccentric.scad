// Eccentric reducer — centerlines offset so the BOTTOM of the pipe
// stays flat (drains completely).
big_od = 60.3;   // 2"
small_od = 42.2; // 1-1/4"
length = 100;
offset_y = (big_od - small_od) / 2;
hull() {
    translate([0, 0, 0])
        cylinder(h = 2, d = big_od, $fn = 32);
    translate([length, 0, offset_y])
        rotate([0, 90, 0])
            cylinder(h = 2, d = small_od, $fn = 32);
}
