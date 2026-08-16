import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  parseXml,
  serializeXml,
  FilterEntry
} from "./xmlService";
import "./App.css";

export default function App() {
  const [entries, setEntries] = useState<FilterEntry[]>([]);
  const [headers, setHeaders] = useState<string>("");
  const [footer, setFooter] = useState<string>("");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [isTauriApp, setIsTauriApp] = useState(true);
  const [status, setStatus] = useState<"loading" | "loaded" | "modified" | "saved" | "error">("loading");
  const [statusMsg, setStatusMsg] = useState("Initializing application...");
  
  // Toast notifications for explicit saves
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  // Drag and drop state (Pointer-based)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Check if running inside Tauri, and load filters on startup
  useEffect(() => {
    const detectAndLoad = async () => {
      // Check if Tauri interface is globally injected by the tauri wrapper
      const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;
      setIsTauriApp(isTauri);

      if (isTauri) {
        try {
          setStatus("loading");
          setStatusMsg("Loading mailFilters.xml...");
          const content = await invoke<string>("read_filters_file");
          const parsed = parseXml(content);
          setHeaders(parsed.headers);
          setFooter(parsed.footer);
          setEntries(parsed.entries);
          if (parsed.entries.length > 0) {
            setSelectedIdx(0);
          }
          setStatus("loaded");
          setStatusMsg("Natively loaded mailFilters.xml");
        } catch (err: any) {
          console.error("Failed to load natively via Tauri:", err);
          setStatus("error");
          setStatusMsg(`Failed to load: ${err}`);
        }
      } else {
        // We are in a standard browser
        setStatus("error");
        setStatusMsg("Running in web preview mode. Please upload or drop mailFilters.xml.");
      }
    };

    detectAndLoad();
  }, []);

  // Global pointer release listener to safely end dragging
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      setDraggedIndex(null);
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
    };
  }, []);

  // Save the modified filters XML file
  const handleSave = async () => {
    try {
      setStatus("loading");
      setStatusMsg("Saving filter data...");
      const serialized = serializeXml(headers, entries, footer);

      if (isTauriApp) {
        await invoke("write_filters_file", { content: serialized });
        setStatus("saved");
        setStatusMsg("Successfully saved mailFilters.xml! (Backup created)");
        setToastMsg("Written to mailFilters.xml and backed up as mailFilters.xml.bak!");
        setShowToast(true);
        setTimeout(() => setShowToast(false), 4000);
        setTimeout(() => {
          setStatus("loaded");
          setStatusMsg("Natively loaded mailFilters.xml");
        }, 3000);
      } else {
        // Fallback file download for browser
        const blob = new Blob([serialized], { type: "application/xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "mailFilters.xml";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setStatus("saved");
        setStatusMsg("File downloaded successfully!");
        setToastMsg("Filter file downloaded successfully to your machine!");
        setShowToast(true);
        setTimeout(() => setShowToast(false), 4000);
        setTimeout(() => {
          setStatus("loaded");
          setStatusMsg("In-browser active session");
        }, 3000);
      }
    } catch (err: any) {
      console.error("Save error:", err);
      setStatus("error");
      setStatusMsg(`Failed to save: ${err}`);
    }
  };

  // Human-readable Gmail report exporter & clipboard copy (without pop-ups, reports in status bar)
  const handleGenerateReport = async () => {
    let report = "The following filters are applied to all incoming mail:\n";
    
    const formatCondition = (val: string) => {
      if (!val) return "";
      // If it contains spaces, dots, dashes, brackets, @, or quotes, wrap in parentheses
      if (/[.\-@\[\]"\s]/.test(val)) {
        return `(${val})`;
      }
      return val;
    };

    let filterNum = 1;
    for (const entry of entries) {
      const properties = entry.properties;
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
      
      report += `Filter #${filterNum}: ${matchesStr}\n`;
      filterNum++;
    }

    // Natively copy to clipboard with 0 pop-ups/toast interruptions
    try {
      await navigator.clipboard.writeText(report);
    } catch (err) {
      console.error("Failed to copy report to clipboard:", err);
    }

    // Save current status to restore after a brief interval
    const prevStatus = status;
    const prevMsg = statusMsg;

    setStatus("saved");
    setStatusMsg("✓ Human-readable report copied to clipboard & saved as filter_report.txt!");

    // Restore original workspace status after 3 seconds
    setTimeout(() => {
      setStatus(prevStatus);
      setStatusMsg(prevMsg);
    }, 3000);

    try {
      if (isTauriApp) {
        await invoke("write_report_file", { content: report });
      } else {
        // Fallback file download for browser
        const blob = new Blob([report], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "filter_report.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      console.error("Failed to write report file:", err);
    }
  };

  // Browser-mode file upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        try {
          const parsed = parseXml(content);
          setHeaders(parsed.headers);
          setFooter(parsed.footer);
          setEntries(parsed.entries);
          if (parsed.entries.length > 0) {
            setSelectedIdx(0);
          }
          setStatus("loaded");
          setStatusMsg(`Loaded ${file.name}`);
        } catch (err: any) {
          alert("Invalid Gmail Filters XML structure!");
        }
      }
    };
    reader.readAsText(file);
  };

  // Field change updates
  const handlePropertyChange = (name: string, val: string) => {
    if (selectedIdx === null) return;
    const updatedEntries = [...entries];
    const updatedProperties = { ...updatedEntries[selectedIdx].properties };

    if (val === "") {
      delete updatedProperties[name];
    } else {
      updatedProperties[name] = val;
    }

    updatedEntries[selectedIdx] = {
      ...updatedEntries[selectedIdx],
      properties: updatedProperties,
      updated: new Date().toISOString().substring(0, 19) + "Z"
    };

    setEntries(updatedEntries);
    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Add a brand new empty filter
  const handleAddFilter = () => {
    const newEntry: FilterEntry = {
      id: `tag:mail.google.com,2008:filter:z000000${Date.now()}`,
      title: "Mail Filter",
      updated: new Date().toISOString().substring(0, 19) + "Z",
      categoryTerm: "filter",
      properties: {
        sizeOperator: "s_sl",
        sizeUnit: "s_smb"
      }
    };

    setEntries([newEntry, ...entries]);
    setSelectedIdx(0);
    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Duplicate an existing filter
  const handleDuplicateFilter = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const source = entries[idx];
    const duplicated: FilterEntry = {
      ...source,
      id: `tag:mail.google.com,2008:filter:z000000${Date.now()}`,
      updated: new Date().toISOString().substring(0, 19) + "Z",
      properties: { ...source.properties }
    };

    const updated = [...entries];
    updated.splice(idx + 1, 0, duplicated);
    setEntries(updated);
    setSelectedIdx(idx + 1);
    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Delete a filter
  const handleDeleteFilter = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this filter entry?")) return;

    const updated = entries.filter((_, i) => i !== idx);
    setEntries(updated);

    if (selectedIdx === idx) {
      setSelectedIdx(updated.length > 0 ? 0 : null);
    } else if (selectedIdx !== null && selectedIdx > idx) {
      setSelectedIdx(selectedIdx - 1);
    }

    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Move up in order
  const moveUp = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (idx === 0) return;
    const updated = [...entries];
    const temp = updated[idx];
    updated[idx] = updated[idx - 1];
    updated[idx - 1] = temp;
    setEntries(updated);

    if (selectedIdx === idx) setSelectedIdx(idx - 1);
    else if (selectedIdx === idx - 1) setSelectedIdx(idx);

    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Move down in order
  const moveDown = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (idx === entries.length - 1) return;
    const updated = [...entries];
    const temp = updated[idx];
    updated[idx] = updated[idx + 1];
    updated[idx + 1] = temp;
    setEntries(updated);

    if (selectedIdx === idx) setSelectedIdx(idx + 1);
    else if (selectedIdx === idx + 1) setSelectedIdx(idx);

    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Pointer-based Live Drag and Drop sorting (flawless on all platforms/webviews)
  const handlePointerDown = (idx: number, e: React.PointerEvent) => {
    // Prevent drag trigger when clicking interactive controls (buttons, inputs)
    const target = e.target as HTMLElement;
    if (
      target.tagName === "BUTTON" || 
      target.closest(".entry-actions") || 
      target.tagName === "INPUT" || 
      target.tagName === "SELECT" ||
      target.closest(".icon-btn")
    ) {
      return;
    }
    
    // Prevent default selection/dragging ghosts
    e.preventDefault();
    setDraggedIndex(idx);
  };

  const handlePointerUp = () => {
    setDraggedIndex(null);
  };

  const handlePointerEnter = (idx: number) => {
    if (draggedIndex === null) return;
    if (draggedIndex !== idx) {
      // Live-swap elements inside the state array
      const updated = [...entries];
      const [draggedItem] = updated.splice(draggedIndex, 1);
      updated.splice(idx, 0, draggedItem);
      
      setEntries(updated);
      setDraggedIndex(idx);
      setSelectedIdx(idx);
      setStatus("modified");
      setStatusMsg("Unsaved changes present");
    }
  };

  // Filter entries based on the search query
  const filteredEntries = useMemo(() => {
    if (!searchTerm.trim()) {
      return entries.map((entry, idx) => ({ entry, originalIdx: idx }));
    }
    const query = searchTerm.toLowerCase();
    return entries
      .map((entry, idx) => ({ entry, originalIdx: idx }))
      .filter(({ entry }) => {
        return (
          entry.id.toLowerCase().includes(query) ||
          Object.values(entry.properties).some((val) =>
            val.toLowerCase().includes(query)
          )
        );
      });
  }, [entries, searchTerm]);

  const selectedEntry = selectedIdx !== null ? entries[selectedIdx] : null;

  return (
    <div className={`app-container ${draggedIndex !== null ? "dragging-active" : ""}`}>
      {/* Top Header Panel */}
      <header className="app-header">
        <div className="header-title-section">
          <h1>Gmail Filters Editor</h1>
          <span className={`status-badge ${status === "saved" ? "success" : status === "modified" ? "warning" : ""}`}>
            {statusMsg}
          </span>
        </div>
        <div className="header-actions">
          {entries.length > 0 && (
            <>
              <button className="btn" onClick={handleGenerateReport}>
                📋 Copy Report
              </button>
              <button className="btn btn-accent" onClick={handleAddFilter}>
                ➕ Add New Filter
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                💾 Save Changes
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main workspace layout */}
      <main className="app-workspace">
        {entries.length === 0 ? (
          <div className="empty-state" style={{ width: "100%" }}>
            <h3>No Active Filter Data Loaded</h3>
            <p>We are waiting to parse a valid `mailFilters.xml` file.</p>
            {!isTauriApp && (
              <div className="file-input-wrapper">
                <button className="btn btn-accent">📂 Choose mailFilters.xml</button>
                <input type="file" accept=".xml" onChange={handleFileUpload} />
              </div>
            )}
            {isTauriApp && status === "loading" && (
              <p style={{ fontStyle: "italic" }}>Scanning filesystem...</p>
            )}
          </div>
        ) : (
          <>
            {/* Left sidebar: Filter list */}
            <section className="list-panel">
              <div className="search-section">
                <input
                  type="text"
                  placeholder="🔍 Search filters by value (from, to, label, etc.)...."
                  className="search-input"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="entries-list-scroll">
                {filteredEntries.map(({ entry, originalIdx }) => {
                  const isSelected = selectedIdx === originalIdx;
                  const isDragged = draggedIndex === originalIdx;

                  return (
                    <div
                      key={entry.id}
                      className={`entry-card ${isSelected ? "selected" : ""} ${isDragged ? "dragging" : ""}`}
                      onClick={() => setSelectedIdx(originalIdx)}
                      onPointerDown={(e) => handlePointerDown(originalIdx, e)}
                      onPointerUp={handlePointerUp}
                      onPointerEnter={() => handlePointerEnter(originalIdx)}
                      style={{ 
                        opacity: isDragged ? 0.4 : 1,
                        cursor: draggedIndex !== null ? "grabbing" : "grab",
                        userSelect: "none",
                        touchAction: "none" // Crucial for pointer capture on mobile/touch interfaces
                      }}
                    >
                      <div className="entry-card-header">
                        <span className="entry-card-title">
                          <span className="drag-handle" title="Drag to reorder">☰</span>
                          Filter <span className="entry-index">#{originalIdx + 1}</span>
                        </span>
                        <div className="entry-actions">
                          <button
                            className="icon-btn"
                            disabled={originalIdx === 0}
                            onClick={(e) => moveUp(originalIdx, e)}
                            title="Move Up"
                          >
                            ▲
                          </button>
                          <button
                            className="icon-btn"
                            disabled={originalIdx === entries.length - 1}
                            onClick={(e) => moveDown(originalIdx, e)}
                            title="Move Down"
                          >
                            ▼
                          </button>
                          <button
                            className="icon-btn"
                            onClick={(e) => handleDuplicateFilter(originalIdx, e)}
                            title="Duplicate Filter"
                          >
                            📋
                          </button>
                          <button
                            className="icon-btn delete"
                            onClick={(e) => handleDeleteFilter(originalIdx, e)}
                            title="Delete Filter"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* Informative badges summarizing the filter rule at a glance */}
                      <div className="badges-container">
                        {entry.properties.from && (
                          <span className="badge badge-match" title={entry.properties.from}>
                            From: {entry.properties.from}
                          </span>
                        )}
                        {entry.properties.to && (
                          <span className="badge badge-match" title={entry.properties.to}>
                            To: {entry.properties.to}
                          </span>
                        )}
                        {entry.properties.subject && (
                          <span className="badge badge-match" title={entry.properties.subject}>
                            Subj: {entry.properties.subject}
                          </span>
                        )}
                        {entry.properties.label && (
                          <span className="badge badge-label" title={entry.properties.label}>
                            Label: {entry.properties.label}
                          </span>
                        )}
                        {entry.properties.forwardTo && (
                          <span className="badge badge-action" title={entry.properties.forwardTo}>
                            Fwd: {entry.properties.forwardTo}
                          </span>
                        )}
                        {entry.properties.shouldArchive === "true" && (
                          <span className="badge badge-action">Archive</span>
                        )}
                        {entry.properties.shouldMarkAsRead === "true" && (
                          <span className="badge badge-action">Read</span>
                        )}
                        {entry.properties.shouldNeverMarkAsImportant === "true" && (
                          <span className="badge badge-action">No-Important</span>
                        )}
                        {entry.properties.shouldTrash === "true" && (
                          <span className="badge badge-trash">Trash</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Right workspace: Property Form Editor */}
            <section className="editor-panel">
              {selectedEntry ? (
                <>
                  <div className="editor-header">
                    <h2>Filter Configuration</h2>
                    <p style={{ wordBreak: "break-all" }}>ID: {selectedEntry.id}</p>
                    <p>Last Evaluated/Updated: {selectedEntry.updated}</p>
                  </div>

                  <div className="editor-scroll">
                    <div className="form-grid">
                      {/* Text inputs matching specified text fields */}
                      <div className="form-field full-width">
                        <label className="form-label">From Condition</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Sender address, domain, or query..."
                          value={selectedEntry.properties.from || ""}
                          onChange={(e) => handlePropertyChange("from", e.target.value)}
                        />
                      </div>

                      <div className="form-field full-width">
                        <label className="form-label">To Condition</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Recipient email address..."
                          value={selectedEntry.properties.to || ""}
                          onChange={(e) => handlePropertyChange("to", e.target.value)}
                        />
                      </div>

                      <div className="form-field full-width">
                        <label className="form-label">Subject</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Email subject keywords..."
                          value={selectedEntry.properties.subject || ""}
                          onChange={(e) => handlePropertyChange("subject", e.target.value)}
                        />
                      </div>

                      <div className="form-field full-width">
                        <label className="form-label">Apply Label</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Gmail folder or label name..."
                          value={selectedEntry.properties.label || ""}
                          onChange={(e) => handlePropertyChange("label", e.target.value)}
                        />
                      </div>

                      <div className="form-field full-width">
                        <label className="form-label">Forward To Address</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Forwarding email address..."
                          value={selectedEntry.properties.forwardTo || ""}
                          onChange={(e) => handlePropertyChange("forwardTo", e.target.value)}
                        />
                      </div>

                      <div className="form-field">
                        <label className="form-label">Size Operator</label>
                        <select
                          className="form-select"
                          value={selectedEntry.properties.sizeOperator || ""}
                          onChange={(e) => handlePropertyChange("sizeOperator", e.target.value)}
                        >
                          <option value="">(None)</option>
                          <option value="s_sl">Greater than (s_sl)</option>
                          <option value="s_ss">Less than (s_ss)</option>
                        </select>
                      </div>

                      <div className="form-field">
                        <label className="form-label">Size Unit</label>
                        <select
                          className="form-select"
                          value={selectedEntry.properties.sizeUnit || ""}
                          onChange={(e) => handlePropertyChange("sizeUnit", e.target.value)}
                        >
                          <option value="">(None)</option>
                          <option value="s_smb">Megabytes (s_smb)</option>
                          <option value="s_skb">Kilobytes (s_skb)</option>
                          <option value="s_sb">Bytes (s_sb)</option>
                        </select>
                      </div>

                      {/* Grid for Google Mail filter actions (Checkboxes/Booleans) */}
                      <div className="checkbox-grid">
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={selectedEntry.properties.shouldArchive === "true"}
                            onChange={(e) =>
                              handlePropertyChange("shouldArchive", e.target.checked ? "true" : "")
                            }
                          />
                          <span className="checkbox-label">Skip the Inbox (Archive)</span>
                        </label>

                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={selectedEntry.properties.shouldMarkAsRead === "true"}
                            onChange={(e) =>
                              handlePropertyChange("shouldMarkAsRead", e.target.checked ? "true" : "")
                            }
                          />
                          <span className="checkbox-label">Mark as Read</span>
                        </label>

                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={selectedEntry.properties.shouldNeverMarkAsImportant === "true"}
                            onChange={(e) =>
                              handlePropertyChange(
                                "shouldNeverMarkAsImportant",
                                e.target.checked ? "true" : ""
                              )
                            }
                          />
                          <span className="checkbox-label">Never mark as important</span>
                        </label>

                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={selectedEntry.properties.shouldTrash === "true"}
                            onChange={(e) =>
                              handlePropertyChange("shouldTrash", e.target.checked ? "true" : "")
                            }
                          />
                          <span className="checkbox-label">Delete it (Trash)</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <h3>No Filter Selected</h3>
                  <p>Select a filter card from the left panel to modify its rule attributes.</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Floating Save/Copy Confirmation Toast Notification (For XML saves only) */}
      {showToast && (
        <div className="toast-notification">
          <div className="toast-header">
            <span className="toast-icon">✅</span>
            <h4>Notification</h4>
          </div>
          <p className="toast-msg">{toastMsg}</p>
        </div>
      )}

      {/* Bottom Workspace Status Bar */}
      <footer className="status-bar">
        <div className="status-bar-left">
          <span className={`status-indicator ${status}`}></span>
          <span>{statusMsg}</span>
        </div>
        <div className="status-bar-right">
          <span>Active Filters: <strong>{entries.length}</strong></span>
          <span className="divider">|</span>
          <span>Environment: <strong>{isTauriApp ? "Desktop App" : "Web Browser"}</strong></span>
        </div>
      </footer>
    </div>
  );
}
