#!/usr/bin/env python3
"""Rebuild the link-preview image and app icon; with a domain, also make QR codes for printing.

Usage:   python3 make_images.py [your-domain.org]
Needs:   pip install qrcode playwright && python3 -m playwright install chromium
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
PUB, PRINT = ROOT, ROOT / "print"

CARD = """<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:M;src:url(FONTS/mukta-devanagari-800.woff2);font-weight:800}
@font-face{font-family:M;src:url(FONTS/mukta-devanagari-400.woff2);font-weight:400}
@font-face{font-family:L;src:url(FONTS/mukta-latin-800.woff2);font-weight:800}
@font-face{font-family:L;src:url(FONTS/mukta-latin-400.woff2);font-weight:400}
html,body{margin:0}
body{width:1200px;height:630px;background:#2B1747;color:#fff;font-family:L,M,sans-serif;display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box}
.f{flex:none;display:flex;flex-direction:column;gap:22px;font-family:M;font-weight:800;font-size:36px}
img{filter:drop-shadow(0 6px 14px rgba(0,0,0,.35))}
h1{font-family:M,L;font-weight:800;font-size:80px;line-height:1.1;margin:0}
.s{font-size:38px;color:#CBB8EA;margin:8px 0 30px}
.q{font-family:M,L;font-size:44px;font-weight:800;margin:0}
.e{font-size:32px;color:#CBB8EA;margin:6px 0 0}
</style></head><body>
<div class="f"><img src="FLAG" width="210" height="140">सत्यमेव जयते</div>
<div><h1>जनता का मंतर</h1><p class="s">डिजिटल जंतर मंतर / The digital Jantar Mantar</p>
<p class="q">अगर आप जा पाते, तो क्या आप वहाँ होते?</p><p class="e">If you could, would you be there?</p></div>
</body></html>"""

def images():
    from playwright.sync_api import sync_playwright
    tmp = PUB / "_card.html"
    tmp.write_text(CARD.replace("FONTS", PUB.as_uri()).replace("FLAG", (PUB / "flag.svg").as_uri()), encoding="utf-8")
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": 1200, "height": 630})
            pg.goto(tmp.as_uri()); pg.wait_for_timeout(400)
            pg.screenshot(path=str(PUB / "og.png"))
            pg = b.new_page(viewport={"width": 512, "height": 512})
            pg.goto((PUB / "icon.svg").as_uri()); pg.wait_for_timeout(200)
            pg.screenshot(path=str(PUB / "icon-512.png"), omit_background=True)
            b.close()
    finally:
        tmp.unlink()

def qr(domain):
    import qrcode, qrcode.image.svg
    PRINT.mkdir(exist_ok=True)
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, border=2)
    q.add_data(f"https://{domain}/"); q.make(fit=True)
    q.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(str(PRINT / "qr.svg"))
    q.make_image(fill_color="#2B1747", back_color="white").save(str(PRINT / "qr.png"))

if __name__ == "__main__":
    images()
    if len(sys.argv) > 1:
        qr(sys.argv[1].removeprefix("https://").strip("/"))
    print("Done.")
