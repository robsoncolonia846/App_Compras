const STORAGE_KEY = "shopping_open_list_v1";
const LEGACY_KEYS = ["compras_v1", "tasks_v1"];

const form = document.getElementById("task-form");
const toggleFormBtn = document.getElementById("toggle-form-btn");
const importJsonBtn = document.getElementById("import-json-btn");
const exportJsonBtn = document.getElementById("export-json-btn");
const storageSourceEl = document.getElementById("storage-source");
const syncStatusEl = document.getElementById("sync-status");
const jsonFileInputEl = document.getElementById("json-file-input");

const titleInput = document.getElementById("title");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");

const openListEl = document.getElementById("task-list-open");
const doneListEl = document.getElementById("task-list-done");
const deletedListEl = document.getElementById("task-list-deleted");
const template = document.getElementById("task-template");
const statsEl = document.getElementById("stats");

let items = loadItems();
let formOpen = false;
let editingItemId = null;

function setSyncStatus(text) {
  syncStatusEl.textContent = text;
}

function setStorageSource(text) {
  storageSourceEl.textContent = text;
  storageSourceEl.hidden = !text;
}

function safeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeItem(raw, index = 0) {
  const title = typeof raw === "string"
    ? raw.trim()
    : String((raw && raw.title) || "").trim();

  if (!title) return null;

  const rank = Number(
    raw && typeof raw === "object" && Number.isFinite(Number(raw.rank))
      ? Number(raw.rank)
      : (index + 1) * 1024,
  );

  const id = raw && typeof raw === "object" && raw.id
    ? String(raw.id)
    : safeId();

  return {
    id,
    title,
    rank,
    completed: Boolean(raw && raw.completed),
    deleted: Boolean(raw && raw.deleted),
    deletedAt: raw && raw.deletedAt ? String(raw.deletedAt) : null,
  };
}

function normalizeItems(input) {
  if (!Array.isArray(input)) return [];

  const normalized = [];
  for (let i = 0; i < input.length; i += 1) {
    const item = normalizeItem(input[i], i);
    if (item) normalized.push(item);
  }

  return normalized;
}

function extractItemsArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;

  const candidates = ["items", "compras", "tasks", "atividades", "data"];
  for (const key of candidates) {
    if (Array.isArray(parsed[key])) {
      return parsed[key];
    }
  }

  return null;
}

function parseItemsJsonText(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!clean) return [];

  const parsed = JSON.parse(clean);
  const data = extractItemsArray(parsed);
  if (!data) {
    throw new Error("JSON invalido. Use lista [ ... ] ou objeto { items: [ ... ] }.");
  }

  return normalizeItems(data);
}

function readLocalStorageList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return normalizeItems(JSON.parse(raw));
  } catch {
    return null;
  }
}

