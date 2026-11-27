export interface ParsedEml {
  headers: Record<string, string>;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
}

/**
 * Parses an RFC 5322 formatted email (.eml) into structured fields.
 * Unfolds folded header lines and isolates headers from body content.
 */
export function parseEml(raw: string): ParsedEml {
  // Normalize line endings to \n
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Separate header block from the body at the first double newline
  const splitIdx = normalized.indexOf("\n\n");
  let headerBlock = "";
  let body = "";

  if (splitIdx !== -1) {
    headerBlock = normalized.substring(0, splitIdx);
    body = normalized.substring(splitIdx + 2);
  } else {
    headerBlock = normalized;
  }

  // Unfold multi-line headers: subsequent lines starting with space/tab continue the previous header
  const headerLines = headerBlock.split("\n");
  const unfoldedLines: string[] = [];

  for (const line of headerLines) {
    if (/^[ \t]/.test(line) && unfoldedLines.length > 0) {
      unfoldedLines[unfoldedLines.length - 1] += " " + line.trim();
    } else {
      unfoldedLines.push(line);
    }
  }

  const headers: Record<string, string> = {};
  for (const line of unfoldedLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const val = line.substring(colonIdx + 1).trim();
      // If a header repeats, store combined value
      if (headers[key]) {
        headers[key] += ", " + val;
      } else {
        headers[key] = val;
      }
    }
  }

  return {
    headers,
    from: headers["from"] || "",
    to: headers["to"] || "",
    cc: headers["cc"] || "",
    subject: headers["subject"] || "",
    date: headers["date"] || "",
    body,
  };
}
