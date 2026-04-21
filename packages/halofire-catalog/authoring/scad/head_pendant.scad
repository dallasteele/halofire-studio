// Pendant sprinkler head. Thread up (+Y), deflector below origin.
//
//   inlet: (0, +L/2, 0), dir (0, +1, 0)    — 1/2" NPT male
//
// K-factor is metadata only; geometry is the same visual stand-in.
//
// @part head_pendant
// @kind sprinkler_head
// @category head.pendant.k56
// @display-name "Pendant Sprinkler K5.6 (1/2\" NPT)"
// @mfg tyco
// @mfg-pn TY3251
// @listing UL FM
// @hazard-classes LH OH1 OH2
// @price-usd 22.50
// @install-minutes 5
// @crew journeyman
// @k-factor 5.6
// @orientation pendant
// @response standard
// @temperature 155F
// @param size_in enum[0.5,0.75] default=0.5 label="Size" unit="in"
// @param k_factor enum[5.6,8.0] default=5.6 label="K-Factor"
// @port inlet position=[0,0.014,0] direction=[0,1,0] style=NPT_threaded size_in=0.5 role=drop

size_in = 0.5;
k_factor = 5.6;

thread_od    = 21.3;   // 1/2" NPT
thread_len   = 16;
frame_height = 28;
deflector_d  = 22;

union() {
    // Threaded boss up
    translate([0, thread_len/2, 0])
        cylinder(h = thread_len, d = thread_od, center = true, $fn = 24);
    // Hex wrench flat
    translate([0, -3, 0])
        rotate([90, 0, 0])
        cylinder(h = 6, d = thread_od * 1.55, $fn = 6, center = true);
    // Frame yoke
    translate([0, -frame_height/2, 0])
        cylinder(h = frame_height, d = 6, center = true, $fn = 16);
    // Deflector plate
    translate([0, -frame_height - 1, 0])
        cylinder(h = 2, d = deflector_d, center = true, $fn = 32);
}
