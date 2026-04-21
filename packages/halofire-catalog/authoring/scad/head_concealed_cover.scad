// Concealed-pendant flush-cover plate (field installed after drywall).
//
// @part head_concealed_cover
// @kind sprinkler_head
// @category head.pendant.k56
// @display-name "Concealed Pendant Sprinkler w/ Cover Plate K5.6"
// @mfg reliable
// @mfg-pn G4-56
// @listing UL FM
// @hazard-classes LH OH1
// @price-usd 38.00
// @install-minutes 8
// @crew journeyman
// @k-factor 5.6
// @orientation concealed
// @response quick
// @temperature 155F
// @param size_in enum[0.5,0.75] default=0.5 label="Size" unit="in"
// @port inlet position=[0,0,0] direction=[0,0,-1] style=NPT_threaded size_in=0.5 role=drop

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
