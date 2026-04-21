// Grooved coupling — symmetric. Ends at ±X, origin at center.
//
// @part coupling
// @kind fitting
// @category fitting.union
// @display-name "Grooved Coupling (2\")"
// @mfg victaulic
// @mfg-pn Style-77
// @price-usd 7.20
// @install-minutes 5
// @crew journeyman
// @param size_in enum[1,1.25,1.5,2,2.5,3,4] default=2 label="Size" unit="in"
// @port in  position=[-0.04,0,0] direction=[-1,0,0] style=grooved size_in=2 role=run_a
// @port out position=[ 0.04,0,0] direction=[ 1,0,0] style=grooved size_in=2 role=run_b

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

od = od_mm(size_in);
len_mm = od * 1.6;

rotate([0, 90, 0])
    union() {
        cylinder(h = len_mm, d = od * 1.18, center = true, $fn = 48);
        cylinder(h = len_mm + 4, d = od, center = true, $fn = 48);
    }
