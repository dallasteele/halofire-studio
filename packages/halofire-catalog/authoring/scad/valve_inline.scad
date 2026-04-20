// Inline valve body — OS&Y gate / butterfly / check / ball.
// Body along X, stem up +Y.
//
//   inlet:  (-L/2, 0, 0), dir (-1, 0, 0)
//   outlet: (+L/2, 0, 0), dir (+1, 0, 0)

size_in = 4;
stem_ratio = 1.8;   // OS&Y handwheels extend well above the body

function od_mm(nps) =
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   5  ? 141.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 :
    nps ==  10  ? 273.0 : 114.3;

od = od_mm(size_in);
body_len = od * 1.6;
stem_len = od * stem_ratio;

union() {
    // Body
    rotate([0, 90, 0])
        cylinder(h = body_len, d = od * 1.3, center = true, $fn = 40);
    // Flange faces
    for (dx = [-body_len/2, body_len/2])
        translate([dx, 0, 0])
            rotate([0, 90, 0])
            cylinder(h = od * 0.18, d = od * 1.55, center = true, $fn = 40);
    // Stem
    translate([0, stem_len/2, 0])
        cylinder(h = stem_len, d = od * 0.25, center = true, $fn = 24);
    // Handwheel
    translate([0, stem_len, 0])
        rotate([90, 0, 0])
        cylinder(h = od * 0.08, d = od * 0.85, center = true, $fn = 32);
}
