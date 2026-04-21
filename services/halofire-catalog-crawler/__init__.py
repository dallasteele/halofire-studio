"""HaloFire catalog web crawler — keep parts DB current.

LandScout-pattern three-tier agent:
  Tier 0: HTTP scrape with retry + timeout (FREE, no API key)
  Tier 1: Gemma 4 spec-extraction from scraped HTML (FREE on local GPU)
  Tier 2: Claude / Gemini escalation for malformed datasheets (COSTS)

Event-driven: wakes when a BOM references a SKU not in the catalog,
or on a 4×/week schedule. Falls back to a 6h idle check.

Targets (Phase 4.3, sprinkler heads first):
  * tyco-fire.com
  * vikinggroup.com
  * reliablesprinkler.com
  * victaulic.com
  * globesprinkler.com
  * senjusprinkler.co.jp

Each scraped SKU becomes a CatalogEntry row + triggers
render_from_catalog.py to fab the GLB.
"""
