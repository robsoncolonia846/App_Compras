const STORAGE_KEY = "compras_v1";
const ENABLE_FILE_SYNC = false;
const BASE_FILE_NAME = "compras-base.json";
const HANDLE_DB_NAME = "compras_sync_db";
const HANDLE_STORE_NAME = "kv";
const HANDLE_KEY = "json_file_handle";
const JSON_PICKER_ID = "compras-json-base";
const IMPORT_HANDLE_KEY = "import_json_handle";

const form = document.getElementById("task-form");
const toggleFormBtn = document.getElementById("toggle-form-btn");
const syncJsonBtn = document.getElementById("sync-json-btn");
const importJsonBtn = document.getElementById("import-json-btn");
const exportJsonBtn = document.getElementById("export-json-btn");
const storageSourceEl = document.getElementById("storage-source");
const syncStatusEl = document.getElementById("sync-status");
const jsonFileInputEl = document.getElementById("json-file-input");

const titleInput = document.getElementById("title");
const dueDateInput = document.getElementById("dueDate");
const recurrenceInput = document.getElementById("recurrence");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");

const openListEl = document.getElementById("task-list-open");
const overdueListEl = document.getElementById("task-list-overdue");
const doneListEl = document.getElementById("task-list-done");
const deletedListEl = document.getElementById("task-list-deleted");
const template = document.getElementById("task-template");
const statsEl = document.getElementById("stats");
const monthLabelEl = document.getElementById("month-label");
const monthGridEl = document.getElementById("month-grid");
const monthPrevBtn = document.getElementById("month-prev");
const monthNextBtn = document.getElementById("month-next");
const monthCardEl = document.querySelector(".month-card");
const dayPreviewEl = document.getElementById("day-preview");
const dayPreviewTitleEl = document.getElementById("day-preview-title");
const dayPreviewListEl = document.getElementById("day-preview-list");
const dayPreviewGotoBtn = document.getElementById("day-preview-goto");
const dayPreviewCloseBtn = document.getElementById("day-preview-close");

const todayIso = () => new Date().toISOString().slice(0, 10);
dueDateInput.value = todayIso();

let tasks = loadTasks();
let editingTaskId = null;
let formOpen = false;
let sameDateMetaMap = {};
let monthCursor = new Date();
monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
let dragState = null;
let selectedDayPreviewDate = null;
let syncedFileHandle = null;
let fileSyncTimer = null;
let isWritingFile = false;

function setSyncStatus(text) {
  syncStatusEl.textContent = text;
}

function setStorageSource(text) {
  storageSourceEl.textContent = text;
  storageSourceEl.hidden = !text;
}

function supportsFileSync() {
  return typeof window.showSaveFilePicker === "function";
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        db.createObjectStore(HANDLE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key, value) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
    tx.objectStore(HANDLE_STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE_NAME, "readonly");
    const req = tx.objectStore(HANDLE_STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandleForAutoReconnect(handle) {
  if (!("indexedDB" in window)) return;
  try {
    await idbSet(HANDLE_KEY, handle);
  } catch {
    // Some browsers may block storing handles; app still works without auto reconnect.
  }
}

async function saveImportHandle(handle) {
  if (!("indexedDB" in window)) return;
  try {
    await idbSet(IMPORT_HANDLE_KEY, handle);
  } catch {
    // Browsers may block handle persistence.
  }
}

async function readSavedHandle() {
  if (!("indexedDB" in window)) return null;
  try {
    return await idbGet(HANDLE_KEY);
  } catch {
    return null;
  }
}

async function readSavedImportHandle() {
  if (!("indexedDB" in window)) return null;
  try {
    return await idbGet(IMPORT_HANDLE_KEY);
  } catch {
    return null;
  }
}

async function hasReadWritePermission(handle) {
  const current = await handle.queryPermission({ mode: "readwrite" });
  return current === "granted";
}

async function ensureReadWritePermission(handle) {
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") return true;
  const requested = await handle.requestPermission({ mode: "readwrite" });
  return requested === "granted";
}

async function hasReadPermission(handle) {
  if (!handle) return false;
  if (typeof handle.queryPermission !== "function") return true;
  try {
    const current = await handle.queryPermission({ mode: "read" });
    return current === "granted";
  } catch {
    return false;
  }
}

async function ensureReadPermission(handle) {
  if (!handle) return false;
  if (typeof handle.queryPermission !== "function") return true;
  try {
    const current = await handle.queryPermission({ mode: "read" });
    if (current === "granted") return true;
    if (typeof handle.requestPermission !== "function") return false;
    const requested = await handle.requestPermission({ mode: "read" });
    return requested === "granted";
  } catch {
    return false;
  }
}

function sanitizeJsonText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/^\uFEFF/, "").trim();
}

function extractTasksArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;

  const candidates = ["tasks", "atividades", "compras", "items", "data"];
  for (const key of candidates) {
    if (Array.isArray(parsed[key])) {
      return parsed[key];
    }
  }
  return null;
}

function parseTasksJsonText(text) {
  const cleanText = sanitizeJsonText(text);
  if (!cleanText) return [];

  const parsed = JSON.parse(cleanText);
  const data = extractTasksArray(parsed);
  if (!data) {
    throw new Error("JSON invalido. Use lista [ ... ] ou objeto { compras: [ ... ] }.");
  }
  return normalizeTasks(data);
}

function readFileAsText(file) {
  if (file && typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo."));
    reader.readAsText(file);
  });
}

