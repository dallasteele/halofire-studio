// Horizontal sidewall K=8.0 — throws water to one side of corridor.
//
// @part head_sidewall_horizontal_k80
// @kind sprinkler_head
// @category head.sidewall.k80
// @display-name "Horizontal Sidewall Sprinkler K8.0 (3/4\" NPT)"
// @mfg tyco
// @mfg-pn TY3331
// @listing UL FM
// @hazard-classes LH OH1
// @price-usd 27.00
// @install-minutes 6
// @crew journeyman
// @k-factor 8.0
// @orientation sidewall
// @response standard
// @temperature 155F
// @param size_in enum[0.5,0.75] default=0.75 label="Size" unit="in"
// @port inlet position=[0,0,0] direction=[-1,0,0] style=NPT_threaded size_in=0.75 role=drop

size_in = 0.75;
frame_d = 18;
body_l = 60;
deflector_w = 56;
deflector_h = 20;
rotate([0, 90, 0])
    cylinder(h = body_l, d = frame_d, $fn = 32);
translate([body_l, 0, 0])
    cube(size = [3, deflector_w, deflector_h], center = true);
