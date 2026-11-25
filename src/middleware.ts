import type { NextRequest } from "next/server";
import { updateSession } from "@/infrastructure/supabase/middleware";

export function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // O envio do pacote de atualização (centenas de MB) não passa pelo middleware, que limitaria o tamanho do corpo
  matcher: ["/((?!_next/static|_next/image|local/|api/desktop/atualizacao/arquivo|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
