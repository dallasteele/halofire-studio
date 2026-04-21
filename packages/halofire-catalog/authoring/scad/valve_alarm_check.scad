// Alarm check (wet-pipe) valve, 4" flanged.
//
// @part valve_alarm_check
// @kind valve
// @category valve.alarm.check.wet
// @display-name "Wet Alarm Check Valve (4\" Flanged)"
// @mfg viking
// @mfg-pn J-1
// @listing UL FM
// @price-usd 780.00
// @install-minutes 60
// @crew foreman
// @param size_in enum[4,6,8] default=4 label="Size" unit="in"
// @port inlet  position=[0,0,-0.16] direction=[0,0,-1] style=flanged.150 size_in=4 role=run_a
// @port outlet position=[0,0,0.16]  direction=[0,0,1]  style=flanged.150 size_in=4 role=run_b
// @port trim   position=[0.085,0,0] direction=[1,0,0]  style=NPT_threaded size_in=1 role=branch

body_d = 170;
body_h = 320;
flange_od = 229;
flange_t = 22;
union() {
    cylinder(h = body_h, d = body_d, $fn = 48);
    translate([0, 0, body_h])
        cylinder(h = flange_t, d = flange_od, $fn = 48);
    translate([0, 0, -flange_t])
        cylinder(h = flange_t, d = flange_od, $fn = 48);
    // Trim port (side)
    translate([body_d / 2, 0, body_h * 0.4])
        rotate([0, 90, 0])
            cylinder(h = 60, d = 32, $fn = 24);
}
