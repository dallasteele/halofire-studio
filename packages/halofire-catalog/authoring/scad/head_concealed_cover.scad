// Concealed-pendant flush-cover plate (field installed after drywall).
plate_d = 85;
plate_t = 2.5;
recess_d = 60;
recess_h = 6;
difference() {
    cylinder(h = plate_t, d = plate_d, $fn = 64);
    translate([0, 0, -0.1])
        cylinder(h = plate_t + 0.2, d = recess_d, $fn = 64);
}
translate([0, 0, plate_t])
    cylinder(h = recess_h, d = recess_d, $fn = 64);
