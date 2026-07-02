from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from common import MAPPINGS_DIR, configure_project_environment, ensure_runtime_dirs, load_json, save_json


INDEX_HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SheetKiller Mapping Review</title>
  <style>
    :root {
      --bg: #f7f8fa;
      --panel: #ffffff;
      --line: #d9dee7;
      --text: #1f2933;
      --muted: #667085;
      --accent: #2563eb;
      --ok: #12805c;
      --warn: #b54708;
      --bad: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      background: var(--bg);
      font: 14px/1.45 "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
    }
    button, input, select, textarea {
      font: inherit;
    }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-rows: 48px 1fr;
    }
    header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    header strong {
      font-size: 15px;
    }
    header select, header input {
      height: 32px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 8px;
      background: #fff;
    }
    header input {
      min-width: 260px;
    }
    button {
      height: 32px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 10px;
      background: #fff;
      color: var(--text);
      cursor: pointer;
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    button:disabled {
      opacity: .55;
      cursor: not-allowed;
    }
    main {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(560px, 1fr) 380px;
    }
    .table-wrap {
      min-width: 0;
      overflow: auto;
      border-right: 1px solid var(--line);
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f2f4f7;
      color: #344054;
      font-weight: 600;
    }
    tr {
      cursor: pointer;
    }
    tr:hover td, tr.selected td {
      background: #eff6ff;
    }
    .status {
      display: inline-block;
      min-width: 74px;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      text-align: center;
      background: #eef2f6;
      color: var(--muted);
    }
    .status.needs_review, .status.needs_test { background: #fff4e5; color: var(--warn); }
    .status.skipped, .status.unmapped { background: #f2f4f7; color: var(--muted); }
    .status.ready { background: #e7f6ee; color: var(--ok); }
    aside {
      min-width: 0;
      overflow: auto;
      padding: 14px;
      background: #fbfcfe;
    }
    .field {
      margin-bottom: 12px;
    }
    .field label {
      display: block;
      margin-bottom: 4px;
      color: #344054;
      font-size: 12px;
      font-weight: 600;
    }
    .field input, .field select, .field textarea {
      width: 100%;
      min-height: 32px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 8px;
      background: #fff;
      color: var(--text);
    }
    .field textarea {
      min-height: 64px;
      resize: vertical;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .muted {
      color: var(--muted);
      font-size: 12px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }
    .grow { flex: 1; }
    .empty {
      padding: 24px;
      color: var(--muted);
    }
  </style>
</head>
<body>
<div class="app">
  <header>
    <strong>SheetKiller Mapping</strong>
    <select id="fileSelect"></select>
    <button id="loadBtn">Load</button>
    <input id="saveName" placeholder="mappings/iflytek.json" />
    <button class="primary" id="saveBtn">Save</button>
    <span class="muted" id="message"></span>
  </header>
  <main>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width: 120px;">Section</th>
            <th style="width: 180px;">Page Field</th>
            <th style="width: 120px;">Required</th>
            <th style="width: 160px;">Profile Key</th>
            <th style="width: 140px;">Strategy</th>
            <th style="width: 120px;">Status</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <div class="empty" id="empty">Load a draft mapping to begin.</div>
    </section>
    <aside>
      <div class="toolbar">
        <button id="enableBtn">Enable</button>
        <button id="skipBtn">Skip</button>
        <button id="readyBtn">Ready</button>
        <span class="grow"></span>
      </div>
      <div id="editor" class="muted">Select a row.</div>
    </aside>
  </main>
</div>
<script>
let mapping = null;
let selected = -1;

const $ = (id) => document.getElementById(id);
const msg = (text) => { $("message").textContent = text; };

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function outputNameFor(file) {
  if (!file) return "";
  return file.endsWith(".draft.json") ? file.replace(".draft.json", ".json") : file;
}

async function loadFiles() {
  const data = await api("/api/files");
  $("fileSelect").innerHTML = data.files.map((f) => `<option value="${f}">${f}</option>`).join("");
  if (data.files.length) {
    $("saveName").value = outputNameFor(data.files[0]);
    await loadMapping();
  }
}

async function loadMapping() {
  const file = $("fileSelect").value;
  if (!file) {
    mapping = null;
    render();
    return;
  }
  mapping = await api(`/api/mapping?file=${encodeURIComponent(file)}`);
  $("saveName").value = outputNameFor(file);
  selected = mapping.entries && mapping.entries.length ? 0 : -1;
  render();
  msg(`Loaded ${file}`);
}

function render() {
  const rows = $("rows");
  const entries = mapping?.entries || [];
  $("empty").style.display = entries.length ? "none" : "block";
  rows.innerHTML = entries.map((entry, i) => `
    <tr class="${i === selected ? "selected" : ""}" onclick="selectRow(${i})">
      <td title="${entry.section || ""}">${entry.section || ""}</td>
      <td title="${entry.label || ""}">${entry.label || entry.placeholder || entry.mapping_id}</td>
      <td>${entry.required ? "required" : ""}</td>
      <td title="${entry.profile_path || ""}">${entry.profile_path || ""}</td>
      <td>${entry.strategy || ""}</td>
      <td><span class="status ${entry.status || ""}">${entry.status || ""}</span></td>
    </tr>
  `).join("");
  renderEditor();
}

function selectRow(i) {
  selected = i;
  render();
}

function editorInput(label, key, type = "text") {
  const entry = mapping.entries[selected];
  const value = entry[key] ?? "";
  const escaped = htmlEscape(String(value));
  if (type === "textarea") {
    return `<div class="field"><label>${label}</label><textarea data-key="${key}">${escaped}</textarea></div>`;
  }
  return `<div class="field"><label>${label}</label><input data-key="${key}" value="${escaped}" /></div>`;
}

function editorSelect(label, key, values) {
  const entry = mapping.entries[selected];
  const current = entry[key] ?? "";
  return `<div class="field"><label>${label}</label><select data-key="${key}">
    ${values.map((value) => `<option value="${value}" ${value === current ? "selected" : ""}>${value}</option>`).join("")}
  </select></div>`;
}

function renderEditor() {
  const editor = $("editor");
  if (!mapping || selected < 0 || !mapping.entries[selected]) {
    editor.className = "muted";
    editor.textContent = "Select a row.";
    return;
  }
  editor.className = "";
  const entry = mapping.entries[selected];
  editor.innerHTML = `
    <div class="row">
      ${editorInput("Mapping ID", "mapping_id")}
      <div class="field"><label>Enabled</label><select data-key="enabled">
        <option value="true" ${entry.enabled ? "selected" : ""}>true</option>
        <option value="false" ${!entry.enabled ? "selected" : ""}>false</option>
      </select></div>
    </div>
    ${editorInput("Section", "section")}
    ${editorInput("Label", "label")}
    ${editorInput("Profile Path", "profile_path")}
    ${editorInput("Target Preview", "target_preview")}
    <div class="row">
      ${editorSelect("Control Type", "control_type", ["text_input", "textarea", "select_by_text", "cascader_region", "date_or_month", "autocomplete", "checkbox", "radio", "upload"])}
      ${editorSelect("Strategy", "strategy", ["text_input", "textarea", "select_by_text", "cascader_region", "date_or_month", "autocomplete", "checkbox", "radio", "skip_upload"])}
    </div>
    <div class="row">
      ${editorInput("Selector Type", "selector_type")}
      ${editorInput("Selector Value", "selector_value")}
    </div>
    <div class="row">
      ${editorSelect("Status", "status", ["needs_review", "needs_test", "ready", "skipped", "unmapped"])}
      ${editorSelect("On Fail", "on_fail", ["skip_and_report", "stop", "manual_required"])}
    </div>
    ${editorInput("Skip Reason", "skip_reason")}
    ${editorInput("Reason", "reason", "textarea")}
  `;
  editor.querySelector('[data-key="selector_type"]').value = entry.selector?.type || "";
  editor.querySelector('[data-key="selector_value"]').value = entry.selector?.value || "";
  editor.querySelectorAll("[data-key]").forEach((input) => {
    input.addEventListener("input", (event) => updateSelected(event, false));
    input.addEventListener("change", (event) => updateSelected(event, true));
  });
}

function htmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function updateSelected(event, shouldRender) {
  const entry = mapping.entries[selected];
  const key = event.target.dataset.key;
  let value = event.target.value;
  if (key === "enabled") value = value === "true";
  if (key === "selector_type") {
    entry.selector = entry.selector || {};
    entry.selector.type = value;
  } else if (key === "selector_value") {
    entry.selector = entry.selector || {};
    entry.selector.value = value;
  } else {
    entry[key] = value;
  }
  if (shouldRender) render();
}

function mutateSelected(callback) {
  if (!mapping || selected < 0) return;
  callback(mapping.entries[selected]);
  render();
}

async function saveMapping() {
  if (!mapping) return;
  const file = $("saveName").value.trim();
  if (!file) throw new Error("Missing save file name");
  const data = await api("/api/save", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({file, mapping})
  });
  msg(`Saved ${data.file}`);
  await loadFiles();
}

$("loadBtn").onclick = () => loadMapping().catch((err) => msg(err.message));
$("fileSelect").onchange = () => loadMapping().catch((err) => msg(err.message));
$("saveBtn").onclick = () => saveMapping().catch((err) => msg(err.message));
$("enableBtn").onclick = () => mutateSelected((entry) => { entry.enabled = true; entry.status = "needs_review"; });
$("skipBtn").onclick = () => mutateSelected((entry) => { entry.enabled = false; entry.strategy = "skip_upload"; entry.status = "skipped"; });
$("readyBtn").onclick = () => mutateSelected((entry) => { entry.enabled = true; entry.status = "ready"; });

loadFiles().catch((err) => msg(err.message));
</script>
</body>
</html>
"""


class ReviewHandler(BaseHTTPRequestHandler):
    server_version = "SheetKillerReview/0.1"

    def send_json(self, data: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_text(self, text: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        payload = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            payload = INDEX_HTML.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if parsed.path == "/api/files":
            files = []
            for path in sorted(MAPPINGS_DIR.glob("*.json")):
                try:
                    data = load_json(path)
                    if isinstance(data.get("entries"), list):
                        files.append(path.name)
                except Exception:
                    continue
            self.send_json({"files": files})
            return
        if parsed.path == "/api/mapping":
            query = parse_qs(parsed.query)
            file = query.get("file", [""])[0]
            try:
                path = safe_mapping_path(file)
                self.send_json(load_json(path))
            except Exception as exc:
                self.send_text(str(exc), HTTPStatus.BAD_REQUEST)
            return
        self.send_text("Not found", HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/save":
            self.send_text("Not found", HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            path = safe_mapping_path(payload["file"])
            mapping = payload["mapping"]
            save_json(path, mapping)
            self.send_json({"file": path.name})
        except Exception as exc:
            self.send_text(str(exc), HTTPStatus.BAD_REQUEST)


def safe_mapping_path(file_name: str) -> Path:
    if not file_name:
        raise ValueError("Missing mapping file name")
    candidate = (MAPPINGS_DIR / Path(file_name).name).resolve()
    if candidate.parent != MAPPINGS_DIR.resolve():
        raise ValueError("Mapping path must stay inside mcp-solution/mappings")
    if candidate.suffix != ".json":
        raise ValueError("Mapping file must end with .json")
    return candidate


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the local Mapping Review UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    ensure_runtime_dirs()
    configure_project_environment()
    server = ThreadingHTTPServer((args.host, args.port), ReviewHandler)
    url = f"http://{args.host}:{args.port}"
    print(f"Review UI: {url}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
