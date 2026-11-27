import { parseQueryClause, testClause, evaluateFilter } from "./filterMatcher";
import type { FilterEntry } from "../xmlService";
import type { ParsedEml } from "./emlParser";

describe("filterMatcher query parsing", () => {
  it("parses single terms, quoted phrases, and negative operators", () => {
    const clause = parseQueryClause('ebay.com -"invoice statement" -spam');
    expect(clause).toHaveLength(1);
    expect(clause[0]).toEqual([
      { text: "ebay.com", isNegative: false },
      { text: "invoice statement", isNegative: true },
      { text: "spam", isNegative: true },
    ]);
  });

  it("handles OR operators", () => {
    const clause = parseQueryClause("amazon OR ebay OR godaddy");
    expect(clause).toHaveLength(3);
    expect(clause[0]).toEqual([{ text: "amazon", isNegative: false }]);
    expect(clause[1]).toEqual([{ text: "ebay", isNegative: false }]);
    expect(clause[2]).toEqual([{ text: "godaddy", isNegative: false }]);
  });
});

describe("filterMatcher evaluateFilter", () => {
  const sampleEml: ParsedEml = {
    headers: {},
    from: "Customer Support <support@ebay.com>",
    to: "user@rocketsredglare.com",
    cc: "team@rocketsredglare.com",
    subject: "Your eBay order confirmation",
    date: "Tue, 24 Nov 2026",
    body: "Thank you for purchasing! Tracking number 12345.",
  };

  const baseFilter: FilterEntry = {
    id: "filter1",
    title: "Mail Filter",
    updated: "2026-01-01T00:00:00Z",
    categoryTerm: "filter",
    properties: {},
  };

  it("matches simple sender and subject criteria", () => {
    const filter: FilterEntry = {
      ...baseFilter,
      properties: {
        from: "ebay.com",
        subject: "order confirmation",
      },
    };
    const res = evaluateFilter(filter, sampleEml);
    expect(res.matched).toBe(true);
    expect(res.reasons).toHaveLength(2);
  });

  it("fails when negative exclusion matches", () => {
    const filter: FilterEntry = {
      ...baseFilter,
      properties: {
        from: "ebay.com",
        subject: '-"order confirmation"',
      },
    };
    const res = evaluateFilter(filter, sampleEml);
    expect(res.matched).toBe(false);
  });

  it("matches To or Cc recipient addresses", () => {
    const filterTo: FilterEntry = {
      ...baseFilter,
      properties: { to: "rocketsredglare.com" },
    };
    expect(evaluateFilter(filterTo, sampleEml).matched).toBe(true);

    const filterCc: FilterEntry = {
      ...baseFilter,
      properties: { to: "team@rocketsredglare.com" },
    };
    expect(evaluateFilter(filterCc, sampleEml).matched).toBe(true);
  });

  it("matches body content using hasTheWord", () => {
    const filter: FilterEntry = {
      ...baseFilter,
      properties: { hasTheWord: "tracking number" },
    };
    expect(evaluateFilter(filter, sampleEml).matched).toBe(true);
  });

  it("rejects when doesNotHaveTheWord matches", () => {
    const filter: FilterEntry = {
      ...baseFilter,
      properties: {
        from: "ebay.com",
        doesNotHaveTheWord: "purchasing",
      },
    };
    expect(evaluateFilter(filter, sampleEml).matched).toBe(false);
  });
});
