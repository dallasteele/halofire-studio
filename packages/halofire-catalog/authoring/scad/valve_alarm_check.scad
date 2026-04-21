// Alarm check (wet-pipe) valve, 4" flanged.
body_d = 170;
body_h = 320;
flange_od = 229;
flange_t = 22;
union() {
    cylinder(h = body_h, d = body_d, $fn = 48);
    translate([0, 0, body_h])
        cylinder(h = flange_t, d = flange_od, $fn = 48);
    translate([0, 0, -flange_t])
        cylinder(h = flange_t, d = flange_od, $fn = 48);
    // Trim port (side)
    translate([body_d / 2, 0, body_h * 0.4])
        rotate([0, 90, 0])
            cylinder(h = 60, d = 32, $fn = 24);
}
