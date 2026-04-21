// Eccentric reducer — centerlines offset so the BOTTOM of the pipe
// stays flat (drains completely).
//
// @part reducer_eccentric
// @kind fitting
// @category fitting.reducer.eccentric
// @display-name "Eccentric Reducer (2\"x1.25\")"
// @mfg victaulic
// @mfg-pn Style-50E
// @price-usd 12.00
// @install-minutes 6
// @crew journeyman
// @param large_size_in enum[1.5,2,2.5,3,4] default=2 label="Large Size" unit="in"
// @param small_size_in enum[1,1.25,1.5,2,2.5] default=1.25 label="Small Size" unit="in"
// @port run_in  position=[0,0,0]    direction=[-1,0,0] style=grooved size_in=2    role=run_a
// @port run_out position=[0.1,0,0]  direction=[1,0,0]  style=grooved size_in=1.25 role=run_b

big_od = 60.3;   // 2"
small_od = 42.2; // 1-1/4"
length = 100;
offset_y = (big_od - small_od) / 2;
hull() {
    translate([0, 0, 0])
        cylinder(h = 2, d = big_od, $fn = 32);
    translate([length, 0, offset_y])
        rotate([0, 90, 0])
            cylinder(h = 2, d = small_od, $fn = 32);
}
