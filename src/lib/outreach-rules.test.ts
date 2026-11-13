import { describe, expect, it } from "vitest";
import { basicEmailCheck, mailServerVerdict } from "./email-verify";
import { evaluateDomain } from "./dns-health";
import { DELAY_PRESETS, inSendingWindow, nextFollowUp, parseBehavior, parseFollowUps, replyAction } from "./followups";
import { dotStuff, messageIdsIn } from "./mail-protocol";
import { buildMimeMessage, replySubject } from "./mime";

describe("email check before sending", () => {
  it("rejects typo domains", () => expect(basicEmailCheck("raj@gmial.com")?.result).toBe("invalid"));
  it("rejects throwaway addresses", () => expect(basicEmailCheck("a@mailinator.com")?.result).toBe("invalid"));
  it("rejects no-reply addresses", () => expect(basicEmailCheck("noreply@acme.com")?.result).toBe("invalid"));
  it("marks team inboxes as risky, not bad", () => expect(basicEmailCheck("info@acme.com")?.result).toBe("risky"));
  it("leaves normal addresses to the mail-server check", () => expect(basicEmailCheck("priya@acme.com")).toBeNull());
  it("domain that doesn't exist is bad", () => expect(mailServerVerdict({ status: 3, records: [] }).result).toBe("invalid"));
  it("domain that refuses email (null MX) is bad", () => expect(mailServerVerdict({ status: 0, records: ["0 ."] }).result).toBe("invalid"));
  it("domain with a mail server is good", () => expect(mailServerVerdict({ status: 0, records: ["10 mx.zoho.in."] }).result).toBe("valid"));
});

describe("SPF / DKIM / DMARC", () => {
  const base = { domain: "decile.media", spfInclude: "include:zoho.in", mx: ["10 mx.zoho.in."], dkim: [{ selector: "zmail", found: true }] };
  const level = (items: ReturnType<typeof evaluateDomain>, key: string) => items.find((i) => i.key === key)?.level;
  it("missing SPF fails", () => expect(level(evaluateDomain({ ...base, txt: [], dmarcTxt: [] }), "spf")).toBe("fail"));
  it("SPF without the provider fails", () =>
    expect(level(evaluateDomain({ ...base, txt: ["v=spf1 include:_spf.google.com ~all"], dmarcTxt: [] }), "spf")).toBe("fail"));
  it("two SPF records fail", () =>
    expect(level(evaluateDomain({ ...base, txt: ["v=spf1 include:zoho.in ~all", "v=spf1 a ~all"], dmarcTxt: [] }), "spf")).toBe("fail"));
  it("correct SPF, DKIM and DMARC pass", () => {
    const items = evaluateDomain({ ...base, txt: ["v=spf1 include:zoho.in ~all"], dmarcTxt: ["v=DMARC1; p=none"] });
    expect(items.every((i) => i.level === "pass")).toBe(true);
  });
  it("missing DKIM fails", () =>
    expect(level(evaluateDomain({ ...base, dkim: [{ selector: "zmail", found: false }], txt: [], dmarcTxt: [] }), "dkim")).toBe("fail"));
});

describe("follow-ups", () => {
  const c = { follow_ups: [{ delay_days: 3, body: "Bumping this" }, { delay_days: 4, body: "Last note" }] };
  it("follow-up 1 is due 3 days after the first email", () => {
    const n = nextFollowUp(c, { current_step: 1, last_sent_at: "2026-11-01T10:00:00.000Z", sequence_stopped_at: null });
    expect(n?.n).toBe(1);
    expect(n?.dueAt.toISOString()).toBe("2026-11-04T10:00:00.000Z");
  });
  it("follow-up 2 is due 4 days after follow-up 1", () =>
    expect(nextFollowUp(c, { current_step: 2, last_sent_at: "2026-11-04T10:00:00.000Z", sequence_stopped_at: null })?.dueAt.toISOString()).toBe("2026-11-08T10:00:00.000Z"));
  it("the sequence ends after the last step", () => expect(nextFollowUp(c, { current_step: 3, last_sent_at: "2026-11-08T10:00:00.000Z", sequence_stopped_at: null })).toBeNull());
  it("a reply (stopped sequence) means no more follow-ups", () =>
    expect(nextFollowUp(c, { current_step: 1, last_sent_at: "2026-11-01T10:00:00.000Z", sequence_stopped_at: "2026-11-02T10:00:00.000Z" })).toBeNull());
  it("allows up to 8 follow-ups, never more", () => {
    const many = { follow_ups: Array.from({ length: 10 }, (_, i) => ({ delay_days: 3, body: `Step ${i + 1}` })) };
    expect(parseFollowUps(many.follow_ups)).toHaveLength(8);
    expect(nextFollowUp(many, { current_step: 8, last_sent_at: "2026-11-01T10:00:00.000Z", sequence_stopped_at: null })?.body).toBe("Step 8");
    expect(nextFollowUp(many, { current_step: 9, last_sent_at: "2026-11-01T10:00:00.000Z", sequence_stopped_at: null })).toBeNull();
  });
  it("offers 3, 5, 7, 13 and 21 day presets", () => expect([...DELAY_PRESETS]).toEqual([3, 5, 7, 13, 21]));
});

