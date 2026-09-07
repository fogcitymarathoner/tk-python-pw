import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  parseXml,
  serializeXml,
  FilterEntry
} from "./xmlService";
import {
  applyPropertyChange,
  buildFilterReport,
  createEmptyFilter,
  deleteFilterAt,
  dragReorder,
  duplicateFilterAt,
  filterEntriesBySearch,
  getFileName,
  insertFilterAt,
  moveFilter,
  parseInsertPosition,
  shouldIgnorePointerDown,
} from "./lib/filterLogic";
import "./App.css";

export default function App() {
  // Check for cached XML in localStorage to enable instant loading on sleep-wake/restart
  const [entries, setEntries] = useState<FilterEntry[]>(() => {
    const cached = localStorage.getItem("tauri_email_filters_cached_xml");
    if (cached) {
      try {
        return parseXml(cached).entries;
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  const [headers, setHeaders] = useState<string>(() => {
    const cached = localStorage.getItem("tauri_email_filters_cached_xml");
    if (cached) {
      try {
        return parseXml(cached).headers;
      } catch (e) {
        return "";
      }
    }
    return "";
  });

  const [footer, setFooter] = useState<string>(() => {
    const cached = localStorage.getItem("tauri_email_filters_cached_xml");
    if (cached) {
      try {
        return parseXml(cached).footer;
      } catch (e) {
        return "";
      }
    }
    return "";
  });

  const [selectedIdx, setSelectedIdx] = useState<number | null>(() => {
    const cached = localStorage.getItem("tauri_email_filters_cached_xml");
    if (cached) {
      try {
        return parseXml(cached).entries.length > 0 ? 0 : null;
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"edit" | "sort">("edit");
  const [isTauriApp, setIsTauriApp] = useState(true);

  const [status, setStatus] = useState<"loading" | "loaded" | "modified" | "saved" | "error">(() => {
    const cachedXml = localStorage.getItem("tauri_email_filters_cached_xml");
    if (cachedXml) {
      const cachedStatus = localStorage.getItem("tauri_email_filters_cached_status") as any;
      if (cachedStatus) return cachedStatus;
      return "loaded";
    }
    return "loading";
  });

  const [statusMsg, setStatusMsg] = useState<string>(() => {
    const cachedXml = localStorage.getItem("tauri_email_filters_cached_xml");
    if (cachedXml) {
      const cachedMsg = localStorage.getItem("tauri_email_filters_cached_status_msg");
      if (cachedMsg) return cachedMsg;
      return "Session restored";
    }
    return "Initializing application...";
  });
  
  // Toast notifications for explicit saves
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  // Drag and drop state (Pointer-based)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Selected custom file path (null means default mailFilters.xml)
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(() => {
    return localStorage.getItem("tauri_email_filters_current_path");
  });

  // Keep the localStorage cache fully in sync with the state variables
  useEffect(() => {
    if (entries.length > 0) {
      const serialized = serializeXml(headers, entries, footer);
      localStorage.setItem("tauri_email_filters_cached_xml", serialized);
      localStorage.setItem("tauri_email_filters_cached_status", status);
      localStorage.setItem("tauri_email_filters_cached_status_msg", statusMsg);
    } else {
      localStorage.removeItem("tauri_email_filters_cached_xml");
      localStorage.removeItem("tauri_email_filters_cached_status");
      localStorage.removeItem("tauri_email_filters_cached_status_msg");
    }
  }, [entries, headers, footer, status, statusMsg]);

  // Sync the currentFilePath with localStorage
  useEffect(() => {
    if (currentFilePath) {
      localStorage.setItem("tauri_email_filters_current_path", currentFilePath);
    } else {
      localStorage.removeItem("tauri_email_filters_current_path");
    }
  }, [currentFilePath]);

  // Check if running inside Tauri, and load filters on startup
  useEffect(() => {
    const detectAndLoad = async () => {
      // Check if Tauri interface is globally injected by the tauri wrapper
      const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;
      setIsTauriApp(isTauri);

      if (isTauri) {
        const storedPath = localStorage.getItem("tauri_email_filters_current_path");
        const hasCache = localStorage.getItem("tauri_email_filters_cached_xml") !== null;
        const cachedStatus = localStorage.getItem("tauri_email_filters_cached_status");

        // Only reload from disk if there are NO unsaved/modified changes in the cache.
        // This prevents overwriting any unsaved session on laptop wake-from-sleep.
        if (!hasCache || cachedStatus !== "modified") {
          try {
            if (storedPath) {
              const content = await invoke<string>("read_filters_from_path", { path: storedPath });
              const parsed = parseXml(content);
              setHeaders(parsed.headers);
              setFooter(parsed.footer);
              setEntries(parsed.entries);
              if (parsed.entries.length > 0) {
                setSelectedIdx(0);
              }
              setStatus("loaded");
              setStatusMsg(`Loaded ${getFileName(storedPath)}`);
            } else {
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
            }
          } catch (err: any) {
            console.error("Failed to load natively via Tauri:", err);
            if (hasCache) {
              // Gracefully handle wake-from-sleep disk lag or removed files by keeping cache active
              setStatusMsg(`Session restored. (Failed to sync disk: ${err})`);
            } else {
              setStatus("error");
              setStatusMsg(`Failed to load: ${err}`);
            }
          }
        } else {
          // Cache exists and is modified. We keep the modified session active!
          setStatusMsg("Unsaved changes restored from last active session");
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
        if (currentFilePath) {
          await invoke("write_filters_to_path", { path: currentFilePath, content: serialized });
          setStatus("saved");
          setStatusMsg(`Successfully saved ${getFileName(currentFilePath)}! (Backup created)`);
          setToastMsg(`Written to ${getFileName(currentFilePath)} and backed up!`);
        } else {
          await invoke("write_filters_file", { content: serialized });
          setStatus("saved");
          setStatusMsg("Successfully saved mailFilters.xml! (Backup created)");
          setToastMsg("Written to mailFilters.xml and backed up as mailFilters.xml.bak!");
        }
        setShowToast(true);
        setTimeout(() => setShowToast(false), 4000);
        setTimeout(() => {
          setStatus("loaded");
          setStatusMsg(currentFilePath ? `Active: ${getFileName(currentFilePath)}` : "Natively loaded mailFilters.xml");
        }, 3000);
      } else {
        // Fallback file download for browser
        const blob = new Blob([serialized], { type: "application/xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = currentFilePath ? getFileName(currentFilePath) : "mailFilters.xml";
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
          setStatusMsg(currentFilePath ? `Active: ${getFileName(currentFilePath)}` : "In-browser active session");
        }, 3000);
      }
    } catch (err: any) {
      console.error("Save error:", err);
      setStatus("error");
      setStatusMsg(`Failed to save: ${err}`);
    }
  };

  // Open any custom XML file from local drive
  const handleOpenFile = async () => {
    if (!isTauriApp) {
      const fileInput = document.getElementById("browser-file-upload") as HTMLInputElement;
      fileInput?.click();
      return;
    }

    try {
      setStatus("loading");
      setStatusMsg("Selecting XML file...");
      const selectedPath = await invoke<string | null>("select_filters_file");
      if (!selectedPath) {
        if (entries.length > 0) {
          setStatus("loaded");
          setStatusMsg(currentFilePath ? `Active: ${getFileName(currentFilePath)}` : "Natively loaded mailFilters.xml");
        } else {
          setStatus("error");
          setStatusMsg("No file selected.");
        }
        return;
      }

      setStatusMsg(`Reading ${getFileName(selectedPath)}...`);
      const content = await invoke<string>("read_filters_from_path", { path: selectedPath });
      
      const parsed = parseXml(content);
      setHeaders(parsed.headers);
      setFooter(parsed.footer);
      setEntries(parsed.entries);
      setCurrentFilePath(selectedPath);
      if (parsed.entries.length > 0) {
        setSelectedIdx(0);
      } else {
        setSelectedIdx(null);
      }
      setStatus("loaded");
      setStatusMsg(`Loaded ${getFileName(selectedPath)}`);
    } catch (err: any) {
      console.error("Open file error:", err);
      setStatus("error");
      setStatusMsg(`Failed to open: ${err}`);
    }
  };

  // Save the current filter list to a brand new path location
  const handleSaveAs = async () => {
    try {
      const defaultName = currentFilePath ? getFileName(currentFilePath) : "mailFilters.xml";
      const serialized = serializeXml(headers, entries, footer);

      if (isTauriApp) {
        setStatus("loading");
        setStatusMsg("Selecting save path...");
        const savePath = await invoke<string | null>("select_save_path", { defaultName });
        if (!savePath) {
          setStatus("loaded");
          setStatusMsg(currentFilePath ? `Active: ${getFileName(currentFilePath)}` : "Natively loaded mailFilters.xml");
          return;
        }

        setStatusMsg(`Saving to ${getFileName(savePath)}...`);
        await invoke("write_filters_to_path", { path: savePath, content: serialized });
        
        setCurrentFilePath(savePath);
        setStatus("saved");
        setStatusMsg(`Successfully saved as ${getFileName(savePath)}!`);
        setToastMsg(`Saved to ${getFileName(savePath)}!`);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 4000);
        setTimeout(() => {
          setStatus("loaded");
          setStatusMsg(`Active: ${getFileName(savePath)}`);
        }, 3000);
      } else {
        const blob = new Blob([serialized], { type: "application/xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setStatus("saved");
        setStatusMsg("File downloaded successfully!");
        setToastMsg("Filter file downloaded successfully!");
        setShowToast(true);
        setTimeout(() => setShowToast(false), 4000);
        setTimeout(() => {
          setStatus("loaded");
          setStatusMsg("In-browser active session");
        }, 3000);
      }
    } catch (err: any) {
      console.error("Save As error:", err);
      setStatus("error");
      setStatusMsg(`Failed to save: ${err}`);
    }
  };

  // Human-readable Gmail report exporter & clipboard copy (without pop-ups, reports in status bar)
  const handleGenerateReport = async () => {
    const report = buildFilterReport(entries);

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
          setCurrentFilePath(file.name);
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
    setEntries(applyPropertyChange(entries, selectedIdx, name, val));
    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Add a brand new empty filter
  const handleAddFilter = () => {
    let targetIdx = 0;

    if (selectedIdx !== null) {
      targetIdx = selectedIdx;
    } else if (entries.length > 0) {
      const input = prompt(
        `No filter is selected.\nEnter the filter number (1 to ${entries.length}) that you want to insert the new filter in front of:\n(Enter "1" for the beginning, or cancel to abort)`
      );
      const parsed = parseInsertPosition(input, entries.length);
      if (parsed === "cancel") return;
      if (parsed === "invalid") {
        alert(`Invalid filter number! Please enter a number between 1 and ${entries.length}.`);
        return;
      }
      targetIdx = parsed;
    }

    const newEntry = createEmptyFilter();
    setEntries(insertFilterAt(entries, newEntry, targetIdx));
    setSelectedIdx(targetIdx);
    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Duplicate an existing filter
  const handleDuplicateFilter = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = duplicateFilterAt(entries, idx);
    setEntries(result.entries);
    setSelectedIdx(result.selectedIdx);
    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Delete a filter
  const handleDeleteFilter = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this filter entry?")) return;

    const result = deleteFilterAt(entries, idx, selectedIdx);
    setEntries(result.entries);
    setSelectedIdx(result.selectedIdx);

    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Move up in order
  const moveUp = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = moveFilter(entries, idx, "up", selectedIdx);
    if (!result) return;
    setEntries(result.entries);
    setSelectedIdx(result.selectedIdx);

    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Move down in order
  const moveDown = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = moveFilter(entries, idx, "down", selectedIdx);
    if (!result) return;
    setEntries(result.entries);
    setSelectedIdx(result.selectedIdx);

    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Pointer-based Live Drag and Drop sorting (flawless on all platforms/webviews)
  const handlePointerDown = (idx: number, e: React.PointerEvent) => {
    // Prevent drag trigger when clicking interactive controls (buttons, inputs)
    const target = e.target as HTMLElement;
    if (shouldIgnorePointerDown(target)) {
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
      setEntries(dragReorder(entries, draggedIndex, idx));
      setDraggedIndex(idx);
      setSelectedIdx(idx);
      setStatus("modified");
      setStatusMsg("Unsaved changes present");
    }
  };

  // Filter entries based on the search query
  const filteredEntries = useMemo(
    () => filterEntriesBySearch(entries, searchTerm),
    [entries, searchTerm],
  );



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
          {currentFilePath && (
            <span className="file-path-badge" title={currentFilePath}>
              📍 {getFileName(currentFilePath)}
            </span>
          )}
        </div>
        <div className="header-actions">
          {/* Always allow opening a file */}
          <button className="btn" onClick={handleOpenFile}>
            📂 Open File...
          </button>
          
          <input 
            type="file" 
            id="browser-file-upload" 
            accept=".xml" 
            onChange={handleFileUpload} 
            style={{ display: "none" }} 
          />

          {entries.length > 0 && (
            <>
              {/* View Mode Toggle */}
              <div className="view-mode-toggle">
                <button
                  className={`toggle-btn ${viewMode === "edit" ? "active" : ""}`}
                  onClick={() => setViewMode("edit")}
                  title="2-Column Mode: Edit details and sort"
                >
                  📝 Edit Details
                </button>
                <button
                  className={`toggle-btn ${viewMode === "sort" ? "active" : ""}`}
                  onClick={() => setViewMode("sort")}
                  title="1-Column Mode: Read-only compact sorter"
                >
                  ↕️ Compact Sort
                </button>
              </div>

              <button className="btn" onClick={handleGenerateReport}>
                📋 Copy Report
              </button>
              <button className="btn btn-accent" onClick={handleAddFilter}>
                ➕ Add New Filter
              </button>
              <button className="btn btn-accent" onClick={handleSaveAs}>
                💾 Save As...
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
            <p>We are waiting to parse a valid `.xml` file.</p>
            <div className="file-input-wrapper">
              <button className="btn btn-accent" onClick={handleOpenFile}>
                📂 Open XML File...
              </button>
            </div>
            {isTauriApp && status === "loading" && (
              <p style={{ fontStyle: "italic" }}>Scanning filesystem...</p>
            )}
          </div>
        ) : (
          <>
            {/* Left sidebar / Full-width list panel */}
            <section className={`list-panel ${viewMode}-view`}>
              <div className="search-section">
                <div className="search-container">
                  <input
                    type="text"
                    placeholder="🔍 Search filters by value (from, to, label, etc.)...."
                    className="search-input"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button
                      className="search-clear-btn"
                      onClick={() => setSearchTerm("")}
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
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
                      {viewMode === "sort" ? (
                        /* Compact single-line card (Sorter Mode) */
                        <div className="entry-card-content-row">
                          <span className="drag-handle" title="Drag to reorder">☰</span>
                          <span className="entry-index">#{originalIdx + 1}</span>
                          
                          {/* Compact inline summary of the filter rule */}
                          <div className="badges-container-inline">
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
                      ) : (
                        /* Original tall card with badges on separate line (Editor Mode) */
                        <>
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
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Right workspace: Property Form Editor (Only in Edit mode) */}
            {viewMode === "edit" && (
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
            )}
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
