// Four-way cross fitting (equal ports).
od = 60.3;
len = od * 3.0;
union() {
    rotate([0, 90, 0]) cylinder(h = len, d = od, center = true, $fn = 48);
    rotate([90, 0, 0]) cylinder(h = len, d = od, center = true, $fn = 48);
    sphere(d = od * 1.15, $fn = 32);
}
