// Band-iron hanger for 1" pipe (light-duty loop).
pipe_od = 33.4;
band_w = 25;
band_t = 3;
rod_d = 10;
rod_l = 150;
loop_r = pipe_od / 2 + band_t;
// Loop (half-torus approximation)
rotate_extrude($fn = 48)
    translate([loop_r, 0, 0])
        square(size = [band_t, band_w]);
// Threaded rod
translate([0, 0, band_w])
    cylinder(h = rod_l, d = rod_d, $fn = 16);
