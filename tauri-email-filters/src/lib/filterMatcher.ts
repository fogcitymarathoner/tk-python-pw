import type { FilterEntry } from "../xmlService";
import type { ParsedEml } from "./emlParser";

export interface MatchTerm {
  text: string;
  isNegative: boolean;
}

/**
 * Parses a query string into groups of OR branches, each containing AND terms.
 * Supports exact phrases in quotes, leading minus sign for negation, and `OR` logic.
 * E.g.: `ebay.com -"invoice" OR amazon` -> `[[{text: "ebay.com", isNegative: false}, {text: "invoice", isNegative: true}], [{text: "amazon", isNegative: false}]]`
 */
export function parseQueryClause(query: string): MatchTerm[][] {
  const normalized = query.trim();
  if (!normalized) return [];

  // Split by top-level " OR " (case-insensitive)
  const orParts = normalized.split(/\s+OR\s+/i);
  const result: MatchTerm[][] = [];

  for (const part of orParts) {
    const terms: MatchTerm[] = [];
    // Match -?"phrase" or -?token
    const regex = /(-?)"([^"]*)"|(-?\S+)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(part)) !== null) {
      if (match[2] !== undefined) {
        // Quoted phrase
        const isNeg = match[1] === "-";
        const val = match[2].trim();
        if (val) {
          terms.push({ text: val.toLowerCase(), isNegative: isNeg });
        }
      } else if (match[3] !== undefined) {
        // Unquoted token
        let raw = match[3];
        const isNeg = raw.startsWith("-");
        if (isNeg) {
          raw = raw.substring(1);
        }
        raw = raw.trim();
        if (raw) {
          terms.push({ text: raw.toLowerCase(), isNegative: isNeg });
        }
      }
    }

    if (terms.length > 0) {
      result.push(terms);
    }
  }

  return result;
}

/**
 * Tests whether target text satisfies a parsed query clause.
 * The clause matches if ANY OR branch is fully satisfied (all AND terms in that branch match).
 */
export function testClause(target: string, clause: MatchTerm[][]): boolean {
  if (clause.length === 0) return true;
  const lowerTarget = target.toLowerCase();

  for (const andTerms of clause) {
    const allAndMatched = andTerms.every((term) => {
      const contains = lowerTarget.includes(term.text);
      return term.isNegative ? !contains : contains;
    });

    if (allAndMatched) {
      return true;
    }
  }

  return false;
}

export interface MatchResult {
  matched: boolean;
  reasons: string[];
}

/**
 * Evaluates whether an email matches a FilterEntry's criteria.
 */
export function evaluateFilter(entry: FilterEntry, eml: ParsedEml): MatchResult {
  const props = entry.properties;
  const reasons: string[] = [];

  // If filter defines no criteria (e.g. newly created blank filter), it does not match
  const hasCriteria = Boolean(
    props.from ||
    props.to ||
    props.subject ||
    props.hasTheWord ||
    props.doesNotHaveTheWord
  );

  if (!hasCriteria) {
    return { matched: false, reasons: [] };
  }

  // 1. From rule
  if (props.from) {
    const clause = parseQueryClause(props.from);
    if (!testClause(eml.from, clause)) {
      return { matched: false, reasons: [] };
    }
    reasons.push(`From matched: "${props.from}"`);
  }

  // 2. To rule (checked against both To and Cc)
  if (props.to) {
    const clause = parseQueryClause(props.to);
    const combinedToCc = [eml.to, eml.cc].filter(Boolean).join(" ");
    if (!testClause(combinedToCc, clause)) {
      return { matched: false, reasons: [] };
    }
    reasons.push(`To/Cc matched: "${props.to}"`);
  }

  // 3. Subject rule
  if (props.subject) {
    const clause = parseQueryClause(props.subject);
    if (!testClause(eml.subject, clause)) {
      return { matched: false, reasons: [] };
    }
    reasons.push(`Subject matched: "${props.subject}"`);
  }

  // 4. hasTheWord rule (checks subject and body)
  if (props.hasTheWord) {
    const clause = parseQueryClause(props.hasTheWord);
    const fullText = `${eml.subject} ${eml.body}`;
    if (!testClause(fullText, clause)) {
      return { matched: false, reasons: [] };
    }
    reasons.push(`Has the word matched: "${props.hasTheWord}"`);
  }

  // 5. doesNotHaveTheWord rule
  if (props.doesNotHaveTheWord) {
    const fullText = `${eml.subject} ${eml.body}`.toLowerCase();
    const clause = parseQueryClause(props.doesNotHaveTheWord);
    const hasForbidden = clause.some((branch) =>
      branch.some((term) => !term.isNegative && fullText.includes(term.text))
    );
    if (hasForbidden) {
      return { matched: false, reasons: [] };
    }
    reasons.push(`Does not have word matched: "${props.doesNotHaveTheWord}"`);
  }

  return { matched: true, reasons };
}
