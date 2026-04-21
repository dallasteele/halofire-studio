// Seismic sway brace — diagonal strut (NFPA 13 §18).
brace_l = 1200;
brace_od = 33.4;  // 1" pipe brace
angle_deg = 45;
rotate([0, angle_deg, 0])
    cylinder(h = brace_l, d = brace_od, $fn = 24);
// Pipe attachment fitting at top end
translate([brace_l * sin(angle_deg), 0, brace_l * cos(angle_deg)])
    cube(size = [60, 40, 30], center = true);
// Structural attachment plate at bottom
cube(size = [80, 60, 8], center = true);
