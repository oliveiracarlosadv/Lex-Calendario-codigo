// Gera src/infrastructure/local/migrations.generated.ts a partir de supabase/migrations/*.sql
// (usado pelo modo local / aplicativo desktop). Uso: node scripts/embed-migrations.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const entries = files.map((f) => `  { name: ${JSON.stringify(f)}, sql: ${JSON.stringify(readFileSync(`${dir}/${f}`, "utf8"))} },`);
writeFileSync(
  "src/infrastructure/local/migrations.generated.ts",
  `// Arquivo gerado por scripts/embed-migrations.mjs — não edite manualmente.\nexport const MIGRATIONS: { name: string; sql: string }[] = [\n${entries.join("\n")}\n];\n`,
);
console.log(`${files.length} migrations embutidas`);
