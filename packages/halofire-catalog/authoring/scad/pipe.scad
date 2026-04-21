// Steel pipe — SCH10 / SCH40 / CPVC / copper.
//
// Params:
//   size_in      nominal pipe size in inches (1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10)
//   length_m     length of this cut piece in meters (default 1.0 m)
//   schedule     "sch10" | "sch40" (affects wall thickness)
//
// Output: origin at center, long axis = +Z, both ends open.
//
// Local convention matches connectorsFor(): end_a at -Z/2, end_b at +Z/2.

// @part pipe
// @kind pipe_segment
// @category pipe.sch10.grooved
// @display-name "SCH10 Grooved Pipe (2\")"
// @mfg generic
// @mfg-pn SCH10-GRV
// @price-usd 5.60
// @install-minutes 4
// @crew journeyman
// @param size_in enum[1,1.25,1.5,2,2.5,3,4,5,6,8,10] default=2 label="Size" unit="in"
// @param length_m number[0.1,12] default=1.0 label="Length" unit="m"
// @param schedule enum[sch10,sch40] default=sch10 label="Schedule"
// @port in  position=[0,0,-0.5] direction=[0,0,-1] style=grooved size_in=2 role=run_a
// @port out position=[0,0, 0.5] direction=[0,0, 1] style=grooved size_in=2 role=run_b

size_in   = 2;
length_m  = 1.0;
schedule  = "sch10";

// NPS → approximate outer diameter (mm) per ASME B36.10
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

// Wall thickness (mm) — schedule-dependent
function wall_mm(nps, sched) =
    sched == "sch40"
        ? (nps <= 1.5 ? 3.68 : nps <= 3 ? 5.49 : 6.02)
        : (nps <= 1.5 ? 2.77 : nps <= 3 ? 3.05 : 3.68);

od = od_mm(size_in);
id = od - 2 * wall_mm(size_in, schedule);
len_mm = length_m * 1000;

difference() {
    cylinder(h = len_mm, d = od, center = true, $fn = 64);
    cylinder(h = len_mm + 1, d = id, center = true, $fn = 64);
}
