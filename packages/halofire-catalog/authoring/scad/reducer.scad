// Concentric reducer. Large end at -X, small end at +X. Origin at center.
//
//   inlet_large:  (-L/2, 0, 0), dir (-1, 0, 0)
//   outlet_small: (+L/2, 0, 0), dir (+1, 0, 0)

size_in_large = 2;
size_in_small = 1;

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

od_big   = od_mm(size_in_large);
od_small = od_mm(size_in_small);
len_mm   = od_big * 1.4;

rotate([0, 90, 0])
    cylinder(h = len_mm, d1 = od_big, d2 = od_small, center = true, $fn = 48);
