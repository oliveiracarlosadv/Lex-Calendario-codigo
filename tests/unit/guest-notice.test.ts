import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/supabase/server", () => ({ getSupabaseAdminClient: () => ({}) }));

describe("e-mail aos convidados só em mudanças importantes", async () => {
  const { guestNoticeHash } = await import("@/application/sync/calendar-sync");
  const base = {
    id: "1", title: "Reunião", descriptionText: "x", location: "Fórum", startsAt: "2026-10-20T13:00:00.000Z", endsAt: "2026-10-20T14:00:00.000Z",
    allDay: false, timezone: "America/Sao_Paulo", status: "scheduled", meetingUrl: null, attendees: [{ email: "a@x.com" }],
  };
  it("não muda quando só descrição, nome ou status mudam", () => {
    expect(guestNoticeHash({ ...base, title: "✔️ Reunião", descriptionText: "checklist novo", status: "done" })).toBe(guestNoticeHash(base));
  });
  it("muda quando data, local ou convidados mudam", () => {
    expect(guestNoticeHash({ ...base, startsAt: "2026-10-21T13:00:00.000Z" })).not.toBe(guestNoticeHash(base));
    expect(guestNoticeHash({ ...base, location: "Online" })).not.toBe(guestNoticeHash(base));
    expect(guestNoticeHash({ ...base, attendees: [{ email: "a@x.com" }, { email: "b@x.com" }] })).not.toBe(guestNoticeHash(base));
  });
});