async function readTasksFromHandle(handle) {
  const file = await handle.getFile();
  const text = await readFileAsText(file);
  return parseTasksJsonText(text);
}

async function writeTasksToHandle(handle) {
  if (!handle || isWritingFile) return;
  isWritingFile = true;

  try {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(tasks, null, 2));
    await writable.close();
    setSyncStatus(`Sincronizado em arquivo JSON (${new Date().toLocaleTimeString("pt-BR")}).`);
  } catch {
    setSyncStatus("Falha ao gravar no arquivo. Verifique permissoes.");
  } finally {
    isWritingFile = false;
  }
}

function scheduleFileSync() {
  if (!syncedFileHandle) return;
  if (fileSyncTimer) clearTimeout(fileSyncTimer);

  fileSyncTimer = setTimeout(() => {
    fileSyncTimer = null;
    void writeTasksToHandle(syncedFileHandle);
  }, 300);
}

async function connectHandle(handle, options = {}) {
  const { requestPermission = true } = options;

  try {
    const allowed = requestPermission
      ? await ensureReadWritePermission(handle)
      : await hasReadWritePermission(handle);

    if (!allowed) {
      setSyncStatus("Permissao negada para o arquivo JSON.");
      return false;
    }

    const loaded = await readTasksFromHandle(handle);
    syncedFileHandle = handle;
    setStorageSource(`Base: ${handle.name}`);

    if (loaded.length > 0 || tasks.length === 0) {
      tasks = loaded;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      render();
      setSyncStatus("Arquivo conectado. Dados carregados e sincronizacao ativa.");
    } else {
      setSyncStatus("Arquivo vazio conectado. Mantidos dados atuais e sincronizacao ativa.");
    }

    await saveHandleForAutoReconnect(handle);
    return true;
  } catch {
    setSyncStatus("Nao foi possivel conectar esse arquivo JSON.");
    return false;
  }
}

async function tryAutoReconnectSavedHandle() {
  if (!supportsFileSync()) return false;

  const savedHandle = await readSavedHandle();
  if (!savedHandle) return false;

  const connected = await connectHandle(savedHandle, { requestPermission: false });
  if (!connected) {
    setSyncStatus("Base salva encontrada, mas o navegador pediu nova permissao. Clique em Sincronizar JSON.");
    return false;
  }

  await writeTasksToHandle(savedHandle);
  setStorageSource(`Base: ${savedHandle.name}`);
  setSyncStatus("Base JSON reconectada automaticamente.");
  return true;
}

async function chooseJsonBase() {
  if (supportsFileSync() && typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({
        id: JSON_PICKER_ID,
        multiple: false,
        types: [
          {
            description: "Arquivo JSON",
            accept: {
              "application/json": [".json"],
              "text/plain": [".json", ".txt"],
            },
          },
        ],
      });

      const connected = await connectHandle(handle);
      if (connected) {
        await writeTasksToHandle(handle);
      }
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setSyncStatus("Falha ao abrir seletor de arquivo. Tente novamente.");
      return;
    }
  }

  if (supportsFileSync()) {
    try {
      const handle = await window.showSaveFilePicker({
        id: JSON_PICKER_ID,
        suggestedName: BASE_FILE_NAME,
        types: [
          {
            description: "Arquivo JSON",
            accept: {
              "application/json": [".json"],
              "text/plain": [".json", ".txt"],
            },
          },
        ],
      });

      const connected = await connectHandle(handle);
      if (connected) {
        await writeTasksToHandle(handle);
      }
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setSyncStatus("Falha ao abrir seletor de arquivo. Tente novamente.");
      return;
    }
  }

  if (jsonFileInputEl) {
    jsonFileInputEl.value = "";
    jsonFileInputEl.click();
  }
}

async function loadFromImportedFile(file) {
  if (!file) return false;
  try {
    const text = await readFileAsText(file);
    tasks = parseTasksJsonText(text);
    persist();
    setStorageSource(`Base: importada (${file.name})`);
    setSyncStatus(`JSON importado com sucesso (${file.name}).`);
    render();
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : "arquivo invalido.";
    setSyncStatus(`Erro ao importar JSON: ${message}`);
    return false;
  }
}

async function loadFromImportedHandle(handle, options = {}) {
  if (!handle) return false;

  const { requestPermission = false } = options;
  const allowed = requestPermission ? await ensureReadPermission(handle) : await hasReadPermission(handle);
  if (!allowed) return false;

  try {
    const file = await handle.getFile();
    const imported = await loadFromImportedFile(file);
    if (!imported) return false;
    await saveImportHandle(handle);
    return true;
  } catch {
    return false;
  }
}

async function importTasksJson() {
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const savedHandle = await readSavedImportHandle();
      if (savedHandle) {
        const reused = await loadFromImportedHandle(savedHandle, { requestPermission: false });
        if (reused) {
          setSyncStatus(`JSON recarregado do ultimo arquivo (${savedHandle.name}).`);
          return;
        }
      }

      const [handle] = await window.showOpenFilePicker({
        id: JSON_PICKER_ID,
        multiple: false,
        types: [
          {
            description: "Arquivo JSON",
            accept: {
              "application/json": [".json"],
              "text/plain": [".json", ".txt"],
            },
          },
        ],
      });

      const loaded = await loadFromImportedHandle(handle, { requestPermission: true });
      if (!loaded) {
        setSyncStatus("Nao foi possivel ler o arquivo selecionado.");
      }
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        setSyncStatus("Importacao cancelada.");
        return;
      }
      setSyncStatus("Falha ao abrir seletor do navegador. Tentando seletor simples...");
    }
  }

  if (jsonFileInputEl) {
    jsonFileInputEl.value = "";
    jsonFileInputEl.click();
  }
}

