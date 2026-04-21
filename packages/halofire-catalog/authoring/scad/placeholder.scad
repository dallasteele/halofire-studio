// Category-colored placeholder box for any catalog entry without a
// dedicated template. Better than a missing mesh in the viewport.
//
// Intentionally marked @kind structural (obstruction-style bbox) —
// it's a demo stand-in with no pipe connection, so no @port.

// @part placeholder
// @kind structural
// @category arch.placeholder
// @display-name "Placeholder Box (100mm)"
// @mfg other
// @mfg-pn PLACEHOLDER
// @price-usd 0.00
// @install-minutes 5
// @crew apprentice
// @param dim_l_mm number[10,1000] default=100 label="Length" unit="mm"

dim_l_mm = 100;
dim_d_mm = 100;
dim_h_mm = 100;

cube(size = [dim_l_mm, dim_d_mm, dim_h_mm], center = true);
