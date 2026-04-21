// 45° elbow, 2" grooved.
od = 60.3;
r = od * 1.2;   // centerline radius
for (a = [0:5:45]) rotate([0, 0, a])
    translate([r, 0, 0]) rotate([0, 90, 0])
        cylinder(h = r * 0.10, d = od, $fn = 32, center = true);
