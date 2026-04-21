// Four-way cross fitting (equal ports).
//
// @part cross_fitting
// @kind fitting
// @category fitting.cross
// @display-name "Equal Cross Fitting (2\")"
// @mfg victaulic
// @mfg-pn Style-35
// @price-usd 19.00
// @install-minutes 10
// @crew journeyman
// @param size_in enum[1,1.25,1.5,2,2.5,3,4] default=2 label="Size" unit="in"
// @port run_in   position=[-0.09,0,0] direction=[-1,0,0] style=grooved size_in=2 role=run_a
// @port run_out  position=[0.09,0,0]  direction=[1,0,0]  style=grooved size_in=2 role=run_b
// @port branch_a position=[0,-0.09,0] direction=[0,-1,0] style=grooved size_in=2 role=branch
// @port branch_b position=[0,0.09,0]  direction=[0,1,0]  style=grooved size_in=2 role=branch

od = 60.3;
len = od * 3.0;
union() {
    rotate([0, 90, 0]) cylinder(h = len, d = od, center = true, $fn = 48);
    rotate([90, 0, 0]) cylinder(h = len, d = od, center = true, $fn = 48);
    sphere(d = od * 1.15, $fn = 32);
}
