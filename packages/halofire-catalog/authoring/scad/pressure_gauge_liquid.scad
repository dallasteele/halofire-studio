// Liquid-filled pressure gauge, 3.5" face, 1/4" NPT stem.
face_d = 90;
face_t = 20;
stem_l = 35;
stem_d = 12;
union() {
    cylinder(h = face_t, d = face_d, $fn = 48);
    translate([0, 0, -stem_l / 2])
        cylinder(h = stem_l, d = stem_d, $fn = 20);
}
