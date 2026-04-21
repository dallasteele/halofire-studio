// 90° elbow with roll-groove ends (Victaulic-pattern).
// Inlet at +X (run_a), outlet at +Y (run_b) — bend through 90°.

// @part elbow_90_grooved
// @kind fitting
// @category fitting.elbow90.grooved
// @display-name "90° Grooved Elbow Style 10 (2\")"
// @mfg victaulic
// @mfg-pn Style-10-Grooved
// @price-usd 11.40
// @install-minutes 7
// @crew journeyman
// @param size_in enum[1,1.25,1.5,2,2.5,3,4] default=2 label="Size" unit="in"
// @port in  position=[0.078,0,0] direction=[1,0,0] style=grooved size_in=2 role=run_a
// @port out position=[0,0.078,0] direction=[0,1,0] style=grooved size_in=2 role=run_b

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
