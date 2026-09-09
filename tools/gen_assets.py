"""Render the README, website, and Chrome Web Store images with headless
Chrome. Every image is a real render of the real popup, welcome page,
settings page, and content.css, with a small fake chrome.* object so the
pages run outside the browser extension runtime. No mockups.

Usage:  python3 tools/gen_assets.py
Needs Google Chrome; set CHROME to point at another Chromium binary."""
import pathlib, re, subprocess, html

import os, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
SCR = pathlib.Path(tempfile.mkdtemp(prefix="dyslexaid-scenes-"))
CHROME = os.environ.get(
    "CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)

MOCK = """<script>
const store = %s;
window.chrome = {
  storage: { sync: {
    get: (k, cb) => { const r = k === null ? {...store} : typeof k === "string" ? {[k]: store[k]} : {...store}; cb && cb(r); return Promise.resolve(r); },
    set: (o) => { Object.assign(store, o); return Promise.resolve(); },
    clear: () => Promise.resolve(),
  }, onChanged: { addListener: () => {} } },
  tabs: { query: () => Promise.resolve([{ id: 1, url: "https://en.wikipedia.org/wiki/Dyslexia" }]), sendMessage: () => Promise.resolve(), create: () => {} },
  runtime: { openOptionsPage: () => {}, onMessage: { addListener: () => {} } },
};
</script>"""

DYSLEXIA = '{ font: true, spacing: true, bionic: true, tint: true, tintColor: "cream", bionicStrength: 0.4, textZoom: 100 }'

# Font faces that work from file:// (content.css uses chrome-extension:// URLs).
FONTS = f"""<style>
@font-face {{ font-family: "OpenDyslexic"; src: url("file://{ROOT}/fonts/OpenDyslexic-Regular.woff2") format("woff2"); font-weight: 400; }}
@font-face {{ font-family: "OpenDyslexic"; src: url("file://{ROOT}/fonts/OpenDyslexic-Bold.woff2") format("woff2"); font-weight: 700; }}
</style>"""

def shoot(name, width, height, scale, url, out):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--allow-file-access-from-files", f"--force-device-scale-factor={scale}",
                    f"--window-size={width},{height}", "--virtual-time-budget=6000",
                    f"--screenshot={out}", url], check=True, capture_output=True)
    print("wrote", out.relative_to(ROOT))

