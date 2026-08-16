export interface FilterEntry {
  id: string;
  title: string;
  updated: string;
  categoryTerm: string;
  properties: Record<string, string>;
}

export const PROPERTY_NAMES = [
  "forwardTo",
  "from",
  "label",
  "shouldArchive",
  "shouldMarkAsRead",
  "shouldNeverMarkAsImportant",
  "shouldTrash",
  "sizeOperator",
  "sizeUnit",
  "subject",
  "to"
];

// List of properties that represent boolean checkboxes
export const BOOLEAN_PROPERTIES = [
  "shouldArchive",
  "shouldMarkAsRead",
  "shouldNeverMarkAsImportant",
  "shouldTrash"
];

export function parseXml(xmlText: string) {
  // Normalize line endings to LF
  const normalizedXml = xmlText.replace(/\r\n/g, "\n");

  // Try to find the first <entry> tag index to extract headers
  const entryStartIdx = normalizedXml.indexOf("<entry>");
  
  let headers = "";
  let footer = "\n</feed>";
  
  if (entryStartIdx !== -1) {
    headers = normalizedXml.substring(0, entryStartIdx);
    
    // Find the last </entry> tag
    const lastEntryEndIdx = normalizedXml.lastIndexOf("</entry>");
    if (lastEntryEndIdx !== -1) {
      footer = normalizedXml.substring(lastEntryEndIdx + "</entry>".length);
    }
  } else {
    // No entries found, headers is everything up to </feed>
    const feedEndIdx = normalizedXml.indexOf("</feed>");
    if (feedEndIdx !== -1) {
      headers = normalizedXml.substring(0, feedEndIdx);
    } else {
      headers = normalizedXml;
    }
  }
  
  // Parse individual entries using DOMParser
  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedXml, "application/xml");
  const entryNodes = doc.getElementsByTagName("entry");
  
  const entries: FilterEntry[] = [];
  
  for (let i = 0; i < entryNodes.length; i++) {
    const entryNode = entryNodes[i];
    
    // Extract ID
    const idNode = entryNode.getElementsByTagName("id")[0];
    const id = idNode?.textContent || "";
    
    // Extract Title
    const titleNode = entryNode.getElementsByTagName("title")[0];
    const title = titleNode?.textContent || "Mail Filter";
    
    // Extract Updated
    const updatedNode = entryNode.getElementsByTagName("updated")[0];
    const updated = updatedNode?.textContent || new Date().toISOString();
    
    // Extract Category term
    const categoryNode = entryNode.getElementsByTagName("category")[0];
    const categoryTerm = categoryNode?.getAttribute("term") || "filter";
    
    // Extract Properties
    const properties: Record<string, string> = {};
    const propertyNodes = entryNode.getElementsByTagNameNS("http://schemas.google.com/apps/2006", "property");
    
    // Fallbacks for namespace queries
    const propNodes = propertyNodes.length > 0 ? propertyNodes : entryNode.getElementsByTagName("apps:property");
    const finalPropNodes = propNodes.length > 0 ? propNodes : entryNode.getElementsByTagName("property");
    
    for (let j = 0; j < finalPropNodes.length; j++) {
      const propNode = finalPropNodes[j];
      const name = propNode.getAttribute("name");
      const value = propNode.getAttribute("value");
      if (name) {
        properties[name] = value || "";
      }
    }
    
    entries.push({
      id,
      title,
      updated,
      categoryTerm,
      properties
    });
  }
  
  return { headers, footer, entries };
}

function escapeXmlAttribute(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function serializeXml(headers: string, entries: FilterEntry[], footer: string): string {
  let xml = headers;
  
  // Ensure headers ends with a single newline
  if (!xml.endsWith("\n")) {
    xml += "\n";
  }
  
  for (const entry of entries) {
    xml += `\t<entry>\n`;
    xml += `\t\t<category term='${entry.categoryTerm}'></category>\n`;
    xml += `\t\t<title>${entry.title}</title>\n`;
    xml += `\t\t<id>${entry.id}</id>\n`;
    xml += `\t\t<updated>${entry.updated}</updated>\n`;
    xml += `\t\t<content></content>\n`;
    
    // Output properties in canonical order, omitting empty/undefined ones
    for (const name of PROPERTY_NAMES) {
      const val = entry.properties[name];
      if (val !== undefined && val !== "") {
        const escaped = escapeXmlAttribute(val);
        xml += `\t\t<apps:property name='${name}' value='${escaped}'/>\n`;
      }
    }
    
    xml += `\t</entry>\n`;
  }
  
  // Append footer
  const trimmedFooter = footer.trim();
  xml += trimmedFooter;
  
  // Standardize back to LF if necessary (Tauri handles local line endings)
  return xml.replace(/\r\n/g, "\n") + "\n";
}
