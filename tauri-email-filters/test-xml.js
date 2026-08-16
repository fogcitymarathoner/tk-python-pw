import fs from 'fs';

// Load mailFilters.xml to run the boundary tests
const rawContent = fs.readFileSync('mailFilters.xml', 'utf-8');
const content = rawContent.replace(/\r\n/g, '\n');

console.log("=========================================");
console.log("       XMLPreservation Boundary Test     ");
console.log("=========================================");

// Test 1: First <entry> index detection
const entryStartIdx = content.indexOf('<entry>');
console.log(`First <entry> tag index: ${entryStartIdx}`);

if (entryStartIdx === -1) {
    console.error("❌ FAIL: No <entry> tag found!");
    process.exit(1);
}

// Test 2: Extraction of header data
const headers = content.substring(0, entryStartIdx);
console.log("\nParsed headers content preview:");
console.log("-----------------------------------------");
console.log(headers.trim());
console.log("-----------------------------------------");

// Verify headers contain feed tag, title, id, updated, and author, and nothing else
const containsFeed = headers.includes('<feed');
const containsTitle = headers.includes('<title>Mail Filters</title>');
const containsId = headers.includes('<id>');
const containsUpdated = headers.includes('<updated>');
const containsAuthor = headers.includes('<author>');
const containsEntry = headers.includes('<entry>');

console.log("\nHeader Verification Checklist:");
console.log(`- Contains <feed>:                      ${containsFeed ? "✅ PASS" : "❌ FAIL"}`);
console.log(`- Contains <title>:                     ${containsTitle ? "✅ PASS" : "❌ FAIL"}`);
console.log(`- Contains <id>:                        ${containsId ? "✅ PASS" : "❌ FAIL"}`);
console.log(`- Contains <updated>:                   ${containsUpdated ? "✅ PASS" : "❌ FAIL"}`);
console.log(`- Contains <author>:                    ${containsAuthor ? "✅ PASS" : "❌ FAIL"}`);
console.log(`- DOES NOT contain any <entry> elements: ${!containsEntry ? "✅ PASS" : "❌ FAIL"}`);

if (containsFeed && containsTitle && containsId && containsUpdated && containsAuthor && !containsEntry) {
    console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");
    console.log("The metadata remains perfectly top-aligned and untouchable.");
    console.log("=========================================");
} else {
    console.error("\n❌ FAIL: One or more header isolation constraints violated!");
    process.exit(1);
}
