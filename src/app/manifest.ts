import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lex Calendário",
    short_name: "Lex",
    description: "Calendário inteligente para advogados e escritórios de advocacia.",
    start_url: "/calendario",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#556B2F",
    lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