function buildExportFileName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `compras-backup-${yyyy}-${mm}-${dd}-${hh}-${mi}-${ss}.json`;
}

async function exportTasksJson() {
  const jsonText = JSON.stringify(tasks, null, 2);

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        id: JSON_PICKER_ID,
        suggestedName: buildExportFileName(),
        types: [
          {
            description: "Arquivo JSON",
            accept: {
              "application/json": [".json"],
              "text/plain": [".json", ".txt"],
            },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(jsonText);
      await writable.close();
      setSyncStatus("JSON exportado com sucesso.");
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        setSyncStatus("Exportacao cancelada.");
        return;
      }
      setSyncStatus("Falha ao salvar no local escolhido. Tentando download...");
    }
  }

  try {
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildExportFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setSyncStatus("JSON exportado por download.");
  } catch {
    setSyncStatus("Falha ao exportar JSON.");
  }
}

if (syncJsonBtn) {
  syncJsonBtn.addEventListener("click", () => {
    if (!ENABLE_FILE_SYNC) {
      setStorageSource("Base: local");
      setSyncStatus("Sincronizacao por arquivo desativada nesta versao. Dados salvos localmente.");
      return;
    }
    void chooseJsonBase();
  });
}

if (importJsonBtn && jsonFileInputEl) {
  importJsonBtn.addEventListener("click", () => {
    void importTasksJson();
  });
}

if (exportJsonBtn) {
  exportJsonBtn.addEventListener("click", () => {
    void exportTasksJson();
  });
}

if (jsonFileInputEl) {
  jsonFileInputEl.addEventListener("change", () => {
    const file = jsonFileInputEl.files && jsonFileInputEl.files[0];
    void loadFromImportedFile(file);
  });
}

function captureTaskPositions() {
  const map = new Map();
  document.querySelectorAll(".task-item[data-id]").forEach((el) => {
    map.set(el.dataset.id, el.getBoundingClientRect());
  });
  return map;
}

function animateTaskReorder(beforePositions) {
  if (!beforePositions || beforePositions.size === 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  document.querySelectorAll(".task-item[data-id]").forEach((el) => {
    const oldBox = beforePositions.get(el.dataset.id);
    if (!oldBox) return;

    const newBox = el.getBoundingClientRect();
    const dx = oldBox.left - newBox.left;
    const dy = oldBox.top - newBox.top;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  });
}

function setFormOpen(open) {
  formOpen = open;
  form.hidden = !open;
  toggleFormBtn.textContent = open ? "Fechar formulario" : "Novo item";
}

toggleFormBtn.addEventListener("click", () => {
  setFormOpen(!formOpen);
  if (formOpen) titleInput.focus();
});

monthPrevBtn.addEventListener("click", () => {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
  closeDayPreview();
  renderMonthlyPanel();
});

monthNextBtn.addEventListener("click", () => {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
  closeDayPreview();
  renderMonthlyPanel();
});

if (dayPreviewCloseBtn) {
  dayPreviewCloseBtn.addEventListener("click", () => {
    closeDayPreview();
    renderMonthlyPanel();
  });
}

if (dayPreviewGotoBtn) {
  dayPreviewGotoBtn.addEventListener("click", () => {
    scrollToSelectedDayInList();
  });
}

document.addEventListener("click", (event) => {
  if (!selectedDayPreviewDate || !monthCardEl) return;
  if (monthCardEl.contains(event.target)) return;
  closeDayPreview();
  renderMonthlyPanel();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const fd = new FormData(form);

  const payload = {
    title: String(fd.get("title") || "").trim(),
    dueDate: String(fd.get("dueDate") || todayIso()),
    recurrence: String(fd.get("recurrence") || "none"),
  };

  if (!payload.title) return;

  if (editingTaskId) {
    tasks = tasks.map((task) => {
      if (task.id !== editingTaskId) return task;
      return {
        ...task,
        title: payload.title,
        dueDate: payload.dueDate,
        recurrence: payload.recurrence,
        deleted: false,
        deletedAt: null,
        alarmTriggeredAt: null,
        nextDueDate: task.completed && payload.recurrence !== "none"
          ? task.nextDueDate || advanceDate(payload.dueDate, payload.recurrence)
          : null,
      };
    });
  } else {
    tasks.push({
      id: crypto.randomUUID(),
      title: payload.title,
      dueDate: payload.dueDate,
      recurrence: payload.recurrence,
      completed: false,
      completedAt: null,
      nextDueDate: null,
      deleted: false,
      deletedAt: null,
      alarmTime: "",
      alarmTriggeredAt: null,
      rank: Date.now(),
      createdAt: Date.now(),
    });
  }

  persist();
  resetFormMode();
  render();
});

cancelEditBtn.addEventListener("click", () => {
  resetFormMode();
});

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeTasks(parsed);
  } catch {
    return [];
  }
}

