// ESFR upright, K=11.2 — large-drop storage sprinkler.
//
// @part head_upright_esfr_k112
// @kind sprinkler_head
// @category head.pendant.esfr.k112
// @display-name "ESFR Upright Sprinkler K11.2 (3/4\" NPT)"
// @mfg viking
// @mfg-pn VK510
// @listing UL FM
// @hazard-classes ESFR
// @price-usd 48.00
// @install-minutes 6
// @crew journeyman
// @k-factor 11.2
// @orientation upright
// @response esfr
// @temperature 165F
// @param size_in enum[0.75,1] default=0.75 label="Size" unit="in"
// @port inlet position=[0,0,0] direction=[0,0,-1] style=NPT_threaded size_in=0.75 role=drop

frame_d = 22;
deflector_d = 56;
total_h = 72;
union() {
    cylinder(h = total_h * 0.55, d = frame_d, $fn = 36);
    translate([0, 0, total_h * 0.55])
        cylinder(h = total_h * 0.15, d1 = frame_d, d2 = frame_d * 0.7, $fn = 36);
    translate([0, 0, total_h * 0.78])
        cylinder(h = 2.5, d = deflector_d, $fn = 48);
    for (a = [0:60:300]) rotate([0, 0, a])
        translate([deflector_d * 0.42, 0, total_h * 0.78])
            cylinder(h = 1.2, d = 3.5, $fn = 16);
}
