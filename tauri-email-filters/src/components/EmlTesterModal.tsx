import { useState, useId } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FilterEntry } from "../xmlService";
import { parseEml, type ParsedEml } from "../lib/emlParser";
import { evaluateFilter } from "../lib/filterMatcher";

interface EmlTesterModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: FilterEntry[];
  isTauriApp: boolean;
  onSelectFilter?: (index: number) => void;
}

interface MatchReport {
  filterIndex: number;
  entry: FilterEntry;
  reasons: string[];
}

export function EmlTesterModal({
  isOpen,
  onClose,
  entries,
  isTauriApp,
  onSelectFilter,
}: EmlTesterModalProps) {
  const [fileName, setFileName] = useState<string>("");
  const [parsedEml, setParsedEml] = useState<ParsedEml | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [showBody, setShowBody] = useState<boolean>(false);
  const fileInputId = useId();

  if (!isOpen) return null;

  const handleProcessEmlText = (text: string, name: string) => {
    try {
      const parsed = parseEml(text);
      setParsedEml(parsed);
      setFileName(name);
      setErrorMsg("");
    } catch (err: any) {
      setErrorMsg("Failed to parse EML file: " + (err?.message || String(err)));
      setParsedEml(null);
    }
  };

  const handleSelectFile = async () => {
    if (isTauriApp) {
      try {
        const filePath = await invoke<string | null>("select_eml_file");
        if (!filePath) return;
        const content = await invoke<string>("read_eml_file", { path: filePath });
        const name = filePath.split(/[/\\]/).pop() || "email.eml";
        handleProcessEmlText(content, name);
      } catch (err: any) {
        setErrorMsg("Error opening file: " + (err?.message || String(err)));
      }
    } else {
      const input = document.getElementById(fileInputId) as HTMLInputElement;
      input?.click();
    }
  };

  const handleBrowserFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        handleProcessEmlText(content, file.name);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          handleProcessEmlText(content, file.name);
        }
      };
      reader.readAsText(file);
    }
  };

  // Evaluate all active filters against the parsed EML
  const matchingFilters: MatchReport[] = [];
  if (parsedEml) {
    entries.forEach((entry, idx) => {
      const result = evaluateFilter(entry, parsedEml);
      if (result.matched) {
        matchingFilters.push({
          filterIndex: idx,
          entry,
          reasons: result.reasons,
        });
      }
    });
  }

  // Aggregate cumulative actions from all matching filters
  const cumulativeLabels = Array.from(
    new Set(
      matchingFilters
        .map((m) => m.entry.properties.label)
        .filter((l): l is string => Boolean(l && l.trim()))
    )
  );

  const willArchive = matchingFilters.some(
    (m) => m.entry.properties.shouldArchive === "true"
  );
  const willMarkRead = matchingFilters.some(
    (m) => m.entry.properties.shouldMarkAsRead === "true"
  );
  const willTrash = matchingFilters.some(
    (m) => m.entry.properties.shouldTrash === "true"
  );
  const willNeverImportant = matchingFilters.some(
    (m) => m.entry.properties.shouldNeverMarkAsImportant === "true"
  );
  const forwardAddresses = Array.from(
    new Set(
      matchingFilters
        .map((m) => m.entry.properties.forwardTo)
        .filter((f): f is string => Boolean(f && f.trim()))
    )
  );

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-container eml-tester-modal"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="modal-header">
          <div className="modal-title-row">
            <span className="modal-icon">🧪</span>
            <h2>EML Filter Tester</h2>
          </div>
          <button className="icon-btn close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-content">
          {/* File Picker Section */}
          <div className="eml-picker-bar">
            <input
              type="file"
              id={fileInputId}
              accept=".eml,.msg,.txt"
              style={{ display: "none" }}
              onChange={handleBrowserFileUpload}
            />
            <button className="btn btn-primary" onClick={handleSelectFile}>
              📂 Select .eml File
            </button>
            {fileName ? (
              <span className="loaded-file-indicator">
                Loaded: <strong>{fileName}</strong>
              </span>
            ) : (
              <span className="picker-hint">or drag and drop an .eml file here</span>
            )}
          </div>

          {errorMsg && <div className="eml-error-banner">{errorMsg}</div>}

          {parsedEml && (
            <>
              {/* Parsed Email Card */}
              <div className="eml-details-card">
                <div className="eml-detail-row">
                  <span className="detail-label">From:</span>
                  <span className="detail-val">{parsedEml.from || "(empty)"}</span>
                </div>
                <div className="eml-detail-row">
                  <span className="detail-label">To:</span>
                  <span className="detail-val">{parsedEml.to || "(empty)"}</span>
                </div>
                {parsedEml.cc && (
                  <div className="eml-detail-row">
                    <span className="detail-label">Cc:</span>
                    <span className="detail-val">{parsedEml.cc}</span>
                  </div>
                )}
                <div className="eml-detail-row">
                  <span className="detail-label">Subject:</span>
                  <span className="detail-val font-semibold">
                    {parsedEml.subject || "(no subject)"}
                  </span>
                </div>
                {parsedEml.date && (
                  <div className="eml-detail-row">
                    <span className="detail-label">Date:</span>
                    <span className="detail-val">{parsedEml.date}</span>
                  </div>
                )}
                {parsedEml.body && (
                  <div className="eml-body-toggle-row">
                    <button
                      className="btn-text-link"
                      onClick={() => setShowBody(!showBody)}
                    >
                      {showBody ? "▲ Hide Message Body" : "▼ Preview Message Body"}
                    </button>
                    {showBody && (
                      <pre className="eml-body-preview">{parsedEml.body}</pre>
                    )}
                  </div>
                )}
              </div>

              {/* Match Results Header */}
              <div className="results-summary-card">
                <h3>
                  {matchingFilters.length > 0
                    ? `✅ ${matchingFilters.length} of ${entries.length} filters match this email`
                    : `❌ No filters match this email`}
                </h3>

                {matchingFilters.length > 0 && (
                  <div className="cumulative-actions">
                    <span className="action-title">Cumulative Filter Actions:</span>
                    <div className="badges-container-inline">
                      {cumulativeLabels.map((lbl) => (
                        <span key={lbl} className="badge badge-label">
                          Label: {lbl}
                        </span>
                      ))}
                      {willArchive && (
                        <span className="badge badge-action">Archive</span>
                      )}
                      {willMarkRead && (
                        <span className="badge badge-action">Mark Read</span>
                      )}
                      {willNeverImportant && (
                        <span className="badge badge-action">Never Important</span>
                      )}
                      {willTrash && (
                        <span className="badge badge-trash">Trash</span>
                      )}
                      {forwardAddresses.map((fwd) => (
                        <span key={fwd} className="badge badge-action">
                          Forward to: {fwd}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Matching Filters Breakdown */}
              {matchingFilters.length > 0 && (
                <div className="matching-filters-list">
                  <h4>Matching Filters in Execution Order</h4>
                  {matchingFilters.map((match) => (
                    <div key={match.entry.id} className="match-card">
                      <div className="match-card-header">
                        <span className="match-filter-index">
                          Filter #{match.filterIndex + 1}
                        </span>
                        {onSelectFilter && (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              onSelectFilter(match.filterIndex);
                              onClose();
                            }}
                            title="Open and edit this filter in the workspace"
                          >
                            Jump to Filter →
                          </button>
                        )}
                      </div>

                      <div className="match-reasons">
                        {match.reasons.map((r, i) => (
                          <div key={i} className="match-reason-item">
                            • {r}
                          </div>
                        ))}
                      </div>

                      <div className="match-actions">
                        <span className="action-subtitle">Actions Applied:</span>
                        <div className="badges-container-inline">
                          {match.entry.properties.label && (
                            <span className="badge badge-label">
                              Label: {match.entry.properties.label}
                            </span>
                          )}
                          {match.entry.properties.shouldArchive === "true" && (
                            <span className="badge badge-action">Archive</span>
                          )}
                          {match.entry.properties.shouldMarkAsRead === "true" && (
                            <span className="badge badge-action">Mark Read</span>
                          )}
                          {match.entry.properties.shouldNeverMarkAsImportant === "true" && (
                            <span className="badge badge-action">No-Important</span>
                          )}
                          {match.entry.properties.shouldTrash === "true" && (
                            <span className="badge badge-trash">Trash</span>
                          )}
                          {match.entry.properties.forwardTo && (
                            <span className="badge badge-action">
                              Forward: {match.entry.properties.forwardTo}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
