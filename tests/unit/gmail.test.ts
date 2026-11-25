import { describe, expect, it } from "vitest";
import { GmailError } from "@/infrastructure/notifications/gmail";

describe("erros do Gmail", () => {
  it("explica quando a API do Gmail não está ativada no projeto", () => {
    expect(new GmailError(403, "Gmail API has not been used in project 123 before or it is disabled").message).toMatch(/Ative em console\.cloud\.google\.com/);
  });
  it("pede para reconectar quando falta a permissão de envio", () => {
    expect(new GmailError(403, "Request had insufficient authentication scopes.").message).toMatch(/Conectar meu Gmail/);
  });
});