function normalizeTasks(list) {
  return list.map((task) => ({
    ...task,
    id: task.id || crypto.randomUUID(),
    title: String(task.title || "").trim(),
    dueDate: task.dueDate || todayIso(),
    recurrence: task.recurrence || "none",
    completed: Boolean(task.completed),
    completedAt: task.completedAt || null,
    nextDueDate: task.nextDueDate || null,
    deleted: Boolean(task.deleted),
    deletedAt: task.deletedAt || null,
    alarmTime: task.alarmTime || "",
    alarmTriggeredAt: task.alarmTriggeredAt || null,
    rank: task.rank ?? task.createdAt ?? Date.now(),
    createdAt: task.createdAt ?? Date.now(),
  }));
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  if (ENABLE_FILE_SYNC) {
    scheduleFileSync();
  }
}

function sortOpenTasks(list) {
  return [...list].sort(compareByDateThenRank);
}

function isTaskOverdue(task) {
  const [y, m, d] = getTaskCalendarDate(task).split("-").map(Number);
  const due = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function getOpenGroupTitle(isoDate, count) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const current = new Date();
  current.setHours(0, 0, 0, 0);
  const date = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  const base = formatDateWithWeekday(isoDate);
  const suffix = date < current ? "Atrasado" : isoDate === todayIso() ? "Hoje" : "";
  const countLabel = count === 1 ? "1 item" : `${count} itens`;

  return suffix
    ? `${base} - ${suffix} - ${countLabel}`
    : `${base} - ${countLabel}`;
}

function groupOpenTasksByDate(openTasks) {
  const grouped = new Map();

  for (const task of openTasks) {
    const key = getTaskCalendarDate(task);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(task);
  }

  return [...grouped.entries()].map(([date, items]) => ({
    date,
    title: getOpenGroupTitle(date, items.length),
    items,
  }));
}

function sortDoneTasks(list) {
  return [...list].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
}

function sortDeletedTasks(list) {
  return [...list].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

function compareByDateThenRank(a, b) {
  const dateA = getTaskCalendarDate(a);
  const dateB = getTaskCalendarDate(b);
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const rankA = a.rank ?? a.createdAt ?? 0;
  const rankB = b.rank ?? b.createdAt ?? 0;
  if (rankA !== rankB) return rankA - rankB;

  const createdA = a.createdAt ?? 0;
  const createdB = b.createdAt ?? 0;
  if (createdA !== createdB) return createdA - createdB;
  return String(a.id).localeCompare(String(b.id));
}

function createSameDateMetaMap(activeTasks) {
  const grouped = {};
  for (const task of activeTasks) {
    const key = getTaskCalendarDate(task);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(task);
  }

  const map = {};
  for (const key of Object.keys(grouped)) {
    const ordered = grouped[key].sort(compareByDateThenRank);
    ordered.forEach((task, index) => {
      map[task.id] = { index, total: ordered.length };
    });
  }
  return map;
}

function recurrenceLabel(key) {
  switch (key) {
    case "daily":
      return "Diaria";
    case "weekly":
      return "Semanal";
    case "monthly":
      return "Mensal";
    default:
      return "Nao recorrente";
  }
}

function advanceDate(isoDate, recurrence) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return todayIso();

  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);

  return d.toISOString().slice(0, 10);
}

function buildMetaExtraText(task, mode) {
  const statusText = mode === "deleted" ? "Status: removido" : task.completed ? "Status: comprado" : "Status: pendente";
  return `Recorrencia: ${recurrenceLabel(task.recurrence)} | ${statusText}`;
}

function postpone(id, days = 1) {
  tasks = tasks.map((t) => {
    if (t.id !== id || t.deleted) return t;

    const baseIso = t.completed && t.nextDueDate ? t.nextDueDate : t.dueDate;
    const base = new Date(`${baseIso}T12:00:00`);
    if (Number.isNaN(base.getTime())) return t;
    base.setDate(base.getDate() + days);

    const shifted = base.toISOString().slice(0, 10);

    if (t.completed && t.recurrence !== "none") {
      return {
        ...t,
        nextDueDate: shifted,
        alarmTriggeredAt: null,
      };
    }

    return {
      ...t,
      dueDate: shifted,
      completed: false,
      completedAt: null,
      nextDueDate: null,
      alarmTriggeredAt: null,
    };
  });
  persist();
  render();
}

function updateTaskDate(id, newDate) {
  tasks = tasks.map((t) => {
    if (t.id !== id || t.deleted) return t;

    if (t.completed && t.recurrence !== "none") {
      return {
        ...t,
        nextDueDate: newDate,
        alarmTriggeredAt: null,
      };
    }

    return {
      ...t,
      dueDate: newDate,
      nextDueDate: null,
      alarmTriggeredAt: null,
    };
  });

  persist();
  render();
}

function completeTask(task) {
  if (task.recurrence !== "none") {
    return {
      ...task,
      dueDate: advanceDate(task.dueDate, task.recurrence),
      completed: false,
      completedAt: null,
      nextDueDate: null,
      alarmTriggeredAt: null,
    };
  }

  return {
    ...task,
    completed: true,
    completedAt: Date.now(),
    nextDueDate: null,
    alarmTriggeredAt: null,
  };
}

function reopenTask(task) {
  if (task.recurrence !== "none") {
    return {
      ...task,
      dueDate: task.nextDueDate || advanceDate(task.dueDate, task.recurrence),
      completed: false,
      completedAt: null,
      nextDueDate: null,
      alarmTriggeredAt: null,
    };
  }

  return {
    ...task,
    completed: false,
    completedAt: null,
    nextDueDate: null,
    alarmTriggeredAt: null,
  };
}

function toggleComplete(id) {
  tasks = tasks.map((task) => {
    if (task.id !== id || task.deleted) return task;
    return task.completed ? reopenTask(task) : completeTask(task);
  });

  persist();
  render();
}

