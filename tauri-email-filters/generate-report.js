import fs from 'fs';

// Decodes XML entities
function decodeXml(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Custom conditions formatting rule to match Google's standard layout
function formatCondition(val) {
  if (!val) return "";
  // If it contains spaces, dots, dashes, brackets, @, or quotes, wrap in parentheses
  if (/[.\-@\[\]"\s]/.test(val)) {
    return `(${val})`;
  }
  return val;
}

try {
  const content = fs.readFileSync('mailFilters.xml', 'utf-8');
  
  let report = "The following filters are applied to all incoming mail:\n";
  
  // Extract all <entry> blocks
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  let filterNum = 1;
  
  while ((match = entryRegex.exec(content)) !== null) {
    const entryBlock = match[1];
    
    // Parse properties inside this entry
    const propRegex = /<apps:property\s+name='([^']+)'\s+value='([^']*)'\s*\/>/g;
    let propMatch;
    const properties = {};
    
    while ((propMatch = propRegex.exec(entryBlock)) !== null) {
      const name = propMatch[1];
      const val = decodeXml(propMatch[2]);
      properties[name] = val;
    }
    
    // Format Matches line
    const matchParts = [];
    if (properties.from) {
      matchParts.push(`from:${formatCondition(properties.from)}`);
    }
    if (properties.to) {
      matchParts.push(`to:${formatCondition(properties.to)}`);
    }
    if (properties.subject) {
      matchParts.push(`subject:${formatCondition(properties.subject)}`);
    }
    
    const matchesStr = matchParts.join(" ");
    
    // Append simplified Matches list to report with filter numbers
    report += `Filter #${filterNum}: ${matchesStr}\n`;
    filterNum++;
  }
  
  fs.writeFileSync('filter_report.txt', report, 'utf-8');
  console.log("Successfully generated filter_report.txt!");
} catch (e) {
  console.error("Error generating report:", e);
}
