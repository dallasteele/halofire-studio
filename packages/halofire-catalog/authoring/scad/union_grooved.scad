// Grooved union coupling (two halves + ring).
//
// @part union_grooved
// @kind fitting
// @category fitting.union
// @display-name "Grooved Union Coupling (2\")"
// @mfg victaulic
// @mfg-pn Style-77
// @price-usd 14.00
// @install-minutes 7
// @crew journeyman
// @param size_in enum[1,1.25,1.5,2,2.5,3,4] default=2 label="Size" unit="in"
// @port run_in  position=[-0.035,0,0] direction=[-1,0,0] style=grooved size_in=2 role=run_a
// @port run_out position=[0.035,0,0]  direction=[1,0,0]  style=grooved size_in=2 role=run_b

od = 60.3;
body_l = 70;
ring_d = od + 18;
ring_h = 20;
union() {
    rotate([0, 90, 0])
        cylinder(h = body_l, d = od, center = true, $fn = 48);
    // Outer ring at midpoint
    rotate([0, 90, 0])
        cylinder(h = ring_h, d = ring_d, center = true, $fn = 48);
}
