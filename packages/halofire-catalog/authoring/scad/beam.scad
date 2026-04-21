// W-shape steel beam (typical W12x26). Used as obstruction
// CubiCasa can't detect; pipes route AROUND via Arm Around tool.
// Local origin = beam centerline, length = X axis.
// V2 Phase 4.1.

length_m = 6.0;          // beam clear span
flange_w_in = 6.5;       // W12x26 flange width
depth_in = 12.2;         // W12x26 depth
flange_t_in = 0.38;
web_t_in = 0.23;

mm_per_in = 25.4;
length_mm = length_m * 1000;
flange_w_mm = flange_w_in * mm_per_in;
depth_mm = depth_in * mm_per_in;
flange_t_mm = flange_t_in * mm_per_in;
web_t_mm = web_t_in * mm_per_in;

// Top flange
translate([0, 0, depth_mm / 2 - flange_t_mm / 2])
    cube(size = [length_mm, flange_w_mm, flange_t_mm], center = true);

// Bottom flange
translate([0, 0, -depth_mm / 2 + flange_t_mm / 2])
    cube(size = [length_mm, flange_w_mm, flange_t_mm], center = true);

// Web
cube(size = [length_mm, web_t_mm, depth_mm - 2 * flange_t_mm],
     center = true);
