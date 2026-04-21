// Seismic sway brace — diagonal strut (NFPA 13 §18).
// Brace attaches to pipe at origin; rises at 45°.

// @part hanger_seismic_sway
// @kind hanger
// @category hanger.seismic.sway
// @display-name "Seismic Sway Brace (1\" × 4')"
// @mfg tolco
// @mfg-pn Fig-4L
// @listing UL FM
// @price-usd 38.00
// @install-minutes 25
// @crew journeyman
// @param brace_l number[600,3000] default=1200 label="Brace Length" unit="mm"
// @param angle_deg number[30,60] default=45 label="Brace Angle" unit="deg"
// @port pipe position=[0,0,0] direction=[0,0,-1] style=none size_in=2 role=branch

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
