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
  findDuplicateFilters,
  formatFilterTitle,
  getFileName,
  insertFilterAt,
  isEmptyFilter,
  moveFilter,
  parseInsertPosition,
  shouldIgnorePointerDown,
} from "./lib/filterLogic";
import { EmlTesterModal } from "./components/EmlTesterModal";
import "./App.css";

function getNormalizedXml(headers: string, entries: FilterEntry[], footer: string): string {
  if (entries.length === 0) return "";
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    updated: "2000-01-01T00:00:00Z",
  }));
  return serializeXml(headers, normalizedEntries, footer);
}

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
  const [showEmlTester, setShowEmlTester] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
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

  // Normalized baseline XML string representing last loaded/saved disk state
  const [savedXmlNorm, setSavedXmlNorm] = useState<string>(() => {
    const cachedSaved = localStorage.getItem("tauri_email_filters_saved_xml_norm");
    if (cachedSaved) return cachedSaved;
    return "";
  });

  // Track index to auto-scroll to
  const [scrollToIdx, setScrollToIdx] = useState<number | null>(null);

  // Auto-scroll to target filter card when requested
  useEffect(() => {
    if (scrollToIdx !== null) {
      const el = document.getElementById(`filter-card-${scrollToIdx}`);
      if (el) {
        el.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      }
      setScrollToIdx(null);
    }
  }, [scrollToIdx, entries]);

  // Current normalized XML string
  const currentXmlNorm = useMemo(() => {
    return getNormalizedXml(headers, entries, footer);
  }, [headers, entries, footer]);

  // Identify duplicate filter indexes based on identical rule properties
  const duplicateFilterIndexes = useMemo(() => {
    const duplicates = findDuplicateFilters(entries);
    const set = new Set<number>();
    for (const nums of duplicates.values()) {
      for (const num of nums) {
        set.add(num - 1);
      }
    }
    return set;
  }, [entries]);

  // If savedXmlNorm is not set yet, set it once data is loaded (unless restoring an unsaved session)
  useEffect(() => {
    const isRestoredModified = localStorage.getItem("tauri_email_filters_cached_status") === "modified";
    if (entries.length > 0 && !savedXmlNorm && !isRestoredModified) {
      const norm = getNormalizedXml(headers, entries, footer);
      setSavedXmlNorm(norm);
      localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
    }
  }, [entries, headers, footer, savedXmlNorm]);

  // Derived dirty flag: true if current normalized XML differs from baseline saved normalized XML
  const hasChanges = useMemo(() => {
    if (entries.length === 0) return false;
    if (!savedXmlNorm) return false;
    return currentXmlNorm !== savedXmlNorm;
  }, [entries.length, currentXmlNorm, savedXmlNorm]);

  // Keep the localStorage cache fully in sync with the state variables
  useEffect(() => {
    if (entries.length > 0) {
      const serialized = serializeXml(headers, entries, footer);
      localStorage.setItem("tauri_email_filters_cached_xml", serialized);
      localStorage.setItem("tauri_email_filters_cached_status", status);
      localStorage.setItem("tauri_email_filters_cached_status_msg", statusMsg);
      if (savedXmlNorm) {
        localStorage.setItem("tauri_email_filters_saved_xml_norm", savedXmlNorm);
      }
    } else {
      localStorage.removeItem("tauri_email_filters_cached_xml");
      localStorage.removeItem("tauri_email_filters_cached_status");
      localStorage.removeItem("tauri_email_filters_cached_status_msg");
      localStorage.removeItem("tauri_email_filters_saved_xml_norm");
    }
  }, [entries, headers, footer, status, statusMsg, savedXmlNorm]);

  // Sync status badge when changes are made or reverted
  useEffect(() => {
    if (status === "loading" || status === "saved" || status === "error") return;

    if (!hasChanges && status === "modified" && savedXmlNorm) {
      setStatus("loaded");
      setStatusMsg(
        currentFilePath
          ? `Active: ${getFileName(currentFilePath)}`
          : "Natively loaded mailFilters.xml"
      );
    }
  }, [hasChanges, currentFilePath, status, savedXmlNorm]);

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
        // Check if an initial file was passed via CLI argument
        let cliFilePath: string | null = null;
        try {
          cliFilePath = await invoke<string | null>("get_initial_file_path");
        } catch (e) {
          console.warn("Could not check CLI initial file path:", e);
        }

        // If a CLI file was passed, prioritize loading it directly
        if (cliFilePath) {
          try {
            const content = await invoke<string>("read_filters_from_path", { path: cliFilePath });
            const parsed = parseXml(content);
            const norm = getNormalizedXml(parsed.headers, parsed.entries, parsed.footer);
            await invoke("populate_sqlite", { path: cliFilePath, entries: parsed.entries });
            setHeaders(parsed.headers);
            setFooter(parsed.footer);
            setEntries(parsed.entries);
            setSavedXmlNorm(norm);
            setCurrentFilePath(cliFilePath);
            localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
            if (parsed.entries.length > 0) {
              setSelectedIdx(0);
            }
            setStatus("loaded");
            setStatusMsg(`Loaded ${getFileName(cliFilePath)}`);
            return;
          } catch (err: any) {
            console.error("Failed to load CLI specified file:", err);
            setStatus("error");
            setStatusMsg(`Failed to load ${getFileName(cliFilePath)}: ${err}`);
            return;
          }
        }

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
              const norm = getNormalizedXml(parsed.headers, parsed.entries, parsed.footer);
              await invoke("populate_sqlite", { path: storedPath, entries: parsed.entries });
              setHeaders(parsed.headers);
              setFooter(parsed.footer);
              setEntries(parsed.entries);
              setSavedXmlNorm(norm);
              localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
              if (parsed.entries.length > 0) {
                setSelectedIdx(0);
              }
              setStatus("loaded");
              setStatusMsg(`Loaded ${getFileName(storedPath)}`);
            } else {
              const content = await invoke<string>("read_filters_file");
              const parsed = parseXml(content);
              const norm = getNormalizedXml(parsed.headers, parsed.entries, parsed.footer);
              await invoke("populate_sqlite", { path: null, entries: parsed.entries });
              setHeaders(parsed.headers);
              setFooter(parsed.footer);
              setEntries(parsed.entries);
              setSavedXmlNorm(norm);
              localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
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

  // Listen for Escape key to close edit modal or EML tester modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditModalOpen) {
          setIsEditModalOpen(false);
        } else if (showEmlTester) {
          setShowEmlTester(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditModalOpen, showEmlTester]);

  // Save the modified filters XML file
  const handleSave = async () => {
    try {
      setStatus("loading");
      setStatusMsg("Saving filter data...");

      if (isTauriApp) {
        // 1. Populate the SQLite database with the current filter entries
        await invoke("populate_sqlite", { path: currentFilePath, entries });

        // 2. Export from SQLite excluding the hash field (detects duplicate filters via indexed hash field)
        const exported = await invoke<FilterEntry[]>("export_sqlite", { path: currentFilePath });
        const exportedEntries = Array.isArray(exported) ? exported : entries;

        // 3. Export to XML
        const serialized = serializeXml(headers, exportedEntries, footer);
        const norm = getNormalizedXml(headers, exportedEntries, footer);

        if (currentFilePath) {
          await invoke("write_filters_to_path", { path: currentFilePath, content: serialized });
          setSavedXmlNorm(norm);
          localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
          setStatus("saved");
          setStatusMsg(`Successfully saved ${getFileName(currentFilePath)}! (Backup created)`);
          setToastMsg(`Written to ${getFileName(currentFilePath)} and backed up!`);
        } else {
          await invoke("write_filters_file", { content: serialized });
          setSavedXmlNorm(norm);
          localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
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
        // Fallback for browser preview mode
        const duplicates = findDuplicateFilters(entries);
        if (duplicates.size > 0) {
          const detail = Array.from(duplicates.entries())
            .map(([_, nums]) => `Filter(s) #${nums.join(", ")}`)
            .join("; ");
          throw new Error(`Duplicate filters detected! All filters must be distinct to save.\n${detail}`);
        }

        const serialized = serializeXml(headers, entries, footer);
        const norm = getNormalizedXml(headers, entries, footer);
        const blob = new Blob([serialized], { type: "application/xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = currentFilePath ? getFileName(currentFilePath) : "mailFilters.xml";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setSavedXmlNorm(norm);
        localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
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
      const errMsg = typeof err === "string" ? err : err?.message || String(err);
      setStatusMsg(`Failed to save: ${errMsg}`);
      setToastMsg(`Failed to save: ${errMsg}`);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
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
      const norm = getNormalizedXml(parsed.headers, parsed.entries, parsed.footer);
      await invoke("populate_sqlite", { path: selectedPath, entries: parsed.entries });
      setHeaders(parsed.headers);
      setFooter(parsed.footer);
      setEntries(parsed.entries);
      setSavedXmlNorm(norm);
      localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
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
        // 1. Populate the SQLite database at the target save path
        await invoke("populate_sqlite", { path: savePath, entries });

        // 2. Export from SQLite excluding the hash field (validates all filters distinct)
        const exported = await invoke<FilterEntry[]>("export_sqlite", { path: savePath });
        const exportedEntries = Array.isArray(exported) ? exported : entries;

        const serialized = serializeXml(headers, exportedEntries, footer);
        const norm = getNormalizedXml(headers, exportedEntries, footer);

        await invoke("write_filters_to_path", { path: savePath, content: serialized });
        
        setSavedXmlNorm(norm);
        localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
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
        const duplicates = findDuplicateFilters(entries);
        if (duplicates.size > 0) {
          const detail = Array.from(duplicates.entries())
            .map(([_, nums]) => `Filter(s) #${nums.join(", ")}`)
            .join("; ");
          throw new Error(`Duplicate filters detected! All filters must be distinct to save.\n${detail}`);
        }

        const serialized = serializeXml(headers, entries, footer);
        const norm = getNormalizedXml(headers, entries, footer);
        const blob = new Blob([serialized], { type: "application/xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setSavedXmlNorm(norm);
        localStorage.setItem("tauri_email_filters_saved_xml_norm", norm);
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
      const errMsg = typeof err === "string" ? err : err?.message || String(err);
      setStatusMsg(`Failed to save: ${errMsg}`);
      setToastMsg(`Save failed: ${errMsg}`);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
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
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (content) {
        try {
          const parsed = parseXml(content);
          if (isTauriApp) {
            await invoke("populate_sqlite", { path: file.name, entries: parsed.entries });
          }
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
    const wasSelected = selectedIdx !== null;

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
    setIsEditModalOpen(true);
    if (searchTerm) {
      setSearchTerm("");
    }
    if (!wasSelected) {
      setScrollToIdx(targetIdx);
    }
    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Duplicate an existing filter
  const handleDuplicateFilter = (idx: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const result = duplicateFilterAt(entries, idx);
    setEntries(result.entries);
    setSelectedIdx(result.selectedIdx);
    setIsEditModalOpen(true);
    setStatus("modified");
    setStatusMsg("Unsaved changes present");
  };

  // Delete a filter
  const handleDeleteFilter = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this filter entry?")) return;

    if (idx === selectedIdx) {
      setIsEditModalOpen(false);
    }
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

  const activeFileName = currentFilePath
    ? getFileName(currentFilePath)
    : entries.length > 0
      ? "mailFilters.xml"
      : null;

  const filterTitle = formatFilterTitle(activeFileName);

  // Synchronize browser document title and native desktop window title bar
  useEffect(() => {
    document.title = filterTitle;
    const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
    if (isTauri) {
      const res = invoke("set_window_title", { title: filterTitle });
      if (res && typeof (res as any).catch === "function") {
        (res as Promise<void>).catch(() => {});
      }
    }
  }, [filterTitle]);

  return (
    <div className={`app-container ${draggedIndex !== null ? "dragging-active" : ""}`}>
      {/* Top Header Panel */}
      <header className="app-header">
        <div className="header-title-section">
          <h1>{filterTitle}</h1>
          <span
            className={`status-badge ${status === "saved" ? "success" : status === "modified" ? "warning" : ""}`}
            title={currentFilePath || undefined}
          >
            {activeFileName ? (
              <>
                <span className="file-pin-label">📍 {activeFileName}</span>
                {statusMsg && statusMsg !== `Active: ${activeFileName}` && (
                  <>
                    <span className="status-sep"> (</span>
                    <span className="status-state-label">{statusMsg}</span>
                    <span className="status-sep">)</span>
                  </>
                )}
              </>
            ) : (
              statusMsg
            )}
          </span>
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
              <button
                className="btn"
                onClick={() => setShowEmlTester(true)}
                title="Test an .eml email file against your filters"
              >
                🧪 Test Email...
              </button>
              <button className="btn btn-accent" onClick={handleAddFilter}>
                ➕ Add New Filter
              </button>
              <button
                className="btn btn-accent"
                onClick={handleSaveAs}
                disabled={!hasChanges || status === "loading"}
              >
                💾 Save As...
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!hasChanges || status === "loading"}
              >
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

              <div
                className="entries-list-scroll"
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setSelectedIdx(null);
                    setIsEditModalOpen(false);
                  }
                }}
              >
                {filteredEntries.map(({ entry, originalIdx }) => {
                  const isSelected = selectedIdx === originalIdx;
                  const isDragged = draggedIndex === originalIdx;

                  return (
                    <div
                      key={entry.id}
                      id={`filter-card-${originalIdx}`}
                      className={`entry-card ${isSelected ? "selected" : ""} ${isDragged ? "dragging" : ""}`}
                      onClick={() => {
                        setSelectedIdx(originalIdx);
                        setIsEditModalOpen(true);
                      }}
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
                            {isEmptyFilter(entry) && (
                              <span className="badge badge-empty" title="New / Empty Filter">
                                New / Empty Filter
                              </span>
                            )}
                            {duplicateFilterIndexes.has(originalIdx) && (
                              <span className="badge badge-duplicate" title="Duplicate filter: identical matching criteria and actions to another filter">
                                ⚠️ Duplicate Filter
                              </span>
                            )}
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
                              className="icon-btn edit"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedIdx(originalIdx);
                                setIsEditModalOpen(true);
                              }}
                              title="Edit Filter"
                            >
                              ✏️
                            </button>
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
                                className="icon-btn edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedIdx(originalIdx);
                                  setIsEditModalOpen(true);
                                }}
                                title="Edit Filter"
                              >
                                ✏️
                              </button>
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
                            {isEmptyFilter(entry) && (
                              <span className="badge badge-empty" title="New / Empty Filter">
                                New / Empty Filter
                              </span>
                            )}
                            {duplicateFilterIndexes.has(originalIdx) && (
                              <span className="badge badge-duplicate" title="Duplicate filter: identical matching criteria and actions to another filter">
                                ⚠️ Duplicate Filter
                              </span>
                            )}
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

          </>
        )}
      </main>

      {/* Centered Filter Edit Modal Popup */}
      {selectedEntry && isEditModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setIsEditModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="modal-container edit-filter-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-row">
                <span className="modal-icon">✏️</span>
                <h2>Filter #{selectedIdx !== null ? selectedIdx + 1 : ""} Configuration</h2>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  className="btn btn-sm btn-accent"
                  onClick={() => selectedIdx !== null && handleDuplicateFilter(selectedIdx)}
                  title="Duplicate this filter directly below"
                >
                  📄 Duplicate Filter
                </button>
                <button
                  className="icon-btn close-btn"
                  onClick={() => setIsEditModalOpen(false)}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="modal-content edit-modal-content">
              <div className="filter-metadata">
                <span className="metadata-id">ID: {selectedEntry.id}</span>
                <span className="metadata-updated">Last Evaluated/Updated: {selectedEntry.updated}</span>
              </div>

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

            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setIsEditModalOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* EML Filter Tester Modal */}
      <EmlTesterModal
        isOpen={showEmlTester}
        onClose={() => setShowEmlTester(false)}
        entries={entries}
        isTauriApp={isTauriApp}
        onSelectFilter={(idx) => {
          setSelectedIdx(idx);
          setScrollToIdx(idx);
        }}
      />

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
