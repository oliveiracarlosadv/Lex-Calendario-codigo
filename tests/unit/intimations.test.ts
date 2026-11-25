import { describe, expect, it } from "vitest";
import { publicationDate, tacitAwarenessDate } from "@/application/monitoring/intimations";
import { isAddressedTo, stripHtml } from "@/infrastructure/tribunals/djen-connector";

describe("datas das intimações", () => {
  it("publicação é o 1º dia útil após a disponibilização (Lei 11.419/2006, art. 4º, §3º)", () => {
    expect(publicationDate("2026-10-06")).toBe("2026-10-07"); // terça → quarta
    expect(publicationDate("2026-10-09")).toBe("2026-10-13"); // sexta → segunda é feriado (12/10) → terça
  });
  it("ciência tácita no PJe ocorre 10 dias corridos após a disponibilização", () => {
    expect(tacitAwarenessDate("2026-10-06")).toBe("2026-10-16");
  });
});

describe("DJEN", () => {
  const item = { id: 1, numero_processo: "0", destinatarioadvogados: [{ advogado: { nome: "X", numero_oab: "012345", uf_oab: "PA" } }] };
  it("confere o destinatário pela OAB e UF", () => {
    expect(isAddressedTo(item, "12345", "pa")).toBe(true);
    expect(isAddressedTo(item, "12345", "SP")).toBe(false);
    expect(isAddressedTo(item, "54321", "PA")).toBe(false);
  });
  it("limpa HTML do texto", () => {
    expect(stripHtml("<p>Intime-se&nbsp;a parte.</p><br>Prazo &amp; forma")).toBe("Intime-se a parte.\n\nPrazo & forma");
  });
});
