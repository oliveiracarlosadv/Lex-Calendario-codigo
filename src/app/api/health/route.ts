export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    app: "lex-calendario",
    version: process.env.LEX_DESKTOP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    desktop: process.env.LEX_DESKTOP === "1",
    time: new Date().toISOString(),
  });
}