function loadItems() {
  const current = readLocalStorageList(STORAGE_KEY);
  if (current) return current;

  for (const key of LEGACY_KEYS) {
    const legacy = readLocalStorageList(key);
    if (legacy && legacy.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      return legacy;
    }
  }

  return [];
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function getOrderedItems(source) {
  return [...source].sort((a, b) => {
    const rankDiff = Number(a.rank) - Number(b.rank);
    if (rankDiff !== 0) return rankDiff;
    return a.title.localeCompare(b.title, "pt-BR");
  });
}

function getOpenItems() {
  return getOrderedItems(items.filter((entry) => !entry.deleted && !entry.completed));
}

function getDoneItems() {
  return getOrderedItems(items.filter((entry) => !entry.deleted && entry.completed));
}

function getDeletedItems() {
  return [...items]
    .filter((entry) => entry.deleted)
    .sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")));
}

function normalizeOpenRanks() {
  const openItems = getOpenItems();
  const rankMap = new Map();

  for (let i = 0; i < openItems.length; i += 1) {
    rankMap.set(openItems[i].id, (i + 1) * 1024);
  }

  items = items.map((entry) => {
    if (!rankMap.has(entry.id)) return entry;
    return { ...entry, rank: rankMap.get(entry.id) };
  });
}

function getMaxOpenRank() {
  return getOpenItems().reduce((acc, entry) => Math.max(acc, Number(entry.rank) || 0), 0);
}

function resetFormMode() {
  editingItemId = null;
  submitBtn.textContent = "Adicionar";
  cancelEditBtn.hidden = true;
  form.reset();
}

function setFormOpen(open) {
  formOpen = open;
  form.hidden = !open;
  toggleFormBtn.textContent = open ? "Fechar formulario" : "Novo item";
}

function startEdit(id) {
  const item = items.find((entry) => entry.id === id && !entry.deleted);
  if (!item) return;

  editingItemId = id;
  submitBtn.textContent = "Salvar";
  cancelEditBtn.hidden = false;
  titleInput.value = item.title;
  setFormOpen(true);
  titleInput.focus();
}

function toggleComplete(id) {
  items = items.map((entry) => {
    if (entry.id !== id || entry.deleted) return entry;
    return {
      ...entry,
      completed: !entry.completed,
    };
  });

  persist();
  render();
}

function removeItem(id) {
  items = items.map((entry) => {
    if (entry.id !== id || entry.deleted) return entry;
    return {
      ...entry,
      deleted: true,
      deletedAt: new Date().toISOString(),
      completed: false,
    };
  });

  if (editingItemId === id) {
    resetFormMode();
    setFormOpen(false);
  }

  persist();
  render();
}

function restoreItem(id) {
  const nextRank = getMaxOpenRank() + 1024;

  items = items.map((entry) => {
    if (entry.id !== id || !entry.deleted) return entry;
    return {
      ...entry,
      deleted: false,
      deletedAt: null,
      completed: false,
      rank: nextRank,
    };
  });

  persist();
  render();
}

function purgeItem(id) {
  items = items.filter((entry) => entry.id !== id);
  if (editingItemId === id) {
    resetFormMode();
    setFormOpen(false);
  }

  persist();
  render();
}

function moveItem(id, offset) {
  const ordered = getOpenItems();
  const index = ordered.findIndex((entry) => entry.id === id);
  if (index < 0) return;

  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= ordered.length) return;

  const [picked] = ordered.splice(index, 1);
  ordered.splice(nextIndex, 0, picked);

  const rankMap = new Map();
  for (let i = 0; i < ordered.length; i += 1) {
    rankMap.set(ordered[i].id, (i + 1) * 1024);
  }

  items = items.map((entry) => {
    if (!rankMap.has(entry.id)) return entry;
    return { ...entry, rank: rankMap.get(entry.id) };
  });

  persist();
  render();
}

function renderItem(item, index, total, mode) {
  const node = template.content.firstElementChild.cloneNode(true);
  const titleEl = node.querySelector("h3");
  const toggleBtn = node.querySelector(".btn-toggle");
  const editBtn = node.querySelector(".btn-edit");
  const deleteBtn = node.querySelector(".btn-delete");
  const moveUpBtn = node.querySelector(".btn-move-up");
  const moveDownBtn = node.querySelector(".btn-move-down");
  const restoreBtn = node.querySelector(".btn-restore");

  node.dataset.id = item.id;
  titleEl.textContent = item.title;
  node.classList.toggle("done", mode === "done");
  node.classList.toggle("deleted", mode === "deleted");

  restoreBtn.classList.add("is-hidden");

  if (mode === "open") {
    toggleBtn.classList.toggle("checked", false);
    toggleBtn.title = "Concluir item";
    toggleBtn.setAttribute("aria-label", "Concluir item");
    toggleBtn.addEventListener("click", () => toggleComplete(item.id));

    editBtn.addEventListener("click", () => startEdit(item.id));
    deleteBtn.addEventListener("click", () => removeItem(item.id));

    moveUpBtn.disabled = index === 0;
    moveDownBtn.disabled = index === total - 1;
    moveUpBtn.addEventListener("click", () => moveItem(item.id, -1));
    moveDownBtn.addEventListener("click", () => moveItem(item.id, 1));
  }

  if (mode === "done") {
    toggleBtn.classList.toggle("checked", true);
    toggleBtn.title = "Reabrir item";
    toggleBtn.setAttribute("aria-label", "Reabrir item");
    toggleBtn.addEventListener("click", () => toggleComplete(item.id));

    editBtn.classList.add("is-hidden");
    moveUpBtn.classList.add("is-hidden");
    moveDownBtn.classList.add("is-hidden");

    deleteBtn.addEventListener("click", () => removeItem(item.id));
  }

  if (mode === "deleted") {
    toggleBtn.classList.add("is-hidden");
    editBtn.classList.add("is-hidden");
    moveUpBtn.classList.add("is-hidden");
    moveDownBtn.classList.add("is-hidden");

    restoreBtn.classList.remove("is-hidden");
    restoreBtn.addEventListener("click", () => restoreItem(item.id));

    deleteBtn.textContent = "Excluir de vez";
    deleteBtn.title = "Excluir permanentemente";
    deleteBtn.addEventListener("click", () => purgeItem(item.id));
  }

  return node;
}

