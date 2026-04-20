// Grooved coupling — symmetric. Ends at ±X, origin at center.
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
