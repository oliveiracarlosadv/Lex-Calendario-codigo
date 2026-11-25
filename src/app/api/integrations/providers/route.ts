export const dynamic = "force-dynamic";

/** Quais contas podem ser conectadas nesta instalação (credenciais OAuth do aplicativo presentes). */
export function GET() {
  return Response.json({
    // O Google exige o client secret na troca do código (inclusive para apps de computador)
    google: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    microsoft: !!process.env.MICROSOFT_CLIENT_ID,
    caldav: true,
  });
}
