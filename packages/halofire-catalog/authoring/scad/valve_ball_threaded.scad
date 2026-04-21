// Ball valve 1" threaded with lever handle.
//
// @part valve_ball_threaded
// @kind valve
// @category valve.ball.threaded
// @display-name "Ball Valve (1\" NPT)"
// @mfg other
// @mfg-pn BV-100
// @price-usd 28.00
// @install-minutes 10
// @crew journeyman
// @param size_in enum[0.5,0.75,1,1.25,1.5,2] default=1 label="Size" unit="in"
// @port run_in  position=[-0.045,0,0] direction=[-1,0,0] style=NPT_threaded size_in=1 role=run_a
// @port run_out position=[0.045,0,0]  direction=[1,0,0]  style=NPT_threaded size_in=1 role=run_b

body_od = 50;
body_l = 90;
handle_l = 120;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = body_od, center = true, $fn = 40);
    // Stem + handle
    translate([0, 0, body_od / 2 + 2])
        cylinder(h = 12, d = 12, $fn = 24);
    translate([0, 0, body_od / 2 + 15])
        cube(size = [handle_l, 15, 6], center = true);
}
