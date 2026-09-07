export type TauriSeed = {
  xml?: string;
  fail?: Record<string, string>;
  selectPath?: string | null;
  savePath?: string | null;
};

export const SAMPLE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
	<title>Mail Filters</title>
	<id>tag:mail.google.com,2008:filters:z0</id>
	<updated>2026-01-01T00:00:00Z</updated>
	<author><name>Marc</name><email>marc@example.com</email></author>
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
	</entry>
</feed>
`;

export function installTauriMock() {
  const seed =
    (window as unknown as { __TAURI_MOCK_SEED__?: TauriSeed }).__TAURI_MOCK_SEED__ ?? {};
  let xml = seed.xml ?? "";
  const fail = { ...(seed.fail ?? {}) };

  const internals = {
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      if (fail[cmd]) throw fail[cmd];
      switch (cmd) {
        case "read_filters_file":
        case "read_filters_from_path":
          return xml;
        case "write_filters_file":
        case "write_filters_to_path":
          xml = String(args.content ?? xml);
          return;
        case "write_report_file":
          return;
        case "select_filters_file":
          return seed.selectPath === undefined ? "C:\\\\data\\\\custom.xml" : seed.selectPath;
        case "select_save_path":
          return seed.savePath === undefined ? "C:\\\\data\\\\saved.xml" : seed.savePath;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    },
  };

  (window as unknown as { __TAURI_INTERNALS__: typeof internals }).__TAURI_INTERNALS__ = internals;
}
