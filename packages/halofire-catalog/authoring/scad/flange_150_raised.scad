// 150# ANSI raised-face flange, 4" NPS.
//
// @part flange_150_raised
// @kind fitting
// @category fitting.flange.150
// @display-name "ANSI 150# Raised-Face Flange (4\")"
// @mfg generic
// @mfg-pn ANSI-150-RF
// @price-usd 42.00
// @install-minutes 15
// @crew journeyman
// @param size_in enum[2,2.5,3,4,6,8] default=4 label="Size" unit="in"
// @port face  position=[0,0,0.012]  direction=[0,0,1]  style=flanged.150 size_in=4 role=run_a
// @port weld  position=[0,0,-0.012] direction=[0,0,-1] style=grooved     size_in=4 role=run_b

flange_od = 229;
flange_t = 24;
raised_d = 171;
raised_h = 2;
pipe_od = 114.3;  // 4" NPS
bolt_pcd = 191;
bolt_d = 19;       // 3/4" bolts
union() {
    cylinder(h = flange_t, d = flange_od, $fn = 64);
    translate([0, 0, flange_t])
        cylinder(h = raised_h, d = raised_d, $fn = 48);
    // Central bore (subtracted)
}
// 8 bolt holes
for (i = [0:7]) rotate([0, 0, i * 45])
    translate([bolt_pcd / 2, 0, -0.1])
        cylinder(h = flange_t + 0.2, d = bolt_d, $fn = 16);
