// Pressure switch (low-water / high-pressure alarm).
//
// @part pressure_switch
// @kind device
// @category device.pressure.switch
// @display-name "Pressure Switch (Potter PS10)"
// @mfg potter
// @mfg-pn PS10-2
// @listing UL FM
// @price-usd 95.00
// @install-minutes 15
// @crew journeyman
// @param size_in enum[0.25,0.5] default=0.5 label="Connection Size" unit="in"
// @port inlet position=[0,0,-0.055] direction=[0,0,-1] style=NPT_threaded size_in=0.5 role=branch

body_w = 65;
body_d = 40;
body_h = 95;
thread_d = 20;
thread_l = 15;
union() {
    cube(size = [body_w, body_d, body_h], center = true);
    // NPT thread entry bottom
    translate([0, 0, -body_h / 2 - thread_l / 2])
        cylinder(h = thread_l, d = thread_d, center = true, $fn = 24);
    // Conduit top
    translate([0, 0, body_h / 2 + 15])
        cylinder(h = 30, d = 22, $fn = 24);
}
