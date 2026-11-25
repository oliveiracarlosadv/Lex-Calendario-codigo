/** Cabeçalho do escritório (logomarca, nome e endereço) usado nos relatórios e documentos. */
export interface OfficeIdentity {
  name: string;
  document?: string | null;
  settings?: { logo?: string | null; address?: string | null; phone?: string | null } | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Só imagens embutidas (PNG, JPEG ou WebP) de até ~300 KB. */
export const isValidLogo = (logo: string | null | undefined): logo is string =>
  !!logo && logo.length <= 420_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo);

export function officeHeaderHtml(office: OfficeIdentity, opts: { logo?: boolean } = {}) {
  const s = office.settings ?? {};
  const lines = [s.address, s.phone].map((v) => (v ?? "").trim()).filter(Boolean);
  const logo = opts.logo !== false && isValidLogo(s.logo) ? `<img src="${s.logo}" alt="" style="max-height:72px;max-width:220px;object-fit:contain">` : "";
  if (!logo && !lines.length && !office.name) return "";
  return `<table role="presentation" style="width:100%;border-collapse:collapse;border-bottom:1px solid #d2d2d7;margin:0 0 18px"><tr>
${logo ? `<td style="width:1%;padding:0 16px 12px 0;border:0;vertical-align:middle">${logo}</td>` : ""}
<td style="padding:0 0 12px;border:0;vertical-align:middle;font-family:-apple-system,'Segoe UI',Arial,sans-serif;text-align:left">
<div style="font-size:15px;font-weight:600;color:#1d1d1f">${esc(office.name)}</div>
${lines.map((l) => `<div style="font-size:11px;color:#6e6e73;white-space:pre-line">${esc(l)}</div>`).join("\n")}
</td></tr></table>`;
}
