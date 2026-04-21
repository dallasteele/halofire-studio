// Trapeze hanger — two rods + unistrut crossbar, carries 2 pipes.
strut_l = 600;
strut_w = 40;
strut_h = 40;
rod_d = 10;
rod_l = 300;
union() {
    // Strut (C-channel approx)
    translate([0, 0, 0])
        cube(size = [strut_l, strut_w, strut_h], center = true);
    // Two rods
    for (sgn = [-1, 1])
        translate([sgn * strut_l * 0.35, 0, rod_l / 2 + strut_h / 2])
            cylinder(h = rod_l, d = rod_d, center = true, $fn = 16);
}
