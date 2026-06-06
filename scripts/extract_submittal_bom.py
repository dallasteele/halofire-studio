import sys, re, fitz, json
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PATH = r"G:\My Drive\untitled folder\MATERIALS SUBMITTAL.pdf"
OUT = r"E:\ClaudeBot\halofire-studio\docs\research\submittal-pages.txt"
doc = fitz.open(PATH)

MFRS = ["Victaulic","Argco","Potter","Roemer","Romer","Watts","Reliable","Viking",
        "Wheatland","Bull Moose","Bullmoose","Tyco","TYCO","Globe","Senju","AGF","Anvil","Gruvlok"]
# part-number-ish tokens: letter/digit mixes, styles, figure/series codes
PN = re.compile(r"\b(?:Style|Series|Model|Fig\.?|Figure|No\.?|Cat\.?)\s*[A-Z0-9][A-Z0-9\-/]{1,12}\b", re.I)
CODE = re.compile(r"\b[A-Z]{1,4}\d{2,5}[A-Z0-9\-]*\b")  # e.g. TY1151, TFP151, W07

lines_out = []
rows = []
for i in range(doc.page_count):
    t = doc.load_page(i).get_text()
    textlen = len(t.strip())
    nonempty = [l.strip() for l in t.splitlines() if l.strip()]
    mfr = sorted({m for m in MFRS if m.lower() in t.lower()})
    pns = []
    for rgx in (PN, CODE):
        pns += rgx.findall(t)
    # dedupe preserve order, cap
    seen=set(); pnlist=[]
    for p in pns:
        p=p.strip()
        if p.lower() not in seen and len(p)>=4:
            seen.add(p.lower()); pnlist.append(p)
    pnlist = pnlist[:18]
    head = nonempty[:6]
    rows.append({"page": i+1, "textlen": textlen, "mfr": mfr, "scanned": textlen < 40,
                 "head": head, "codes": pnlist})
    lines_out.append(f"--- p{i+1} | mfr={mfr or '?'} | textlen={textlen}{' | SCANNED/IMAGE' if textlen<40 else ''}")
    for h in head:
        lines_out.append(f"    {h[:90]}")
    if pnlist:
        lines_out.append(f"    CODES: {', '.join(pnlist)}")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_out))
with open(OUT.replace('.txt','.json'), "w", encoding="utf-8") as f:
    json.dump(rows, f, indent=1)

# summary
scanned = [r["page"] for r in rows if r["scanned"]]
print("pages:", doc.page_count, "| scanned/image pages:", len(scanned))
print("scanned pages:", scanned)
from collections import Counter
c = Counter()
for r in rows:
    for m in r["mfr"]:
        c[m]+=1
print("mfr page counts:", dict(c.most_common()))
print("wrote:", OUT)