function slowScrollToTop(durationMs = 900) {
  const startY = window.scrollY || window.pageYOffset;
  if (startY <= 0) return;

  const startTime = performance.now();

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = easeInOutCubic(progress);
    const nextY = startY * (1 - eased);
    window.scrollTo(0, nextY);

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

function startEdit(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.deleted) return;

  editingTaskId = id;
  titleInput.value = task.title;
  dueDateInput.value = task.dueDate;
  recurrenceInput.value = task.recurrence;
  submitBtn.textContent = "Salvar edicao";
  cancelEditBtn.hidden = false;
  setFormOpen(true);
  slowScrollToTop(1000);
  titleInput.focus();
}

function reuseTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  resetFormMode();
  titleInput.value = task.title;
  dueDateInput.value = todayIso();
  recurrenceInput.value = task.recurrence || "none";
  setFormOpen(true);
  slowScrollToTop(1000);
  titleInput.focus();
}

function resetFormMode() {
  editingTaskId = null;
  submitBtn.textContent = "Adicionar";
  cancelEditBtn.hidden = true;
  form.reset();
  dueDateInput.value = todayIso();
  setFormOpen(false);
}

function removeTask(id) {
  tasks = tasks.map((task) => {
    if (task.id !== id) return task;
    return {
      ...task,
      deleted: true,
      deletedAt: Date.now(),
      completed: false,
      completedAt: null,
      nextDueDate: null,
    };
  });

  persist();

  if (editingTaskId === id) {
    resetFormMode();
  }

  render();
}

function moveTaskWithinDate(id, direction) {
  const baseTask = tasks.find((task) => task.id === id);
  if (!baseTask || baseTask.deleted) return;

  const dateKey = getTaskCalendarDate(baseTask);
  const sameDate = tasks
    .filter((task) => !task.deleted && getTaskCalendarDate(task) === dateKey)
    .sort(compareByDateThenRank);

  const index = sameDate.findIndex((task) => task.id === id);
  if (index < 0) return;

  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= sameDate.length) return;

  const current = sameDate[index];
  const target = sameDate[newIndex];
  const currentRank = current.rank ?? current.createdAt ?? 0;
  const targetRank = target.rank ?? target.createdAt ?? 0;

  tasks = tasks.map((task) => {
    if (task.id === current.id) return { ...task, rank: targetRank };
    if (task.id === target.id) return { ...task, rank: currentRank };
    return task;
  });

  persist();
  render();
}

function setTaskRank(id, nextRank) {
  tasks = tasks.map((task) => {
    if (task.id !== id) return task;
    return { ...task, rank: nextRank };
  });
}

function getRankBetween(previousTask, nextTask) {
  const gap = 1024;

  if (!previousTask && !nextTask) {
    return Date.now();
  }

  if (!previousTask) {
    const nextRank = nextTask.rank ?? nextTask.createdAt ?? 0;
    return nextRank - gap;
  }

  if (!nextTask) {
    const previousRank = previousTask.rank ?? previousTask.createdAt ?? 0;
    return previousRank + gap;
  }

  const previousRank = previousTask.rank ?? previousTask.createdAt ?? 0;
  const nextRank = nextTask.rank ?? nextTask.createdAt ?? 0;
  const middleRank = previousRank + (nextRank - previousRank) / 2;

  if (Number.isFinite(middleRank) && middleRank !== previousRank && middleRank !== nextRank) {
    return middleRank;
  }

  return previousRank + gap / 2;
}

function normalizeRanksForDate(dateKey) {
  const sameDate = tasks
    .filter((task) => !task.deleted && getTaskCalendarDate(task) === dateKey)
    .sort(compareByDateThenRank);

  tasks = tasks.map((task) => {
    const index = sameDate.findIndex((item) => item.id === task.id);
    if (index === -1) return task;
    return {
      ...task,
      rank: (index + 1) * 1024,
    };
  });
}

function moveTaskByDrag(draggedId, targetId, placement) {
  if (!draggedId || !targetId || draggedId === targetId) return;

  const draggedTask = tasks.find((task) => task.id === draggedId);
  const targetTask = tasks.find((task) => task.id === targetId);
  if (!draggedTask || !targetTask || draggedTask.deleted || targetTask.deleted) return;

  const dateKey = getTaskCalendarDate(draggedTask);
  if (dateKey !== getTaskCalendarDate(targetTask)) return;

  const sameDate = tasks
    .filter((task) => !task.deleted && getTaskCalendarDate(task) === dateKey)
    .sort(compareByDateThenRank);

  const draggedIndex = sameDate.findIndex((task) => task.id === draggedId);
  const targetIndex = sameDate.findIndex((task) => task.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0) return;

  const ordered = sameDate.filter((task) => task.id !== draggedId);
  const rawInsertIndex = placement === "before" ? targetIndex : targetIndex + 1;
  const insertIndex = Math.max(0, Math.min(rawInsertIndex > draggedIndex ? rawInsertIndex - 1 : rawInsertIndex, ordered.length));
  ordered.splice(insertIndex, 0, draggedTask);

  const movedIndex = ordered.findIndex((task) => task.id === draggedId);
  const previousTask = ordered[movedIndex - 1] || null;
  const nextTask = ordered[movedIndex + 1] || null;

  setTaskRank(draggedId, getRankBetween(previousTask, nextTask));
  normalizeRanksForDate(dateKey);
  persist();
  render();
}

