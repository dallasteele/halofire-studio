// Equal-run grooved tee. Run along X, branch along +Z.
//
//   run_in:  (-L/2, 0, 0), dir (-1, 0, 0)
//   run_out: (+L/2, 0, 0), dir (+1, 0, 0)
//   branch:  (0, 0, L/2),  dir (0, 0, +1)

size_in = 2;

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   5  ? 141.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 :
    nps ==  10  ? 273.0 : 60.3;

od = od_mm(size_in);
run_mm    = od * 3.0;
branch_mm = od * 1.6;

union() {
    // Run (X axis)
    rotate([0, 90, 0])
        cylinder(h = run_mm, d = od, center = true, $fn = 48);
    // Branch (Z axis)
    translate([0, 0, branch_mm / 2])
        cylinder(h = branch_mm, d = od, center = true, $fn = 48);
    // Reinforcement hub
    scale([1.15, 1.05, 1.05])
        sphere(d = od * 1.05, $fn = 36);
}
