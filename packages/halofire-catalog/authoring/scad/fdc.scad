// Fire Department Connection (FDC) — exterior wall hookup.
// Two 2-1/2" Stortz couplings + escutcheon plate. Local origin =
// plate center, projects toward street.
// V2 Phase 4.1.

// @part fdc
// @kind fdc
// @category fdc.2.5in.stortz
// @display-name "FDC Twin 2-1/2\" Stortz (Wall-Mount)"
// @mfg potter_roemer
// @mfg-pn 5775
// @listing UL
// @price-usd 325.00
// @install-minutes 45
// @crew foreman
// @param inlet_size_in enum[2.5,3,4] default=2.5 label="Inlet Size" unit="in"
// @port inlet_A position=[-0.05,0,0.086] direction=[0,-1,0] style=stortz size_in=2.5 role=branch
// @port inlet_B position=[ 0.05,0,0.086] direction=[0,-1,0] style=stortz size_in=2.5 role=branch

inlet_size_in = 2.5;     // 2-1/2" Stortz standard
plate_w_mm = 200;
plate_h_mm = 250;
plate_thick_mm = 6;
inlet_proj_mm = 80;      // how far inlets stick out

mm_per_in = 25.4;
inlet_dia_mm = inlet_size_in * mm_per_in;

// Escutcheon plate
translate([0, 0, plate_thick_mm / 2])
    cube(size = [plate_w_mm, plate_h_mm, plate_thick_mm], center = true);

// Two inlets (left + right)
for (sx = [-1, 1]) {
    translate([sx * 50, 0, plate_thick_mm + inlet_proj_mm / 2])
        rotate([90, 0, 0])
            cylinder(h = inlet_proj_mm, r = inlet_dia_mm / 2,
                     center = true, $fn = 24);
    // Stortz lug ring
    translate([sx * 50, 0, plate_thick_mm + inlet_proj_mm])
        rotate([90, 0, 0])
            cylinder(h = 12, r = inlet_dia_mm / 2 + 8,
                     center = true, $fn = 24);
}

// "FDC" label embossed (placeholder — visual cue)
translate([0, plate_h_mm / 2 - 20, plate_thick_mm + 1])
    cube(size = [60, 4, 2], center = true);  // simplified text bar