function clearDragIndicators() {
  document.querySelectorAll(".task-item.drag-over-before, .task-item.drag-over-after, .task-item.is-dragging").forEach((el) => {
    el.classList.remove("drag-over-before", "drag-over-after", "is-dragging");
  });
}

function updateDragTarget(draggedId, node, clientY) {
  if (!draggedId || !node || node.dataset.id === draggedId) return false;

  const draggedTask = tasks.find((item) => item.id === draggedId);
  const targetTask = tasks.find((item) => item.id === node.dataset.id);
  if (!draggedTask || !targetTask) return false;
  if (getTaskCalendarDate(draggedTask) !== getTaskCalendarDate(targetTask)) return false;

  const placement = getDragPlacement(node, { clientY });
  clearDragIndicators();
  const draggedNode = document.querySelector(`.task-item[data-id="${draggedId}"]`);
  if (draggedNode) draggedNode.classList.add("is-dragging");
  node.classList.toggle("drag-over-before", placement === "before");
  node.classList.toggle("drag-over-after", placement === "after");
  dragState.targetId = targetTask.id;
  dragState.placement = placement;
  return true;
}

function getDragPlacement(node, event) {
  const rect = node.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  return event.clientY < midpoint ? "before" : "after";
}

function findTouchDropTarget(draggedId, clientY) {
  const draggedTask = tasks.find((item) => item.id === draggedId);
  if (!draggedTask) return null;

  const candidates = [...document.querySelectorAll(".task-item[data-id]")]
    .filter((item) => item.dataset.id !== draggedId)
    .filter((item) => {
      const candidateTask = tasks.find((task) => task.id === item.dataset.id);
      return candidateTask && getTaskCalendarDate(candidateTask) === getTaskCalendarDate(draggedTask);
    });

  for (const item of candidates) {
    const rect = item.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return item;
    }
  }

  return null;
}

function attachDragHandlers(node, task, mode) {
  if (mode !== "open") return;

  node.draggable = true;

  node.addEventListener("dragstart", (event) => {
    dragState = { id: task.id };
    node.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", task.id);
    }
  });

  node.addEventListener("dragover", (event) => {
    if (!dragState || dragState.id === task.id) return;
    event.preventDefault();
    updateDragTarget(dragState.id, node, event.clientY);
  });

  node.addEventListener("dragleave", (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && node.contains(related)) return;
    node.classList.remove("drag-over-before", "drag-over-after");
  });

  node.addEventListener("drop", (event) => {
    if (!dragState || dragState.id === task.id) return;
    event.preventDefault();
    const targetId = dragState.targetId || task.id;
    const placement = dragState.placement || getDragPlacement(node, event);
    moveTaskByDrag(dragState.id, targetId, placement);
  });

  node.addEventListener("dragend", () => {
    dragState = null;
    clearDragIndicators();
  });

  node.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    if (event.target.closest("button, input, select, label")) return;

    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers may reject capture; dragging can still continue.
    }

    dragState = {
      id: task.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      targetId: null,
      placement: null,
    };
  });

  node.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId || dragState.id !== task.id) return;

    const movedX = Math.abs(event.clientX - dragState.startX);
    const movedY = Math.abs(event.clientY - dragState.startY);

    if (!dragState.dragging) {
      if (Math.max(movedX, movedY) < 10) return;
      dragState.dragging = true;
      node.classList.add("is-dragging");
    }

    event.preventDefault();
    const targetEl = findTouchDropTarget(task.id, event.clientY);
    if (!targetEl) {
      clearDragIndicators();
      node.classList.add("is-dragging");
      dragState.targetId = null;
      dragState.placement = null;
      return;
    }

    const updated = updateDragTarget(task.id, targetEl, event.clientY);
    if (!updated) {
      clearDragIndicators();
      node.classList.add("is-dragging");
      dragState.targetId = null;
      dragState.placement = null;
    }
  });

  function finishPointerDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId || dragState.id !== task.id) return;

    try {
      node.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore browsers that do not support capture release here.
    }

    const { dragging, targetId, placement } = dragState;
    dragState = null;
    clearDragIndicators();

    if (!dragging || !targetId || !placement) return;
    moveTaskByDrag(task.id, targetId, placement);
  }

  node.addEventListener("pointerup", finishPointerDrag);
  node.addEventListener("pointercancel", finishPointerDrag);
}

function purgeTask(id) {
  tasks = tasks.filter((task) => task.id !== id);
  persist();

  if (editingTaskId === id) {
    resetFormMode();
  }

  render();
}

