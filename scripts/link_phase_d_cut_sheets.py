"""Post-process phase_d_manifest.json: set cut_sheet_local for every entry
whose cut_sheet_url matches a locally-downloaded PDF."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "data" / "phase_d_manifest.json"
CUT_DIR = ROOT / "packages" / "halofire-catalog" / "cut_sheets"

# URL -> repo-relative local path
URL_TO_LOCAL = {
    "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/Y5s5g2HZNr6Um_t5iOK7dw/content":
        "packages/halofire-catalog/cut_sheets/tyco_ty3251_tyb.pdf",
    "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/SaNvVA0m0tcMxD6OxwC90Q/content":
        "packages/halofire-catalog/cut_sheets/tyco_ty4251_k80.pdf",
    "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/1BlAbiphbAgwMOTfSiHCug/content":
        "packages/halofire-catalog/cut_sheets/tyco_av1_300.pdf",
    "https://www.vikinggroupinc.com/sites/default/files/databook/current_tds/052014.pdf":
        "packages/halofire-catalog/cut_sheets/viking_vk100.pdf",
    "https://www.reliablesprinkler.com/files/bulletins/033.pdf":
        "packages/halofire-catalog/cut_sheets/reliable_f1res_bul033.pdf",
    "https://www.reliablesprinkler.com/files/bulletins/182.pdf":
        "packages/halofire-catalog/cut_sheets/reliable_f156_bul182.pdf",
    "https://assets.victaulic.com/assets/uploads/literature/10.02.pdf":
        "packages/halofire-catalog/cut_sheets/victaulic_005h.pdf",
    "https://assets.victaulic.com/assets/uploads/literature/10.03.pdf":
        "packages/halofire-catalog/cut_sheets/victaulic_009n.pdf",
    "https://assets.victaulic.com/assets/uploads/literature/06.33.pdf":
        "packages/halofire-catalog/cut_sheets/victaulic_107v.pdf",
    "https://assets.victaulic.com/assets/uploads/literature/51.01.pdf":
        "packages/halofire-catalog/cut_sheets/victaulic_51_01.pdf",
}

data = json.loads(MANIFEST.read_text(encoding="utf-8"))
linked = 0
for e in data["entries"]:
    url = e.get("cut_sheet_url")
    if url and url in URL_TO_LOCAL:
        local = URL_TO_LOCAL[url]
        if (ROOT / local).exists():
            e["cut_sheet_local"] = local
            linked += 1

MANIFEST.write_text(
    json.dumps(data, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(f"Linked {linked} entries to local cut sheets")
