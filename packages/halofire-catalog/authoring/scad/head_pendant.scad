// Pendant sprinkler head. Thread up (+Y), deflector below origin.
//
//   inlet: (0, +L/2, 0), dir (0, +1, 0)    — 1/2" NPT male
//
// K-factor is metadata only; geometry is the same visual stand-in.

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
