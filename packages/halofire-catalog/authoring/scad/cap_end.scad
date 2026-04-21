// End cap — grooved.
//
// @part cap_end
// @kind fitting
// @category fitting.cap
// @display-name "Grooved End Cap (2\")"
// @mfg victaulic
// @mfg-pn Style-60
// @price-usd 4.80
// @install-minutes 3
// @crew apprentice
// @param size_in enum[1,1.25,1.5,2,2.5,3,4] default=2 label="Size" unit="in"
// @port in position=[0,0,0] direction=[0,0,-1] style=grooved size_in=2 role=run_a

od = 60.3;
cap_h = 30;
groove_w = 8;
union() {
    cylinder(h = cap_h, d = od, $fn = 48);
    translate([0, 0, cap_h])
        sphere(d = od, $fn = 32);
    // Groove ring
    difference() {
        cylinder(h = groove_w, d = od + 1, $fn = 48);
        translate([0, 0, -0.1])
            cylinder(h = groove_w + 0.2, d = od - 2, $fn = 48);
    }
}
