// Paddle flow switch (Potter VSR), saddle-mounted on pipe.
//
// @part flow_switch
// @kind device
// @category device.flow.switch
// @display-name "Paddle Flow Switch (Potter VSR)"
// @mfg potter
// @mfg-pn VSR-2
// @listing UL FM
// @price-usd 88.00
// @install-minutes 20
// @crew journeyman
// @param pipe_size_in enum[2,2.5,3,4,6,8] default=4 label="Pipe Size" unit="in"
// @port saddle position=[0,0,-0.01] direction=[0,0,-1] style=none size_in=4 role=branch

saddle_l = 100;
saddle_w = 60;
saddle_h = 20;
body_w = 80;
body_d = 60;
body_h = 90;
union() {
    translate([0, 0, 0])
        cube(size = [saddle_l, saddle_w, saddle_h], center = true);
    translate([0, 0, saddle_h / 2 + body_h / 2])
        cube(size = [body_w, body_d, body_h], center = true);
    // Conduit knockout on top
    translate([0, 0, saddle_h + body_h])
        cylinder(h = 25, d = 22, $fn = 24);
}
