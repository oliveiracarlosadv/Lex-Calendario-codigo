"""Gera docs/privacidade.html e docs/termos.html a partir de PRIVACIDADE.md e TERMOS.md.
Uso: python3 scripts/build-legal-pages.py"""
import html, re

def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", lambda m: f'<a href="{m.group(2).replace("PRIVACIDADE.md","privacidade.html").replace("TERMOS.md","termos.html")}">{m.group(1)}</a>', t)
    t = re.sub(r"&lt;(https?://[^&]+)&gt;", r'<a href="\1">\1</a>', t)
    return t

def convert(md):
    out, lines, i = [], md.splitlines(), 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1; continue
        if line.startswith("# "):
            out.append(f"<h1>{inline(line[2:])}</h1>")
        elif line.startswith("## "):
            out.append(f"<h2>{inline(line[3:])}</h2>")
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip("|").split("|")]); i += 1
            head, body = rows[0], [r for r in rows[2:]]
            out.append("<div class='table'><table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                       + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body) + "</tbody></table></div>")
            continue
        elif re.match(r"^(- |\d+\. )", line):
            ordered = bool(re.match(r"^\d+\. ", line))
            tag = "ol" if ordered else "ul"
            items = []
            while i < len(lines) and (re.match(r"^(- |\d+\. )", lines[i]) or lines[i].startswith("   ")):
                l = lines[i]
                if l.startswith("   "):
                    items[-1][1].append(re.sub(r"^\s*- ", "", l))
                else:
                    items.append([re.sub(r"^(- |\d+\. )", "", l), []])
                i += 1
            out.append(f"<{tag}>" + "".join(
                f"<li>{inline(t)}" + ("<ul>" + "".join(f"<li>{inline(s)}</li>" for s in sub) + "</ul>" if sub else "") + "</li>"
                for t, sub in items) + f"</{tag}>")
            continue
        else:
            para = [line]
            while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r"^(#|- |\d+\. |\|)", lines[i + 1]):
                i += 1; para.append(lines[i])
            out.append("<p>" + "<br>".join(inline(p) for p in para) + "</p>")
        i += 1
    return "\n".join(out)

PAGE = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Lex Calendário</title>
<meta name="description" content="{title} do Lex Calendário, agenda jurídica para advogados.">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<style>
:root{{--bg:#fbfbfa;--fg:#1d1d1f;--muted:#6e6e73;--card:#fff;--line:#e8e8ed;--olive:#556b2f}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0b0d0c;--fg:#f5f5f7;--muted:#a1a1a6;--card:#161816;--line:#2a2d2a;--olive:#b4c97f}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
main{{max-width:760px;margin:0 auto;padding:0 16px 64px}}
header{{display:flex;align-items:center;justify-content:space-between;padding:20px 0;gap:12px;flex-wrap:wrap}}
.brand{{display:flex;gap:10px;align-items:center;font-weight:600;color:var(--fg);text-decoration:none}}.brand img{{width:28px;height:28px}}
nav a{{color:var(--muted);text-decoration:none;margin-left:16px;font-size:14px}}nav a:hover,nav a.on{{color:var(--fg)}}
h1{{font-size:clamp(28px,5vw,40px);letter-spacing:-.03em;line-height:1.15;margin:32px 0 8px}}
h2{{font-size:20px;letter-spacing:-.01em;margin:36px 0 8px}}
p,li{{color:var(--fg)}}a{{color:var(--olive)}}code{{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:.9em}}
.table{{overflow-x:auto;border:1px solid var(--line);border-radius:14px;margin:16px 0}}table{{border-collapse:collapse;width:100%;font-size:14.5px}}
th,td{{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}}th{{background:var(--card)}}tr:last-child td{{border-bottom:0}}
footer{{color:var(--muted);font-size:13px;border-top:1px solid var(--line);margin-top:48px;padding-top:20px}}
</style>
</head>
<body><main>
<header><a class="brand" href="/calendario"><img src="/brand/app-icon.svg" alt="">Lex Calendário</a>
<nav><a href="/calendario">Voltar ao app</a><a href="privacidade.html"{on_p}>Privacidade</a><a href="termos.html"{on_t}>Termos de Uso</a></nav></header>
{body}
<footer>© 2026 Carlos A. A. Oliveira · Lex Calendário · <a href="privacidade.html">Política de Privacidade</a> · <a href="termos.html">Termos de Uso</a></footer>
</main></body></html>
"""

# Páginas servidas pelo próprio app (sem site público)
for src, dst, title in [("PRIVACIDADE.md", "public/privacidade.html", "Política de Privacidade"), ("TERMOS.md", "public/termos.html", "Termos de Uso")]:
    body = convert(open(src, encoding="utf-8").read())
    open(dst, "w", encoding="utf-8").write(PAGE.format(title=title, body=body,
        on_p=' class="on"' if "priv" in dst else "", on_t=' class="on"' if "termos" in dst else ""))
    print("gerado", dst)
