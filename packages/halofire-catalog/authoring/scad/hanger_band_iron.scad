// Band-iron hanger for 1" pipe (light-duty loop).
// Band-iron variant of the clevis family; pipe enters at origin.

// @part hanger_band_iron
// @kind hanger
// @category hanger.clevis
// @display-name "Band-Iron Hanger (1\")"
// @mfg anvil
// @mfg-pn Fig-65
// @price-usd 3.10
// @install-minutes 6
// @crew apprentice
// @param pipe_size_in enum[0.75,1,1.25,1.5,2] default=1 label="Pipe Size" unit="in"
// @port pipe position=[0,0,0] direction=[0,0,1] style=none size_in=1 role=branch

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
