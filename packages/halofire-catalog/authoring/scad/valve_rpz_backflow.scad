// RPZ reduced-pressure-zone backflow preventer (approx), 4".
//
// @part valve_rpz_backflow
// @kind valve
// @category valve.rpz.backflow
// @display-name "RPZ Backflow Preventer (4\" Flanged)"
// @mfg other
// @mfg-pn 975XL
// @listing UL FM
// @price-usd 2200.00
// @install-minutes 60
// @crew foreman
// @param size_in enum[2,2.5,3,4,6] default=4 label="Size" unit="in"
// @port run_in  position=[-0.35,0,0] direction=[-1,0,0] style=flanged.150 size_in=4 role=run_a
// @port run_out position=[0.35,0,0]  direction=[1,0,0]  style=flanged.150 size_in=4 role=run_b

body_l = 700;
body_d = 160;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = body_d, center = true, $fn = 48);
    // Two check valve bonnets
    for (x = [-body_l * 0.25, body_l * 0.25])
        translate([x, 0, body_d / 2])
            cylinder(h = 80, d = 90, $fn = 32);
    // Relief valve in middle
    translate([0, 0, -body_d / 2 - 40])
        cylinder(h = 80, d = 70, $fn = 32);
}
