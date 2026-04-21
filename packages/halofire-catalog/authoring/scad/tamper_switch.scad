// OSY gate tamper switch — bolt-on to valve yoke.
//
// @part tamper_switch
// @kind device
// @category device.tamper.switch
// @display-name "OS&Y Tamper Switch (Potter OSYSU)"
// @mfg potter
// @mfg-pn OSYSU-1
// @listing UL FM
// @price-usd 72.00
// @install-minutes 15
// @crew journeyman
// @param mount_size_in enum[2,2.5,3,4,6,8] default=4 label="Valve Size" unit="in"
// @port mount position=[0.035,0,0] direction=[1,0,0] style=none size_in=4 role=branch

body_w = 70;
body_d = 45;
body_h = 55;
cube(size = [body_w, body_d, body_h], center = true);
// Conduit entry
translate([0, 0, body_h / 2 + 15])
    cylinder(h = 30, d = 22, $fn = 24);
// Mounting bracket
translate([body_w / 2, 0, 0])
    cube(size = [6, body_d + 20, body_h], center = true);
