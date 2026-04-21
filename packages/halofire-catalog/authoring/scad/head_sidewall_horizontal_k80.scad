// Horizontal sidewall K=8.0 — throws water to one side of corridor.
size_in = 0.75;
frame_d = 18;
body_l = 60;
deflector_w = 56;
deflector_h = 20;
rotate([0, 90, 0])
    cylinder(h = body_l, d = frame_d, $fn = 32);
translate([body_l, 0, 0])
    cube(size = [3, deflector_w, deflector_h], center = true);
