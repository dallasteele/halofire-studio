// Pressure switch (low-water / high-pressure alarm).
body_w = 65;
body_d = 40;
body_h = 95;
thread_d = 20;
thread_l = 15;
union() {
    cube(size = [body_w, body_d, body_h], center = true);
    // NPT thread entry bottom
    translate([0, 0, -body_h / 2 - thread_l / 2])
        cylinder(h = thread_l, d = thread_d, center = true, $fn = 24);
    // Conduit top
    translate([0, 0, body_h / 2 + 15])
        cylinder(h = 30, d = 22, $fn = 24);
}
