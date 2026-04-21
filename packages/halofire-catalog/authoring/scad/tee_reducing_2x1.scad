// Reducing tee — 2" run, 1" branch.
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
