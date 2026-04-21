// Sidewall sprinkler head. Thread -X, deflector projects +X.
//
//   inlet: (-L/2, 0, 0), dir (-1, 0, 0)

// @part head_sidewall
// @kind sprinkler_head
// @category head.sidewall.k56
// @display-name "Sidewall Sprinkler K5.6 (1/2\" NPT)"
// @mfg tyco
// @mfg-pn TY3331
// @listing UL FM
// @hazard-classes LH OH1
// @price-usd 26.50
// @install-minutes 6
// @crew journeyman
// @k-factor 5.6
// @orientation sidewall
// @response standard
// @temperature 155F
// @param size_in enum[0.5,0.75] default=0.5 label="Size" unit="in"
// @port inlet position=[-0.008,0,0] direction=[-1,0,0] style=NPT_threaded size_in=0.5 role=drop

thread_od    = 21.3;
thread_len   = 16;
deflector_d  = 45;
deflector_h  = 2;

union() {
    translate([-thread_len/2, 0, 0])
        rotate([0, 90, 0])
        cylinder(h = thread_len, d = thread_od, center = true, $fn = 24);
    // Wrench flats
    translate([3, 0, 0])
        rotate([0, 90, 0])
        cylinder(h = 6, d = thread_od * 1.55, $fn = 6, center = true);
    // Angled deflector vane
    translate([deflector_d/2, 0, 4])
        rotate([0, 60, 0])
        cylinder(h = deflector_h, d = deflector_d, center = true, $fn = 32);
}