function renderTask(task, mode) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  node.dataset.dateKey = getTaskCalendarDate(task);
  node.classList.toggle("done", task.completed);
  node.classList.toggle("deleted", mode === "deleted");

  const toggleBtn = node.querySelector(".btn-toggle");
  const datePicker = node.querySelector(".date-picker-inline");
  const dateBtn = node.querySelector(".btn-calendar");
  const minusBtn = node.querySelector(".btn-postpone-minus");
  const plusBtn = node.querySelector(".btn-postpone");
  const editBtn = node.querySelector(".btn-edit");
  const deleteBtn = node.querySelector(".btn-delete");
  const moveUpBtn = node.querySelector(".btn-move-up");
  const moveDownBtn = node.querySelector(".btn-move-down");
  const restoreBtn = node.querySelector(".btn-restore");

  toggleBtn.classList.toggle("checked", task.completed);

  const displayDate = task.completed && task.nextDueDate
    ? `${formatDateWithWeekday(task.dueDate)} -> ${formatDateWithWeekday(task.nextDueDate)}`
    : formatDateWithWeekday(task.dueDate);
  const editableDate = task.completed && task.recurrence !== "none" && task.nextDueDate ? task.nextDueDate : task.dueDate;

  const h3 = node.querySelector("h3");
  h3.textContent = "";
  h3.appendChild(document.createTextNode(task.title));
  node.querySelector(".meta-date").textContent = `Data: ${displayDate}`;

  node.querySelector(".meta-extra").textContent = buildMetaExtraText(task, mode);

  datePicker.value = editableDate;

  if (mode === "deleted") {
    toggleBtn.classList.add("is-hidden");
    minusBtn.classList.add("is-hidden");
    plusBtn.classList.add("is-hidden");
    dateBtn.classList.add("is-hidden");
    datePicker.classList.add("is-hidden");
    editBtn.classList.add("is-hidden");
    moveUpBtn.classList.add("is-hidden");
    moveDownBtn.classList.add("is-hidden");
    deleteBtn.textContent = "Excluir de vez";
    deleteBtn.title = "Excluir permanentemente";
    deleteBtn.addEventListener("click", () => purgeTask(task.id));
  } else {
    restoreBtn.classList.add("is-hidden");
    const sameDateMeta = sameDateMetaMap[task.id] || { index: 0, total: 1 };
    if (sameDateMeta.total <= 1) {
      moveUpBtn.classList.add("is-hidden");
      moveDownBtn.classList.add("is-hidden");
    } else {
      moveUpBtn.disabled = sameDateMeta.index === 0;
      moveDownBtn.disabled = sameDateMeta.index === sameDateMeta.total - 1;
      moveUpBtn.addEventListener("click", () => moveTaskWithinDate(task.id, -1));
      moveDownBtn.addEventListener("click", () => moveTaskWithinDate(task.id, 1));
    }

    toggleBtn.addEventListener("click", () => toggleComplete(task.id));
    dateBtn.addEventListener("click", () => {
      datePicker.classList.add("show");
      try {
        datePicker.showPicker();
      } catch {
        datePicker.focus();
        datePicker.click();
      }
    });

    datePicker.addEventListener("change", () => {
      if (!datePicker.value) return;
      updateTaskDate(task.id, datePicker.value);
      datePicker.classList.remove("show");
    });

    datePicker.addEventListener("blur", () => {
      datePicker.classList.remove("show");
    });

    minusBtn.addEventListener("click", () => postpone(task.id, -1));
    plusBtn.addEventListener("click", () => postpone(task.id, 1));
    editBtn.addEventListener("click", () => startEdit(task.id));
    deleteBtn.addEventListener("click", () => removeTask(task.id));
  }

  restoreBtn.addEventListener("click", () => reuseTask(task.id));
  attachDragHandlers(node, task, mode);

  return node;
}

function getTaskCalendarDate(task) {
  if (task.completed && task.recurrence !== "none" && task.nextDueDate) {
    return task.nextDueDate;
  }
  return task.dueDate;
}

function buildDateCountMap(rangeStart, rangeEnd) {
  const counts = {};

  for (const task of tasks) {
    if (task.deleted || task.completed) continue;
    const dateKey = getTaskCalendarDate(task);
    const [ty, tm, td] = dateKey.split("-").map(Number);
    const taskDate = new Date(ty, (tm || 1) - 1, td || 1, 12, 0, 0, 0);
    if (taskDate < rangeStart || taskDate > rangeEnd) continue;
    counts[dateKey] = (counts[dateKey] || 0) + 1;
  }

  return counts;
}

function closeDayPreview() {
  selectedDayPreviewDate = null;
  if (dayPreviewEl) dayPreviewEl.hidden = true;
  applySelectedDayGroupHighlight();
}

function getDayPreviewTasks(dateKey) {
  return sortOpenTasks(
    tasks.filter((task) => !task.deleted && !task.completed && getTaskCalendarDate(task) === dateKey),
  );
}

function renderDayPreview() {
  if (!dayPreviewEl || !dayPreviewTitleEl || !dayPreviewListEl) return;
  if (!selectedDayPreviewDate) {
    dayPreviewEl.hidden = true;
    if (dayPreviewGotoBtn) dayPreviewGotoBtn.disabled = true;
    return;
  }

  const dayTasks = getDayPreviewTasks(selectedDayPreviewDate);
  const titleDate = formatDateWithWeekday(selectedDayPreviewDate);
  const qty = dayTasks.length;
  dayPreviewTitleEl.textContent = `${titleDate} - ${qty} item${qty === 1 ? "" : "s"}`;

  dayPreviewListEl.innerHTML = "";
  if (qty === 0) {
    dayPreviewListEl.innerHTML = '<li class="empty-state">Nenhum item pendente nesse dia.</li>';
  } else {
    for (const task of dayTasks) {
      const item = document.createElement("li");
      item.textContent = task.title;
      dayPreviewListEl.appendChild(item);
    }
  }

  dayPreviewEl.hidden = false;
  if (dayPreviewGotoBtn) dayPreviewGotoBtn.disabled = qty === 0;
}

