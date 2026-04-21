// Upright sprinkler head. Thread down (-Y), deflector above origin.
//
//   inlet: (0, -L/2, 0), dir (0, -1, 0)
//
// @part head_upright
// @kind sprinkler_head
// @category head.pendant.k56
// @display-name "Upright Sprinkler K5.6 (1/2\" NPT)"
// @mfg tyco
// @mfg-pn TY3131
// @listing UL FM
// @hazard-classes LH OH1 OH2
// @price-usd 23.00
// @install-minutes 5
// @crew journeyman
// @k-factor 5.6
// @orientation upright
// @response standard
// @temperature 155F
// @param size_in enum[0.5,0.75] default=0.5 label="Size" unit="in"
// @param k_factor enum[5.6,8.0] default=5.6 label="K-Factor"
// @port inlet position=[0,-0.014,0] direction=[0,-1,0] style=NPT_threaded size_in=0.5 role=drop

thread_od    = 21.3;
thread_len   = 16;
frame_height = 28;
deflector_d  = 22;

union() {
    translate([0, -thread_len/2, 0])
        cylinder(h = thread_len, d = thread_od, center = true, $fn = 24);
    translate([0, 3, 0])
        rotate([90, 0, 0])
        cylinder(h = 6, d = thread_od * 1.55, $fn = 6, center = true);
    translate([0, frame_height/2, 0])
        cylinder(h = frame_height, d = 6, center = true, $fn = 16);
    translate([0, frame_height + 1, 0])
        cylinder(h = 2, d = deflector_d, center = true, $fn = 32);
}
