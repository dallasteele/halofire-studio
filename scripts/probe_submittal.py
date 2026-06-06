import sys, fitz  # PyMuPDF
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PATH = r"G:\My Drive\untitled folder\MATERIALS SUBMITTAL.pdf"
doc = fitz.open(PATH)
print("PAGE_COUNT:", doc.page_count)
print("=== TOC / bookmarks ===")
toc = doc.get_toc()
if toc:
    for lvl, title, page in toc[:80]:
        print(f"  {'  '*(lvl-1)}p{page}: {title}")
else:
    print("  (no embedded TOC)")

print("=== first-page text (p1-2) ===")
for i in range(min(2, doc.page_count)):
    t = doc.load_page(i).get_text().strip()
    print(f"--- page {i+1} ---")
    print(t[:1500])

# scan all pages for manufacturer mentions to map where each lives
mfrs = ["Victaulic","Argco","Potter","Roemer","Romer","Watts","Reliable","Viking","Wheatland","Bull Moose","Bullmoose","Tyco","Globe","Senju","AGF"]
hits = {m: [] for m in mfrs}
for i in range(doc.page_count):
    t = doc.load_page(i).get_text()
    low = t.lower()
    for m in mfrs:
        if m.lower() in low:
            hits[m].append(i+1)
print("=== manufacturer page hits (count + first pages) ===")
for m in mfrs:
    pg = hits[m]
    if pg:
        print(f"  {m}: {len(pg)} pages, first={pg[:8]}")
