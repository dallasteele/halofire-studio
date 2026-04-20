// Sidewall sprinkler head. Thread -X, deflector projects +X.
//
//   inlet: (-L/2, 0, 0), dir (-1, 0, 0)

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
