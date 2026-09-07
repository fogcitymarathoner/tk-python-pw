import type { FilterEntry } from "../xmlService";

export const SAMPLE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
	<title>Mail Filters</title>
	<id>tag:mail.google.com,2008:filters:z0</id>
	<updated>2026-01-01T00:00:00Z</updated>
	<author>
		<name>Marc</name>
		<email>marc@example.com</email>
	</author>
	<entry>
		<category term='filter'></category>
		<title>Mail Filter</title>
		<id>tag:mail.google.com,2008:filter:1</id>
		<updated>2026-01-01T00:00:00Z</updated>
		<content></content>
		<apps:property name='from' value='alice@example.com'/>
		<apps:property name='label' value='Work'/>
		<apps:property name='shouldArchive' value='true'/>
	</entry>
	<entry>
		<category term='filter'></category>
		<title>Mail Filter</title>
		<id>tag:mail.google.com,2008:filter:2</id>
		<updated>2026-01-02T00:00:00Z</updated>
		<content></content>
		<apps:property name='to' value='bob@example.com'/>
		<apps:property name='subject' value='Invoice 2026'/>
		<apps:property name='shouldTrash' value='true'/>
		<apps:property name='shouldMarkAsRead' value='true'/>
		<apps:property name='shouldNeverMarkAsImportant' value='true'/>
		<apps:property name='forwardTo' value='ops@example.com'/>
	</entry>
</feed>
`;

export const EMPTY_FEED_XML = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
	<title>Mail Filters</title>
</feed>
`;

export const NO_FEED_XML = "<not-a-feed></not-a-feed>";

export const PLAIN_PROPERTY_XML = `<?xml version='1.0' encoding='UTF-8'?>
<feed>
	<entry>
		<id>plain-1</id>
		<property name="from" value="plain@example.com"/>
		<property name="empty"/>
	</entry>
</feed>
`;

export const alice: FilterEntry = {
  id: "tag:mail.google.com,2008:filter:1",
  title: "Mail Filter",
  updated: "2026-01-01T00:00:00Z",
  categoryTerm: "filter",
  properties: {
    from: "alice@example.com",
    label: "Work",
    shouldArchive: "true",
  },
};

export const bob: FilterEntry = {
  id: "tag:mail.google.com,2008:filter:2",
  title: "Mail Filter",
  updated: "2026-01-02T00:00:00Z",
  categoryTerm: "filter",
  properties: {
    to: "bob@example.com",
    subject: "Invoice 2026",
    shouldTrash: "true",
  },
};
