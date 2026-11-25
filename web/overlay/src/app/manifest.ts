import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${base}/`,
    name: "Lex Calendário",
    short_name: "Lex Calendário",
    description: "Calendário inteligente para advogados e escritórios de advocacia.",
    start_url: `${base}/calendario/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "any",
    background_color: "#141415",
    theme_color: "#556B2F",
    lang: "pt-BR",
    categories: ["productivity", "business"],
    icons: [
      { src: `${base}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
