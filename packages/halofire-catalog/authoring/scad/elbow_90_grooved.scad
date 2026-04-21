// 90° elbow with roll-groove ends (Victaulic-pattern).
od = 60.3;  // 2" NPS
r = od * 1.3;
groove_w = 8;
groove_d = 2;
for (a = [0:4:90]) rotate([0, 0, a])
    translate([r, 0, 0]) rotate([0, 90, 0])
        cylinder(h = r * 0.08, d = od, $fn = 32, center = true);
// Groove rings at both ends (approx)
rotate([0, 0, 0]) translate([r, 0, 0])
    difference() {
        cylinder(h = groove_w, d = od + 1, $fn = 32, center = true);
        cylinder(h = groove_w + 0.1, d = od - groove_d, $fn = 32, center = true);
    }
