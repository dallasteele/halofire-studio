import fitz
PATH = r"G:\My Drive\untitled folder\MATERIALS SUBMITTAL.pdf"
doc = fitz.open(PATH)
out = r"E:\ClaudeBot\halofire-studio\docs\research\scanned"
import os; os.makedirs(out, exist_ok=True)
for p in [39,109,130,131,132,143]:
    pg = doc.load_page(p-1)
    pix = pg.get_pixmap(matrix=fitz.Matrix(2,2))
    fp = os.path.join(out, f"page{p}.png")
    pix.save(fp)
    print("wrote", fp)
