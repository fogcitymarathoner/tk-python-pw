import { BOOLEAN_PROPERTIES, PROPERTY_NAMES, parseXml, serializeXml } from "./xmlService";
import { EMPTY_FEED_XML, NO_FEED_XML, PLAIN_PROPERTY_XML, SAMPLE_XML, alice } from "./test/fixtures";

describe("parseXml", () => {
  it("parses namespaced Gmail filter entries and preserves headers/footer", () => {
    const parsed = parseXml(SAMPLE_XML.replace(/\n/g, "\r\n"));
    expect(parsed.headers).toContain("<feed");
    expect(parsed.headers).toContain("<title>Mail Filters</title>");
    expect(parsed.footer).toContain("</feed>");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0].properties.from).toBe("alice@example.com");
    expect(parsed.entries[0].properties.label).toBe("Work");
    expect(parsed.entries[1].properties.subject).toBe("Invoice 2026");
  });

  it("handles feeds with no entries, no feed tag, and plain property nodes", () => {
    expect(parseXml(EMPTY_FEED_XML).entries).toHaveLength(0);
    expect(parseXml(EMPTY_FEED_XML).headers).toContain("<title>Mail Filters</title>");
    expect(parseXml(NO_FEED_XML).headers).toContain("not-a-feed");
    const plain = parseXml(PLAIN_PROPERTY_XML);
    expect(plain.entries[0].id).toBe("plain-1");
    expect(plain.entries[0].title).toBe("Mail Filter");
    expect(plain.entries[0].categoryTerm).toBe("filter");
    expect(plain.entries[0].properties.from).toBe("plain@example.com");
    expect(plain.entries[0].properties.empty).toBe("");
  });
});

describe("serializeXml", () => {
  it("emits canonical properties and escapes attribute values", () => {
    const xml = serializeXml("<feed>\n", [{
      ...alice,
      properties: {
        from: `a&b'"<>`,
        label: "Work",
        unused: "",
      },
    }], "\n</feed>\r\n");
    expect(xml).toContain("<apps:property name='from' value='a&amp;b&apos;&quot;&lt;&gt;'/>");
    expect(xml).toContain("<apps:property name='label' value='Work'/>");
    expect(xml).not.toContain("name='unused'");
    expect(xml.endsWith("\n")).toBe(true);
  });

  it("adds a trailing newline when headers do not already have one", () => {
    const xml = serializeXml("<feed>", [], "</feed>");
    expect(xml.startsWith("<feed>\n")).toBe(true);
    expect(PROPERTY_NAMES).toContain("from");
    expect(BOOLEAN_PROPERTIES).toContain("shouldArchive");
  });
});
