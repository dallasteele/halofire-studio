// Upright sprinkler head. Thread down (-Y), deflector above origin.
//
//   inlet: (0, -L/2, 0), dir (0, -1, 0)

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