# ---------- 1. popup ----------
popup_html = (ROOT / "popup/popup.html").read_text()
body = re.search(r"<body>(.*)</body>", popup_html, re.S).group(1)
body = body.replace('<script src="popup.js"></script>', "")
scene = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<base href="file://{ROOT}/popup/"><link rel="stylesheet" href="popup.css">
<style>body{{margin:0}} html{{background:#fffaf0}}</style>{MOCK % DYSLEXIA}</head>
<body>{body}<script src="popup.js"></script>
<script>setTimeout(() => document.querySelector('[data-feature=bionic]').dispatchEvent(new MouseEvent('mouseover', {{bubbles: true}})), 300);</script>
</body></html>"""
(SCR / "scene_popup.html").write_text(scene)
shoot("popup", 700, 559, 2, f"file://{SCR}/scene_popup.html", ROOT / "docs/img/popup.png")

# ---------- 2. article, before and after ----------
ARTICLE = """
<h1>Why reading on screens is hard</h1>
<p>For readers with dyslexia, a wall of tightly packed text in a thin typeface can feel like an obstacle course. Letters mirror and swap, lines blur together, and by the time the eye reaches the end of a long line, finding the start of the next one is a small act of navigation. How hard this feels has nothing to do with intelligence or effort. It comes down to how the page is presented, and presentation can be changed.</p>
<p>Small changes make outsized differences. Wider letter spacing keeps characters from crowding. Taller line height gives each line room to breathe. Bolding the first part of every word gives the eye an anchor, so reading becomes a glide from anchor to anchor instead of a letter-by-letter decode. A warm background softens the glare that makes white screens exhausting.</p>
<p>Links are part of the picture too. Many sites style <a href="#">links without underlines</a>, leaving color as the only clue, and <a href="#">color alone is easy to miss</a>. The underline toggle puts them back.</p>
"""
BASE_CSS = """body{font-family:Georgia,serif;margin:0;padding:28px 34px;color:#222;background:#fff;font-size:17px;line-height:1.35}
h1{font-size:28px;margin:0 0 14px;border-bottom:2px solid #ddd;padding-bottom:8px}
p{margin:0 0 12px;text-align:justify}a{color:#0a58ca;text-decoration:none}"""
BIONIC = """<script>
const SKIP=new Set(["SCRIPT","STYLE","B"]);const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(n){if(!n.nodeValue.trim())return 2;for(let e=n.parentElement;e;e=e.parentElement)if(SKIP.has(e.tagName))return 2;return 1}});
const nodes=[];while(w.nextNode())nodes.push(w.currentNode);
for(const n of nodes){const f=document.createDocumentFragment();for(const p of n.nodeValue.split(/(\\s+)/)){if(!p.trim()||p.length<2){f.appendChild(document.createTextNode(p));continue}const c=Math.max(1,Math.ceil(p.length*0.4));const b=document.createElement("b");b.className="dyslexaid-bionic";b.textContent=p.slice(0,c);f.appendChild(b);f.appendChild(document.createTextNode(p.slice(c)))}n.parentNode.replaceChild(f,n)}
</script>"""
before = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>{BASE_CSS}</style></head><body>{ARTICLE}</body></html>"""
after = f"""<!DOCTYPE html><html lang="en" data-dyslexaid-font="on" data-dyslexaid-spacing="on" data-dyslexaid-bionic="on" data-dyslexaid-tint="cream" data-dyslexaid-ruler="on" data-dyslexaid-links="on"><head><meta charset="utf-8">
<style>{BASE_CSS}</style><link rel="stylesheet" href="file://{ROOT}/content/content.css">{FONTS}
<style>#dyslexaid-ruler{{top:196px}}</style></head><body>{ARTICLE}<div id="dyslexaid-ruler" style="height:42px"></div>{BIONIC}</body></html>"""
(SCR / "article_before.html").write_text(before)
(SCR / "article_after.html").write_text(after)

pair = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:#fffaf0;font-family:-apple-system,"Segoe UI",system-ui,sans-serif}}
.wrap{{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px}}
.col h2{{margin:0 0 10px;font-size:20px;color:#5c5346}}
iframe{{width:100%;height:606px;border:1px solid #e3d3b3;border-radius:12px;background:#fff;box-shadow:0 6px 24px rgba(0,0,0,.12)}}
</style></head><body><div class="wrap">
<div class="col"><h2>Before</h2><iframe src="file://{SCR}/article_before.html"></iframe></div>
<div class="col"><h2>After: font, spacing, bold word starts, tint, ruler, underlines</h2><iframe src="file://{SCR}/article_after.html"></iframe></div>
</div></body></html>"""
(SCR / "scene_pair.html").write_text(pair)
shoot("pair", 1200, 700, 2, f"file://{SCR}/scene_pair.html", ROOT / "docs/img/before-after.png")

# ---------- 3. store screenshot, exactly 1280x800 ----------
store = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:1280px;height:800px;overflow:hidden;background:#f3ebdb;position:relative;font-family:-apple-system,"Segoe UI",system-ui,sans-serif}}
.page{{position:absolute;left:0;top:0;width:1280px;height:800px;border:0}}
.popup{{position:absolute;right:36px;top:44px;width:700px;height:559px;border:0;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.35);background:#fffaf0}}
.badge{{position:absolute;left:36px;bottom:36px;background:#b84a18;color:#fff;font-size:26px;font-weight:700;padding:14px 22px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.25)}}
</style></head><body>
<iframe class="page" src="file://{SCR}/article_after.html"></iframe>
<iframe class="popup" src="file://{SCR}/scene_popup.html"></iframe>
<div class="badge">One click. Nothing leaves your browser.</div>
</body></html>"""
(SCR / "scene_store.html").write_text(store)
shoot("store", 1280, 800, 1, f"file://{SCR}/scene_store.html", ROOT / "store/screenshot-1280x800.png")
shoot("store-site", 1280, 800, 1, f"file://{SCR}/scene_store.html", ROOT / "docs/img/store-screenshot.png")

# ---------- 4. promo tile 440x280 and marquee 1400x560 ----------
def brand(w, h, title_size, tag_size, icon, pad, tagline):
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">{FONTS}<style>
body{{margin:0;width:{w}px;height:{h}px;overflow:hidden;background:linear-gradient(135deg,#b84a18,#963a15);color:#fff;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;display:flex;align-items:center;gap:{pad}px;padding:0 {pad}px;box-sizing:border-box}}
img{{width:{icon}px;height:{icon}px;border-radius:22%;box-shadow:0 8px 24px rgba(0,0,0,.3)}}
h1{{margin:0;font-size:{title_size}px;line-height:1.05}}p{{margin:8px 0 0;font-size:{tag_size}px;opacity:.95}}
.sample{{margin-top:14px;background:#faf4e3;color:#2b2b2b;border-radius:12px;padding:12px 16px;font-family:"OpenDyslexic",sans-serif;font-size:{tag_size*0.9:.0f}px;line-height:1.5}}
.sample b{{font-weight:700}}
</style></head><body><img src="file://{ROOT}/icons/icon128.png" alt=""><div><h1>DyslexAid</h1><p>{tagline}</p>
<div class="sample"><b>Rea</b>ding <b>sh</b>ould <b>fe</b>el <b>ea</b>sy.</div></div></body></html>"""
(SCR / "scene_tile.html").write_text(brand(440, 280, 40, 17, 92, 26, "Make any page easier to read"))
shoot("tile", 440, 280, 1, f"file://{SCR}/scene_tile.html", ROOT / "store/promo-440x280.png")
(SCR / "scene_marquee.html").write_text(brand(1400, 560, 84, 34, 200, 70, "A free Chrome extension for dyslexia, ADHD, and low vision"))
shoot("marquee", 1400, 560, 1, f"file://{SCR}/scene_marquee.html", ROOT / "store/marquee-1400x560.png")

# ---------- 5. store screenshots 2 and 3: welcome page, settings page ----------
welcome_html = (ROOT / "welcome/welcome.html").read_text()
wbody = re.search(r"<body>(.*)</body>", welcome_html, re.S).group(1)
wbody = re.sub(r"<script[^>]*></script>", "", wbody)
welcome_scene = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<base href="file://{ROOT}/welcome/"><link rel="stylesheet" href="../content/content.css"><link rel="stylesheet" href="welcome.css">{FONTS}
<style>body{{margin:0}}</style>{MOCK % DYSLEXIA}</head><body>{wbody}
<script src="../content/content.js"></script><script src="welcome.js"></script>
<script>setTimeout(() => {{ document.getElementById("status").textContent = "Dyslexia preset is on. Look at the sample below, then open any page."; }}, 200);</script>
</body></html>"""
(SCR / "scene_welcome.html").write_text(welcome_scene)
shoot("welcome", 1280, 800, 1, f"file://{SCR}/scene_welcome.html", ROOT / "store/screenshot-2-welcome-1280x800.png")

options_html = (ROOT / "options/options.html").read_text()
obody = re.search(r"<body>(.*)</body>", options_html, re.S).group(1)
obody = re.sub(r"<script[^>]*></script>", "", obody)
OPTS = '{ font: true, spacing: true, bionic: true, tint: true, tintColor: "cream", bionicStrength: 0.4, rulerHeight: 42, ttsRate: 1, pausedSites: ["mail.google.com", "docs.google.com"] }'
options_scene = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<base href="file://{ROOT}/options/"><link rel="stylesheet" href="options.css">{FONTS}
<style>body{{margin:0}}</style>{MOCK % OPTS}</head><body>{obody}
<script src="options.js"></script></body></html>"""
(SCR / "scene_options.html").write_text(options_scene)
shoot("options", 1280, 800, 1, f"file://{SCR}/scene_options.html", ROOT / "store/screenshot-3-settings-1280x800.png")