function openDayPreview(dateKey) {
  selectedDayPreviewDate = dateKey;
  renderDayPreview();
  applySelectedDayGroupHighlight();
  if (dayPreviewEl) {
    dayPreviewEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function applySelectedDayGroupHighlight() {
  document.querySelectorAll(".open-subgroup.selected-day-group").forEach((el) => {
    el.classList.remove("selected-day-group");
  });

  if (!selectedDayPreviewDate) return;
  const escapedDate = CSS.escape(selectedDayPreviewDate);
  const group = document.querySelector(`.open-subgroup[data-date-key="${escapedDate}"]`);
  if (group) {
    group.classList.add("selected-day-group");
  }
}

function scrollToSelectedDayInList() {
  if (!selectedDayPreviewDate) return;

  const escapedDate = CSS.escape(selectedDayPreviewDate);
  const target = document.querySelector(`.open-subgroup[data-date-key="${escapedDate}"]`);
  if (!target) {
    setSyncStatus("Nao achei itens desse dia na lista.");
    return;
  }

  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderMonthlyPanel() {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const monthName = firstDay.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year &&
    today.getMonth() === month;

  const gridStart = isCurrentMonth
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
    : new Date(year, month, 1 - firstDay.getDay());
  gridStart.setHours(12, 0, 0, 0);

  const totalCells = 35;
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + totalCells - 1);
  const dateCount = buildDateCountMap(gridStart, gridEnd);

  monthLabelEl.textContent = monthName;
  monthGridEl.innerHTML = "";

  for (let offset = 0; offset < totalCells; offset += 1) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + offset);
    const cell = document.createElement("div");
    cell.className = "month-day";

    if (
      today.getFullYear() === cellDate.getFullYear() &&
      today.getMonth() === cellDate.getMonth() &&
      today.getDate() === cellDate.getDate()
    ) {
      cell.classList.add("today");
    }

    if (cellDate.getMonth() !== month) {
      cell.classList.add("outside-month");
    }

    const num = document.createElement("div");
    num.className = "day-number";
    num.textContent = String(cellDate.getDate());
    cell.appendChild(num);

    const dateKey = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, "0")}-${String(cellDate.getDate()).padStart(2, "0")}`;
    const count = dateCount[dateKey] || 0;
    if (selectedDayPreviewDate === dateKey) {
      cell.classList.add("selected-day");
    }
    if (count > 0) {
      const dots = document.createElement("div");
      dots.className = "day-dots";
      const tag = document.createElement("span");
      tag.className = "day-tag";
      tag.textContent = String(count);
      dots.appendChild(tag);
      cell.appendChild(dots);

      cell.classList.add("has-tasks");
      cell.addEventListener("click", () => openDayPreview(dateKey));
    }

    monthGridEl.appendChild(cell);
  }
}

function render() {
  const beforePositions = captureTaskPositions();

  overdueListEl.innerHTML = "";
  openListEl.innerHTML = "";
  doneListEl.innerHTML = "";
  deletedListEl.innerHTML = "";

  const activeTasks = tasks.filter((t) => !t.deleted);
  sameDateMetaMap = createSameDateMetaMap(activeTasks);
  const openTasksAll = sortOpenTasks(activeTasks.filter((t) => !t.completed));
  const overdueTasks = openTasksAll.filter((task) => isTaskOverdue(task));
  const openTasks = openTasksAll.filter((task) => !isTaskOverdue(task));
  const doneTasks = sortDoneTasks(activeTasks.filter((t) => t.completed));
  const deletedTasks = sortDeletedTasks(tasks.filter((t) => t.deleted));

  if (overdueTasks.length === 0) {
    overdueListEl.innerHTML = '<li class="empty-state">Nenhum item atrasado.</li>';
  } else {
    for (const task of overdueTasks) {
      overdueListEl.appendChild(renderTask(task, "open"));
    }
  }

  if (openTasks.length === 0) {
    openListEl.innerHTML = '<li class="empty-state">Nenhum item para comprar.</li>';
  } else {
    const groups = groupOpenTasksByDate(openTasks);

    for (const group of groups) {
      if (group.items.length === 0) continue;

      const groupItem = document.createElement("li");
      groupItem.className = "open-subgroup";
      groupItem.dataset.dateKey = group.date;

      const heading = document.createElement("h4");
      heading.className = "open-subgroup-title";
      heading.textContent = group.title;

      const list = document.createElement("ul");
      list.className = "open-subgroup-list";

      for (const task of group.items) {
        list.appendChild(renderTask(task, "open"));
      }

      groupItem.appendChild(heading);
      groupItem.appendChild(list);
      openListEl.appendChild(groupItem);
    }
  }

  if (doneTasks.length === 0) {
    doneListEl.innerHTML = '<li class="empty-state">Nenhum item comprado.</li>';
  } else {
    for (const task of doneTasks) {
      doneListEl.appendChild(renderTask(task, "done"));
    }
  }

  if (deletedTasks.length === 0) {
    deletedListEl.innerHTML = '<li class="empty-state">Nenhum item removido.</li>';
  } else {
    for (const task of deletedTasks) {
      deletedListEl.appendChild(renderTask(task, "deleted"));
    }
  }

  statsEl.textContent = "";
  renderMonthlyPanel();
  renderDayPreview();
  applySelectedDayGroupHighlight();
  animateTaskReorder(beforePositions);
}

function formatDateWithWeekday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  return `${dt.toLocaleDateString("pt-BR")} (${weekdays[dt.getDay()]})`;
}

setStorageSource("Base: local");
setSyncStatus("Dados salvos localmente. Use Importar/Exportar JSON para backup.");
render();
if (ENABLE_FILE_SYNC) {
  void tryAutoReconnectSavedHandle();
}





