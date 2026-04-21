// Trapeze hanger — two rods + unistrut crossbar, carries 2 pipes.
// Pipe-contact at strut top-center.

// @part hanger_trapeze
// @kind hanger
// @category hanger.trapeze
// @display-name "Trapeze Hanger (Unistrut + 2 Rods)"
// @mfg unistrut
// @mfg-pn P1000-Trapeze
// @price-usd 22.00
// @install-minutes 20
// @crew journeyman
// @param strut_l number[300,1800] default=600 label="Strut Length" unit="mm"
// @param rod_l number[150,600] default=300 label="Rod Length" unit="mm"
// @port pipe position=[0,0,0.02] direction=[0,0,1] style=none size_in=2 role=branch

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
