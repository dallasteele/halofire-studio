// Beam C-clamp — attaches threaded rod to a steel beam flange.
body_h = 50;
body_w = 45;
body_t = 15;
jaw_d = 30;
rod_d = 10;
rod_l = 40;
union() {
    difference() {
        cube(size = [body_w, body_t, body_h], center = true);
        translate([0, 0, body_h / 4])
            cube(size = [body_w * 0.7, body_t + 0.2, jaw_d], center = true);
    }
    // Threaded rod down
    translate([0, 0, -body_h / 2 - rod_l / 2])
        cylinder(h = rod_l, d = rod_d, center = true, $fn = 16);
}
