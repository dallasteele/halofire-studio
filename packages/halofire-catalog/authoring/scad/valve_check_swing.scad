// Swing-check valve, 4" flanged.
//
// @part valve_check_swing
// @kind valve
// @category valve.check.swing
// @display-name "Swing Check Valve (4\" Flanged)"
// @mfg viking
// @mfg-pn F-1
// @listing UL FM
// @price-usd 310.00
// @install-minutes 30
// @crew foreman
// @param size_in enum[2,2.5,3,4,6,8] default=4 label="Size" unit="in"
// @port run_in  position=[-0.13,0,0] direction=[-1,0,0] style=flanged.150 size_in=4 role=run_a
// @port run_out position=[0.13,0,0]  direction=[1,0,0]  style=flanged.150 size_in=4 role=run_b

body_l = 260;
body_d = 140;
flange_od = 229;
flange_t = 22;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = body_d, center = true, $fn = 48);
    for (sgn = [-1, 1])
        translate([sgn * body_l / 2, 0, 0]) rotate([0, 90, 0])
            cylinder(h = flange_t, d = flange_od, center = true, $fn = 48);
    // Bonnet / cap on top
    translate([0, 0, body_d / 2])
        cylinder(h = 40, d = 90, $fn = 32);
}
