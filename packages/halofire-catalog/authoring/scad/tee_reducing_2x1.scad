// Reducing tee — 2" run, 1" branch.
//
// @part tee_reducing_2x1
// @kind fitting
// @category fitting.tee.grooved
// @display-name "Reducing Grooved Tee (2\"x1\")"
// @mfg victaulic
// @mfg-pn Style-25
// @price-usd 13.50
// @install-minutes 8
// @crew journeyman
// @param run_size_in enum[1.5,2,2.5,3,4] default=2 label="Run Size" unit="in"
// @param branch_size_in enum[0.75,1,1.25,1.5] default=1 label="Branch Size" unit="in"
// @port run_in  position=[-0.09,0,0] direction=[-1,0,0] style=grooved size_in=2 role=run_a
// @port run_out position=[0.09,0,0]  direction=[1,0,0]  style=grooved size_in=2 role=run_b
// @port branch  position=[0,0,0.03]  direction=[0,0,1]  style=grooved size_in=1 role=branch

run_od = 60.3;  // 2" NPS
branch_od = 33.4;  // 1" NPS
run_l = run_od * 3.0;
branch_l = branch_od * 1.8;
union() {
    rotate([0, 90, 0]) cylinder(h = run_l, d = run_od, center = true, $fn = 48);
    translate([0, 0, branch_l / 2])
        cylinder(h = branch_l, d = branch_od, center = true, $fn = 32);
    scale([1.15, 1.05, 1.05]) sphere(d = run_od * 1.05, $fn = 32);
}
