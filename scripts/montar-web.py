#!/usr/bin/env python3
"""Monta a versão web do Lex Calendário (site estático para o GitHub Pages).

Uso: scripts/montar-web.py v1.2.3 <pasta-de-trabalho> [/Lex-Calendario]

Copia o projeto para a pasta de trabalho, tira o que só existe com servidor, aplica web/overlay
e gera o site em <pasta>/site. Só saem arquivos compilados: nenhum código-fonte vai para o site.
"""
import json, os, re, shutil, subprocess, sys
from pathlib import Path

version, work = sys.argv[1], Path(sys.argv[2]).resolve()
base = sys.argv[3] if len(sys.argv) > 3 else "/Lex-Calendario"
repo = Path(__file__).resolve().parent.parent
src = work / "src-web"

shutil.rmtree(src, ignore_errors=True)
src.mkdir(parents=True)
for item in ["src", "public", "package.json", "tsconfig.json", "postcss.config.mjs", "tailwind.config.ts", "components.json"]:
    p = repo / item
    (shutil.copytree if p.is_dir() else shutil.copy2)(p, src / item)
os.symlink(repo / "node_modules", src / "node_modules")

# O que só funciona com servidor
for rel in ["src/app/api", "src/app/local", "src/app/auth", "src/app/(auth)", "src/middleware.ts", "src/app/(app)/eventos/[id]",
            "src/app/(app)/clientes/[id]", "src/app/(app)/processos/[id]", "src/app/(app)/assinantes", "public/sw.js"]:
    p = src / rel
    shutil.rmtree(p) if p.is_dir() else p.unlink(missing_ok=True)

shutil.copytree(repo / "web/overlay/src", src / "src", dirs_exist_ok=True)
shutil.copy2(repo / "web/next.config.ts", src / "next.config.ts")

def sub(rel, fn):
    p = src / rel
    p.write_text(fn(p.read_text()))

BASE = 'process.env.NEXT_PUBLIC_BASE_PATH'
for rel in ["src/infrastructure/local/rest.ts", "src/application/backup/backup.ts", "src/application/sync/calendar-sync.ts", "src/infrastructure/integrations/google/google-calendar.ts"]:
    sub(rel, lambda s: s.replace('import "server-only";\n', ""))
for rel in ["src/application/backup/backup.ts", "src/application/sync/calendar-sync.ts"]:
    sub(rel, lambda s: s.replace(
        'import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";',
        'import { getSupabaseBrowserClient as getSupabaseAdminClient } from "@/infrastructure/supabase/client";'))
sub("src/application/sync/calendar-sync.ts", lambda s: s.replace('from "node:crypto"', 'from "@/infrastructure/web/sha1"'))
# A versão web só lê o Google: guarda a descrição do evento para mostrar no celular
sub("src/application/sync/calendar-sync.ts", lambda s: s.replace(
    "      // Convidado neste evento: guarda quem organiza e se pode alterar\n",
    "      description_text: ext.description ? htmlToText(ext.description) : null,\n      // Convidado neste evento: guarda quem organiza e se pode alterar\n", 1))
sub("src/components/layout/logo.tsx", lambda s: s.replace('src="/brand/app-icon.svg"', 'src={`${' + BASE + '}/brand/app-icon.svg`}')
    .replace('"url(/brand/olive-branch-mono.svg) center / contain no-repeat"', '`url(${' + BASE + '}/brand/olive-branch-mono.svg) center / contain no-repeat`'))
sub("src/lib/env.ts", lambda s: s.replace('privacy: "/privacidade.html"', 'privacy: `${' + BASE + '}/privacidade.html`').replace('terms: "/termos.html"', 'terms: `${' + BASE + '}/termos.html`'))
for rel in ["src/components/layout/app-shell.tsx", "src/components/settings/notifications-settings.tsx"]:
    sub(rel, lambda s: s.replace('register("/sw.js")', 'register(`${' + BASE + '}/sw.js`)'))

# Sem servidor não há páginas com endereço variável: /eventos/<id> vira /eventos/ver?id=<id>
link = re.compile(r"/(eventos|clientes|processos)/\$\{([^{}]+)\}")
for f in (src / "src").rglob("*.ts*"):
    if "/infrastructure/" in str(f) or "/application/" in str(f):
        continue
    text = f.read_text()
    new = link.sub(r"/\1/ver?id=${\2}", text)
    if new != text:
        f.write_text(new)

env = dict(os.environ, NEXT_TELEMETRY_DISABLED="1", NEXT_PUBLIC_LEX_LOCAL="1", NEXT_PUBLIC_LEX_WEB="1", NEXT_PUBLIC_BASE_PATH=base,
           NEXT_PUBLIC_APP_VERSION=version, NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID=json.loads((repo / "web/config.json").read_text())["googleClientId"], NEXT_PUBLIC_APP_URL="https://oliveiracarlosadv.github.io" + base,
           NEXT_PUBLIC_SUPABASE_URL="https://local.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY="lex-local", NEXT_PUBLIC_LICENSE_SERVER="", NEXT_PUBLIC_FULLCALENDAR_LICENSE_KEY="")
subprocess.run(["npx", "next", "build"], cwd=src, env=env, check=True)

site = work / "site"
shutil.rmtree(site, ignore_errors=True)
shutil.copytree(src / "out", site)
(site / ".nojekyll").write_text("")
shutil.copytree(repo / "web/auth-google", site / "auth-google")
(site / "404.html").write_text((repo / "web/404.html").read_text().replace("__BASE__", base))

files = []
for f in sorted(site.rglob("*")):
    rel = "/" + f.relative_to(site).as_posix()
    if f.is_file() and not rel.endswith((".map", ".txt", "404.html", ".nojekyll", "sw.js")) and "/404/" not in rel and "/_not-found/" not in rel:
        files.append(rel[:-len("index.html")] if rel.endswith("/index.html") else rel)
sw = (repo / "web/sw.js").read_text().replace("__VERSION__", version).replace("__BASE__", base).replace("__FILES__", json.dumps(files))
(site / "sw.js").write_text(sw)
leaks = [str(f) for f in site.rglob("*") if f.suffix in (".map", ".tsx") or f.name.startswith("client_secret")]
assert not leaks, leaks
size = sum(f.stat().st_size for f in site.rglob("*") if f.is_file())
print(f"Site pronto: {site} ({len(files)} arquivos, {size / 1e6:.1f} MB)")