function render() {
  openListEl.innerHTML = "";
  doneListEl.innerHTML = "";
  deletedListEl.innerHTML = "";

  normalizeOpenRanks();

  const openItems = getOpenItems();
  const doneItems = getDoneItems();
  const deletedItems = getDeletedItems();

  if (openItems.length === 0) {
    openListEl.innerHTML = '<li class="empty-state">Nenhum item em aberto.</li>';
  } else {
    for (let i = 0; i < openItems.length; i += 1) {
      openListEl.appendChild(renderItem(openItems[i], i, openItems.length, "open"));
    }
  }

  if (doneItems.length === 0) {
    doneListEl.innerHTML = '<li class="empty-state">Nenhum item concluido.</li>';
  } else {
    for (let i = 0; i < doneItems.length; i += 1) {
      doneListEl.appendChild(renderItem(doneItems[i], i, doneItems.length, "done"));
    }
  }

  if (deletedItems.length === 0) {
    deletedListEl.innerHTML = '<li class="empty-state">Nenhum item excluido.</li>';
  } else {
    for (let i = 0; i < deletedItems.length; i += 1) {
      deletedListEl.appendChild(renderItem(deletedItems[i], i, deletedItems.length, "deleted"));
    }
  }

  statsEl.textContent = `${openItems.length} em aberto | ${doneItems.length} concluidos | ${deletedItems.length} excluidos`;
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

async function loadFromImportedFile(file) {
  if (!file) return false;

  try {
    const text = await readFileAsText(file);
    items = parseItemsJsonText(text);
    normalizeOpenRanks();
    persist();
    render();
    setStorageSource(`Base: importada (${file.name})`);
    setSyncStatus(`JSON importado com sucesso (${file.name}).`);
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : "arquivo invalido.";
    setSyncStatus(`Erro ao importar JSON: ${message}`);
    return false;
  }
}

async function importItemsJson() {
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({
        id: "compras-json-import",
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

      const file = await handle.getFile();
      await loadFromImportedFile(file);
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

async function exportItemsJson() {
  const jsonText = JSON.stringify(items, null, 2);

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        id: "compras-json-export",
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
    const link = document.createElement("a");
    link.href = url;
    link.download = buildExportFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setSyncStatus("JSON exportado por download.");
  } catch {
    setSyncStatus("Falha ao exportar JSON.");
  }
}

toggleFormBtn.addEventListener("click", () => {
  setFormOpen(!formOpen);
  if (formOpen) titleInput.focus();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const payloadTitle = String(new FormData(form).get("title") || "").trim();
  if (!payloadTitle) return;

  if (editingItemId) {
    items = items.map((entry) => entry.id === editingItemId
      ? { ...entry, title: payloadTitle }
      : entry);
  } else {
    items.push({
      id: safeId(),
      title: payloadTitle,
      rank: getMaxOpenRank() + 1024,
      completed: false,
      deleted: false,
      deletedAt: null,
    });
  }

  persist();
  render();
  resetFormMode();
  setFormOpen(false);
});

cancelEditBtn.addEventListener("click", () => {
  resetFormMode();
  setFormOpen(false);
});

if (importJsonBtn && jsonFileInputEl) {
  importJsonBtn.addEventListener("click", () => {
    void importItemsJson();
  });

  jsonFileInputEl.addEventListener("change", () => {
    const file = jsonFileInputEl.files && jsonFileInputEl.files[0];
    void loadFromImportedFile(file);
  });
}

if (exportJsonBtn) {
  exportJsonBtn.addEventListener("click", () => {
    void exportItemsJson();
  });
}

setStorageSource("Base: local");
setSyncStatus("Lista salva localmente. Use Importar/Exportar JSON para backup.");
setFormOpen(false);
resetFormMode();
render();
