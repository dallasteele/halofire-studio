// 90° elbow (grooved). Inlet face at -X, outlet face at +Z.
//
// Params:
//   size_in      nominal pipe size in inches
//
// Connector convention matches connectorsFor():
//   inlet:  position (-L/2, 0, 0), direction (-1, 0, 0)
//   outlet: position (0, 0, L/2), direction (0, 0, 1)

// @part elbow_90
// @kind fitting
// @category fitting.elbow90.grooved
// @display-name "90° Grooved Elbow (2\")"
// @mfg victaulic
// @mfg-pn Style-10
// @price-usd 9.20
// @install-minutes 6
// @crew journeyman
// @param size_in enum[1,1.25,1.5,2,2.5,3,4] default=2 label="Size" unit="in"
// @port in  position=[-0.05,0,0] direction=[-1,0,0] style=grooved size_in=2 role=run_a
// @port out position=[0,0,0.05]  direction=[0,0,1]  style=grooved size_in=2 role=run_b

size_in = 2;

function od_mm(nps) =
    nps ==   1  ? 33.4 :
    nps == 1.25 ? 42.2 :
    nps == 1.5  ? 48.3 :
    nps ==   2  ? 60.3 :
    nps == 2.5  ? 73.0 :
    nps ==   3  ? 88.9 :
    nps ==   4  ? 114.3 :
    nps ==   5  ? 141.3 :
    nps ==   6  ? 168.3 :
    nps ==   8  ? 219.1 :
    nps ==  10  ? 273.0 : 60.3;

od     = od_mm(size_in);
leg_mm = od * 1.4;          // leg length proportional to OD
groove = od * 0.15;         // flared groove at each face

union() {
    // Inlet leg along X, groove on the -X face
    translate([-leg_mm/2, 0, 0])
        rotate([0, 90, 0])
        cylinder(h = leg_mm, d = od, center = true, $fn = 48);
    // Outlet leg along Z
    translate([0, 0, leg_mm/2])
        cylinder(h = leg_mm, d = od, center = true, $fn = 48);
    // Elbow hub
    sphere(d = od * 1.05, $fn = 40);
    // Coupling flares
    translate([-leg_mm, 0, 0])
        rotate([0, 90, 0])
        cylinder(h = groove, d = od * 1.12, center = true, $fn = 48);
    translate([0, 0, leg_mm])
        cylinder(h = groove, d = od * 1.12, center = true, $fn = 48);
}
