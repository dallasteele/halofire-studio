// Sprinkler-pipe hanger: U-bolt + threaded rod + ceiling clip.
// NFPA 13 §17 mandates one hanger per pipe segment (per spacing
// table). Local origin = pipe center; rod extends UP.
// V2 Phase 4.1.

pipe_size_in = 2;
rod_length_mm = 250;          // 10" drop typical
rod_diameter_mm = 9.5;        // 3/8" all-thread

mm_per_in = 25.4;
pipe_dia_mm = pipe_size_in * mm_per_in;
ubolt_thick_mm = 6;

// U-bolt (curved part = simplified torus arc; we use a cylinder
// rim for OpenSCAD simplicity)
difference() {
    rotate([90, 0, 0])
        cylinder(h = ubolt_thick_mm, r = pipe_dia_mm / 2 + ubolt_thick_mm,
                 center = true, $fn = 32);
    rotate([90, 0, 0])
        cylinder(h = ubolt_thick_mm + 1, r = pipe_dia_mm / 2,
                 center = true, $fn = 32);
    // chop off the bottom half (open below the pipe)
    translate([0, 0, -100]) cube([200, 200, 200], center = true);
}

// Threaded rod going up
translate([0, 0, rod_length_mm / 2 + pipe_dia_mm / 2])
    cylinder(h = rod_length_mm, r = rod_diameter_mm / 2, center = true, $fn = 12);

// Ceiling clip (flat plate)
translate([0, 0, rod_length_mm + pipe_dia_mm / 2])
    cube(size = [40, 40, 4], center = true);
