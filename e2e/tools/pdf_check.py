"""Confere o PDF da apresentação: páginas 16:9, fontes incorporadas, imagens, links (sem token/credencial) e texto de identificação de exemplo.
Uso: python e2e/tools/pdf_check.py <arquivo.pdf>  → imprime JSON. Só leitura."""
import json, re, sys
import fitz  # PyMuPDF

doc = fitz.open(sys.argv[1])
out = {"pages": doc.page_count, "sizes": sorted({(round(p.rect.width), round(p.rect.height)) for p in doc}), "ratio_ok": True, "fonts": {}, "fonts_not_embedded": [], "images": 0, "links": [], "bad_links": [], "demo_pages": 0, "tiny_text_pages": [], "percent_pages": [], "text_all": ""}
for i, page in enumerate(doc):
    if abs(page.rect.width / page.rect.height - 16 / 9) > 0.01: out["ratio_ok"] = False
    for f in doc.get_page_fonts(i):
        xref, ext, typ, base, name, enc = f[:6]
        out["fonts"][base] = out["fonts"].get(base, 0) + 1
        data = doc.extract_font(xref)[3] if xref else b""
        out.setdefault("font_types", {})[typ] = out.get("font_types", {}).get(typ, 0) + 1
        # Type3 = glifos incorporados como desenho (o Chromium faz isso com fontes variáveis); o texto continua selecionável. Só conta como "não incorporada" a fonte que NÃO é Type3 e não tem arquivo.
        if typ != "Type3" and not data and base not in out["fonts_not_embedded"]: out["fonts_not_embedded"].append(base)
    out["images"] += len(page.get_images(full=True))
    for l in page.get_links():
        uri = l.get("uri")
        if uri:
            out["links"].append({"page": i + 1, "uri": uri})
            if re.search(r"(access_token|refresh_token|token=|eyJ[A-Za-z0-9_-]{20,}|password|senha|apikey)", uri, re.I): out["bad_links"].append(uri)
    txt = page.get_text()
    out["text_all"] += txt.replace("\xa0", " ") + "\n"
    if re.search(r"\d\s?%", txt): out["percent_pages"].append(i + 1)   # percentual no documento: só com medida e fonte que o sustentem (nenhum hoje)
    if "exemplo ilustrativo" in txt.lower(): out["demo_pages"] += 1
    sizes = [s["size"] for b in page.get_text("dict")["blocks"] if b.get("type") == 0 for ln in b["lines"] for s in ln["spans"] if s["text"].strip()]
    if sizes: out.setdefault("min_pt", {})[i + 1] = round(min(sizes), 1)
    if sizes and min(sizes) < 7: out["tiny_text_pages"].append(i + 1)   # pontos do PDF (1280px = 960pt): < 7pt é pequeno demais (o texto da interface do celular, reduzida, chega a ~7,3pt)
print(json.dumps(out))
