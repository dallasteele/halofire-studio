// Liquid-filled pressure gauge, 3.5" face, 1/4" NPT stem.
//
// @part pressure_gauge_liquid
// @kind device
// @category device.gauge.liquid
// @display-name "Liquid-Filled Pressure Gauge (3.5\" face, 1/4\" NPT)"
// @mfg other
// @mfg-pn PG-LF-35
// @price-usd 22.00
// @install-minutes 5
// @crew apprentice
// @param size_in enum[0.25,0.5] default=0.25 label="Stem Size" unit="in"
// @port stem position=[0,0,-0.035] direction=[0,0,-1] style=NPT_threaded size_in=0.25 role=branch

face_d = 90;
face_t = 20;
stem_l = 35;
stem_d = 12;
union() {
    cylinder(h = face_t, d = face_d, $fn = 48);
    translate([0, 0, -stem_l / 2])
        cylinder(h = stem_l, d = stem_d, $fn = 20);
}
