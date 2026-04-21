// Beam C-clamp — attaches threaded rod to a steel beam flange.
// Pipe-contact surface is below the clamp body at -Z.

// @part hanger_c_clamp_beam
// @kind hanger
// @category hanger.c.clamp.beam
// @display-name "C-Clamp Beam Hanger (3/8\" Rod)"
// @mfg anvil
// @mfg-pn Fig-86
// @price-usd 4.75
// @install-minutes 4
// @crew apprentice
// @param rod_d number[6,13] default=10 label="Rod Diameter" unit="mm"
// @port pipe position=[0,0,-0.045] direction=[0,0,-1] style=none size_in=2 role=branch

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
