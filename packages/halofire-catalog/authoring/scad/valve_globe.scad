// Globe valve 2" threaded (used for drains + test valves).
//
// @part valve_globe
// @kind valve
// @category valve.globe
// @display-name "Globe Valve (2\" NPT)"
// @mfg globe
// @mfg-pn GV-200
// @price-usd 95.00
// @install-minutes 15
// @crew journeyman
// @param size_in enum[1,1.5,2,2.5,3] default=2 label="Size" unit="in"
// @port run_in  position=[-0.055,0,0] direction=[-1,0,0] style=NPT_threaded size_in=2 role=run_a
// @port run_out position=[0.055,0,0]  direction=[1,0,0]  style=NPT_threaded size_in=2 role=run_b

body_d = 85;
body_l = 110;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = 50, center = true, $fn = 32);
    sphere(d = body_d, $fn = 32);
    // Yoke + handwheel
    translate([0, 0, body_d / 2])
        cylinder(h = 50, d = 20, $fn = 24);
    translate([0, 0, body_d / 2 + 50])
        difference() {
            cylinder(h = 5, d = 70, $fn = 32);
            translate([0, 0, -0.1]) cylinder(h = 5.2, d = 40, $fn = 32);
        }
}
