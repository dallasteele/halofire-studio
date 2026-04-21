// RPZ reduced-pressure-zone backflow preventer (approx), 4".
body_l = 700;
body_d = 160;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = body_d, center = true, $fn = 48);
    // Two check valve bonnets
    for (x = [-body_l * 0.25, body_l * 0.25])
        translate([x, 0, body_d / 2])
            cylinder(h = 80, d = 90, $fn = 32);
    // Relief valve in middle
    translate([0, 0, -body_d / 2 - 40])
        cylinder(h = 80, d = 70, $fn = 32);
}
