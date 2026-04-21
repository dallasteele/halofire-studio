// Paddle flow switch (Potter VSR), saddle-mounted on pipe.
saddle_l = 100;
saddle_w = 60;
saddle_h = 20;
body_w = 80;
body_d = 60;
body_h = 90;
union() {
    translate([0, 0, 0])
        cube(size = [saddle_l, saddle_w, saddle_h], center = true);
    translate([0, 0, saddle_h / 2 + body_h / 2])
        cube(size = [body_w, body_d, body_h], center = true);
    // Conduit knockout on top
    translate([0, 0, saddle_h + body_h])
        cylinder(h = 25, d = 22, $fn = 24);
}
