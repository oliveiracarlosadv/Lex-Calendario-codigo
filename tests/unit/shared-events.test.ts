import { describe, expect, it, vi } from "vitest";
import { decodeShared, encodeShared, type SharedPayload } from "@/infrastructure/integrations/shared-payload";

vi.mock("@/infrastructure/supabase/server", () => ({ getSupabaseAdminClient: () => ({}) }));

describe("dados do Lex que acompanham o evento no Google", () => {
  const payload: SharedPayload = {
    v: 1,
    by: "organizador@exemplo.com",
    ro: false,
    kind: "hearing",
    priority: "high",
    status: "scheduled",
    hm: "online",
    ck: [{ t: "Levar documentos", d: true }],
    cm: Array.from({ length: 12 }, (_, i) => ({ i: `c${i}`, n: "Ana Ç 😀", e: "ana@exemplo.com", t: "2026-10-09T12:00:00.000Z", b: `Comentário ${i} `.repeat(30) })),
  };
  it("vai e volta em pedaços de até 1024 caracteres", () => {
    const props = encodeShared(payload);
    expect(Object.values(props).every((v) => v.length <= 1024)).toBe(true);
    expect(Number(props.lexn)).toBeGreaterThan(1);
    expect(decodeShared(props)).toEqual(payload);
  });
  it("descarta os comentários mais antigos quando não cabe e ignora dados inválidos", () => {
    const big = { ...payload, cm: Array.from({ length: 80 }, (_, i) => ({ i: `c${i}`, n: "A", e: null, t: "2026-10-09T12:00:00.000Z", b: "x".repeat(1400) })) };
    const back = decodeShared(encodeShared(big))!;
    expect(back.cm.length).toBeLessThan(80);
    expect(back.cm.at(-1)!.i).toBe("c79");
    expect(decodeShared({ lexn: "2", lex0: "{" })).toBeNull();
    expect(decodeShared(undefined)).toBeNull();
  });
});

describe("resposta por e-mail vira comentário", async () => {
  const { extractReplyText } = await import("@/application/communications/replies");
  it("fica só com o texto novo, sem a mensagem citada", () => {
    const raw = "Pode ser na quinta às 10h.\n\nObrigado!\n\nEm qui., 9 de out. de 2026 às 18:40, Carlos <carlos@exemplo.com>\nescreveu:\n\n> Novo comentário em\n> AUDIÊNCIA: Instrução";
    expect(extractReplyText(raw)).toBe("Pode ser na quinta às 10h.\n\nObrigado!");
  });
  it("remove assinatura automática e linhas citadas", () => {
    expect(extractReplyText("Confirmado.\n\nEnviado do meu iPhone\n> texto antigo")).toBe("Confirmado.");
    expect(extractReplyText("De acordo\n\nOn Thu, Oct 9, 2026 at 6:40 PM Carlos <c@x.com> wrote:\n> oi")).toBe("De acordo");
  });
});