describe("behaviour rules", () => {
  const b = parseBehavior({});
  it("a real reply stops the sequence", () => expect(replyAction("interested", b)).toBe("stop"));
  it("unsubscribes and bounces always stop it", () => {
    expect(replyAction("unsubscribe", { ...b, later_check_in: true })).toBe("stop");
    expect(replyAction("bounce", b)).toBe("stop");
  });
  it("out-of-office keeps the sequence going by default", () => expect(replyAction("out_of_office", b)).toBe("continue"));
  it("'later' replies get one check-in when turned on", () => expect(replyAction("follow_up_later", { ...b, later_check_in: true })).toBe("nurture"));
});

describe("sending window", () => {
  const w = { send_start_hour: 9, send_end_hour: 18, send_weekdays_only: true };
  it("sends during working hours on a weekday (India time)", () =>
    expect(inSendingWindow(new Date("2026-11-13T05:00:00Z"), "Asia/Kolkata", w)).toBe(true)); // Fri 10:30
  it("waits outside working hours", () => expect(inSendingWindow(new Date("2026-11-13T14:00:00Z"), "Asia/Kolkata", w)).toBe(false)); // Fri 19:30
  it("waits at weekends", () => expect(inSendingWindow(new Date("2026-11-14T05:00:00Z"), "Asia/Kolkata", w)).toBe(false)); // Sat
});

describe("threading", () => {
  it("replies keep a single Re:", () => {
    expect(replySubject("Quick idea")).toBe("Re: Quick idea");
    expect(replySubject("RE: Quick idea")).toBe("RE: Quick idea");
  });
  it("reply headers point at the earlier emails and include CC", () => {
    const mime = buildMimeMessage({ from: "a@x.com", to: "b@y.com", cc: ["c@y.com"], subject: "Re: Hi", body: "Thanks", messageId: "<2@x.com>", inReplyTo: "<1@y.com>", references: ["<0@x.com>", "<1@y.com>"] });
    expect(mime).toContain("In-Reply-To: <1@y.com>");
    expect(mime).toContain("References: <0@x.com> <1@y.com>");
    expect(mime).toContain("Cc: c@y.com");
    expect(messageIdsIn("<a@b> <c@d>")).toEqual(["<a@b>", "<c@d>"]);
  });
  it("lines starting with a dot survive SMTP", () => expect(dotStuff("Hi\r\n.hidden\r\n")).toBe("Hi\r\n..hidden\r\n"));
});

describe("sign-in help", async () => {
  const { signInHint } = await import("./mail-protocol");
  it("Google refusals point to an app password", () =>
    expect(signInHint("535 5.7.8 Username and Password not accepted. https://support.google.com/mail/?p=BadCredentials - gsmtp")).toMatch(/app password/));
});

describe("finding mailbox settings from the email address", async () => {
  const { detectMailbox } = await import("./mailbox-detect");
  it("gmail.com uses Google's servers", () => expect(detectMailbox("a@gmail.com", []).candidates[0]?.smtpHost).toBe("smtp.gmail.com"));
  it("own domain on Google Workspace uses Google's servers", () =>
    expect(detectMailbox("a@decile.media", ["1 aspmx.l.google.com."]).providerKey).toBe("gmail"));
  it("Zoho India business mailbox tries the pro server first, then the personal one", () =>
    expect(detectMailbox("a@decile.media", ["10 mx.zoho.in.", "20 mx2.zoho.in."]).candidates.map((c) => c.smtpHost)).toEqual(["smtppro.zoho.in", "smtp.zoho.in"]));
  it("Zoho global mailbox uses zoho.com servers", () => expect(detectMailbox("a@x.com", ["10 mx.zoho.com."]).providerKey).toBe("zoho_com"));
  it("GoDaddy mailbox uses GoDaddy's servers", () =>
    expect(detectMailbox("a@x.com", ["0 smtp.secureserver.net.", "10 mailstore1.secureserver.net."]).candidates[0]?.smtpHost).toBe("smtpout.secureserver.net"));
  it("GoDaddy domain on Microsoft 365 uses Microsoft's servers", () =>
    expect(detectMailbox("a@x.com", ["0 x-com.mail.protection.outlook.com."]).providerKey).toBe("outlook"));
  it("unknown hosts try mail.<domain> first", () => expect(detectMailbox("a@acme.co", ["10 mx.acme.co."]).candidates[0]?.smtpHost).toBe("mail.acme.co"));
});
