// OSY gate tamper switch — bolt-on to valve yoke.
body_w = 70;
body_d = 45;
body_h = 55;
cube(size = [body_w, body_d, body_h], center = true);
// Conduit entry
translate([0, 0, body_h / 2 + 15])
    cylinder(h = 30, d = 22, $fn = 24);
// Mounting bracket
translate([body_w / 2, 0, 0])
    cube(size = [6, body_d + 20, body_h], center = true);
