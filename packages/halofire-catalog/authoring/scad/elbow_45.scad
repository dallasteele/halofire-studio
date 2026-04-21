// 45° elbow, 2" grooved.
//
// @part elbow_45
// @kind fitting
// @category fitting.elbow45.grooved
// @display-name "45° Grooved Elbow (2\")"
// @mfg victaulic
// @mfg-pn Style-11
// @price-usd 8.40
// @install-minutes 6
// @crew journeyman
// @param size_in enum[1,1.25,1.5,2,2.5,3,4] default=2 label="Size" unit="in"
// @port in  position=[0.072,0,0]       direction=[-1,0,0]           style=grooved size_in=2 role=run_a
// @port out position=[0.051,0.051,0]   direction=[0.7071,0.7071,0]  style=grooved size_in=2 role=run_b

od = 60.3;
r = od * 1.2;   // centerline radius
for (a = [0:5:45]) rotate([0, 0, a])
    translate([r, 0, 0]) rotate([0, 90, 0])
        cylinder(h = r * 0.10, d = od, $fn = 32, center = true);
