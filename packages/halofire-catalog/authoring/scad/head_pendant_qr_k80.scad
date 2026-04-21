// Quick-response pendant, K=8.0 (≈ Tyco TY-B).
// Y-up in consumer; authored Z-up here, converted at render.
//
// @part head_pendant_qr_k80
// @kind sprinkler_head
// @category head.pendant.k80
// @display-name "Pendant Sprinkler QR K8.0 (3/4\" NPT)"
// @mfg tyco
// @mfg-pn TY-B
// @listing UL FM
// @hazard-classes OH1 OH2
// @price-usd 31.00
// @install-minutes 5
// @crew journeyman
// @k-factor 8.0
// @orientation pendant
// @response quick
// @temperature 155F
// @param size_in enum[0.5,0.75] default=0.75 label="Size" unit="in"
// @port inlet position=[0,0,0] direction=[0,0,-1] style=NPT_threaded size_in=0.75 role=drop

k = 8.0;
frame_d = 14;          // 1/2" NPT body
bulb_d = 3;
deflector_d = 34;
total_h = 58;
union() {
    cylinder(h = total_h * 0.55, d = frame_d, $fn = 32);
    translate([0, 0, total_h * 0.55])
        cylinder(h = total_h * 0.10, d1 = frame_d, d2 = frame_d * 0.6, $fn = 32);
    translate([0, 0, total_h * 0.70])
        sphere(d = bulb_d, $fn = 24);
    translate([0, 0, total_h - 2])
        cylinder(h = 2, d = deflector_d, $fn = 48);
}
