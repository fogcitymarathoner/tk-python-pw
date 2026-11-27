import { parseEml } from "./emlParser";

describe("emlParser", () => {
  it("parses single-line and folded headers and body", () => {
    const raw = [
      "From: sender@example.com",
      "To: recipient@example.com",
      "Subject: Monthly Report",
      "Folded-Header: line one",
      "  line two",
      "",
      "Hello world,",
      "This is the email body.",
    ].join("\r\n");

    const parsed = parseEml(raw);
    expect(parsed.from).toBe("sender@example.com");
    expect(parsed.to).toBe("recipient@example.com");
    expect(parsed.subject).toBe("Monthly Report");
    expect(parsed.headers["folded-header"]).toBe("line one line two");
    expect(parsed.body).toBe("Hello world,\nThis is the email body.");
  });

  it("handles missing body gracefully", () => {
    const raw = "From: alice@test.com\nSubject: Only Headers";
    const parsed = parseEml(raw);
    expect(parsed.from).toBe("alice@test.com");
    expect(parsed.subject).toBe("Only Headers");
    expect(parsed.body).toBe("");
  });
});
