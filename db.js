(function () {
  const DB_STORAGE_KEY = "shopping_price_db_v3";
  const LEGACY_KEYS = ["shopping_price_db_v2", "shopping_open_list_v1", "compras_v1", "tasks_v1"];

  let db = loadDatabase();

  function nowIso() {
    return new Date().toISOString();
  }

  function safeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeKey(value) {
    return normalizeText(value).toLocaleLowerCase("pt-BR");
  }

  function parsePrice(value) {
    const rawText = normalizeText(value);
    if (!rawText) return null;

    // Accept common user formats such as "0", "0,00" and "R$ 0,00".
    let text = rawText
      .replace(/\s+/g, "")
      .replace(/r\$/gi, "")
      .replace(/[^0-9,.\-]/g, "");

    if (!text) return null;

    const hasComma = text.includes(",");
    const hasDot = text.includes(".");
    if (hasComma && hasDot) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else if (hasComma) {
      text = text.replace(",", ".");
    }

    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed < 0) return null;

    return Number(parsed.toFixed(2));
  }

  function parseQuantity(value) {
    const text = normalizeText(value).replace(",", ".");
    if (!text) return null;

    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    return Number(parsed.toFixed(3));
  }

  function formatPrice(value) {
    if (!Number.isFinite(Number(value))) return "Sem preco";
    return Number(value).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function createEmptyDb() {
    return {
      products: [],
      priceBook: [],
      listItems: [],
      openOrderMode: "name",
    };
  }

  function extractLegacyArray(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (!parsed || typeof parsed !== "object") return null;

    const candidates = ["listItems", "items", "tasks", "compras", "atividades", "data"];
    for (const key of candidates) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }

    return null;
  }

  function normalizeDatabase(raw) {
    const next = createEmptyDb();
    const aliasProductMap = new Map();
    next.openOrderMode = normalizeText(
      raw && (raw.openOrderMode || (raw.settings && raw.settings.openOrderMode)),
    ) === "manual"
      ? "manual"
      : "name";

    function ensureProduct(name, aliasId = null) {
      const cleanName = normalizeText(name);
      if (!cleanName) return null;

      const key = normalizeKey(cleanName);
      const existing = next.products.find((product) => normalizeKey(product.name) === key);
      if (existing) {
        if (aliasId) aliasProductMap.set(String(aliasId), existing.id);
        return existing.id;
      }

      const product = {
        id: safeId(),
        name: cleanName,
        createdAt: nowIso(),
      };

      next.products.push(product);
      if (aliasId) aliasProductMap.set(String(aliasId), product.id);
      return product.id;
    }

    function resolveProductId(entry) {
      const rawProductId = normalizeText(entry && entry.productId);
      if (rawProductId) {
        if (aliasProductMap.has(rawProductId)) return aliasProductMap.get(rawProductId);
        const direct = next.products.find((product) => product.id === rawProductId);
        if (direct) return direct.id;
      }

      return ensureProduct(entry && (entry.productName || entry.product || entry.title));
    }

    function upsertPriceInCollection(collection, payload) {
      const productId = payload.productId;
      const brand = normalizeText(payload.brand);
      const market = normalizeText(payload.market);
      const price = parsePrice(payload.price);
      const updatedAt = payload.updatedAt ? String(payload.updatedAt) : nowIso();

      if (!productId || !brand || !market || price === null) return;

      const brandKey = normalizeKey(brand);
      const marketKey = normalizeKey(market);

      const existing = collection.find((entry) => (
        entry.productId === productId
        && normalizeKey(entry.brand) === brandKey
        && normalizeKey(entry.market) === marketKey
      ));

      if (existing) {
        existing.brand = brand;
        existing.market = market;
        existing.price = price;
        existing.updatedAt = updatedAt;
        return;
      }

      collection.push({
        id: safeId(),
        productId,
        brand,
        market,
        price,
        updatedAt,
      });
    }

    const sourceProducts = Array.isArray(raw && raw.products) ? raw.products : [];
    for (const sourceProduct of sourceProducts) {
      const productName = normalizeText(sourceProduct && (sourceProduct.name || sourceProduct.title || sourceProduct.product));
      if (!productName) continue;

      const productId = ensureProduct(productName, sourceProduct && sourceProduct.id ? String(sourceProduct.id) : null);
      const product = next.products.find((entry) => entry.id === productId);
      if (!product) continue;

      if (sourceProduct && sourceProduct.createdAt) {
        product.createdAt = String(sourceProduct.createdAt);
      }
    }

    const hasExplicitPriceBookSource = (
      Array.isArray(raw && raw.priceBook)
      || Array.isArray(raw && raw.priceEntries)
      || Array.isArray(raw && raw.prices)
    );

    const sourcePriceBook = Array.isArray(raw && (raw.priceBook || raw.priceEntries || raw.prices))
      ? (raw.priceBook || raw.priceEntries || raw.prices)
      : [];

    for (const sourceEntry of sourcePriceBook) {
      const productId = resolveProductId(sourceEntry);
      if (!productId) continue;

      upsertPriceInCollection(next.priceBook, {
        productId,
        brand: sourceEntry && sourceEntry.brand,
        market: sourceEntry && sourceEntry.market,
        price: sourceEntry && sourceEntry.price,
        updatedAt: sourceEntry && sourceEntry.updatedAt,
      });
    }

    const sourceListItems = Array.isArray(raw && raw.listItems)
      ? raw.listItems
      : (extractLegacyArray(raw) || []);

    for (let i = 0; i < sourceListItems.length; i += 1) {
      const sourceItem = sourceListItems[i];
      const productId = resolveProductId(sourceItem);
      if (!productId) continue;

      const brand = normalizeText(sourceItem && sourceItem.brand);
      const market = normalizeText(sourceItem && sourceItem.market);
      const price = parsePrice(sourceItem && sourceItem.price);
      const quantity = parseQuantity(sourceItem && sourceItem.quantity) || 1;
      const deleted = Boolean(sourceItem && sourceItem.deleted);
      const completed = deleted ? false : Boolean(sourceItem && sourceItem.completed);
      const rawPendingSyncFields = (sourceItem && typeof sourceItem.pendingSyncFields === "object")
        ? sourceItem.pendingSyncFields
        : null;
      const pendingSyncFields = {
        brand: Boolean(rawPendingSyncFields && rawPendingSyncFields.brand),
        market: Boolean(rawPendingSyncFields && rawPendingSyncFields.market),
        price: Boolean(rawPendingSyncFields && rawPendingSyncFields.price),
      };
      const rawPendingOriginalValues = (sourceItem && typeof sourceItem.pendingOriginalValues === "object")
        ? sourceItem.pendingOriginalValues
        : null;
      const pendingOriginalValues = {};
      if (pendingSyncFields.brand && rawPendingOriginalValues && Object.prototype.hasOwnProperty.call(rawPendingOriginalValues, "brand")) {
        pendingOriginalValues.brand = normalizeText(rawPendingOriginalValues.brand);
      }
      if (pendingSyncFields.market && rawPendingOriginalValues && Object.prototype.hasOwnProperty.call(rawPendingOriginalValues, "market")) {
        pendingOriginalValues.market = normalizeText(rawPendingOriginalValues.market);
      }
      if (pendingSyncFields.price && rawPendingOriginalValues && Object.prototype.hasOwnProperty.call(rawPendingOriginalValues, "price")) {
        pendingOriginalValues.price = parsePrice(rawPendingOriginalValues.price);
      }
      const needsPriceSync = pendingSyncFields.brand
        || pendingSyncFields.market
        || pendingSyncFields.price;

      const listItem = {
        id: sourceItem && sourceItem.id ? String(sourceItem.id) : safeId(),
        productId,
        brand,
        market,
        price,
        quantity,
        completed,
        deleted,
        deletedAt: deleted ? String((sourceItem && sourceItem.deletedAt) || nowIso()) : null,
        needsPriceSync,
        pendingSyncFields,
        pendingOriginalValues,
        rank: Number.isFinite(Number(sourceItem && sourceItem.rank))
          ? Number(sourceItem.rank)
          : (i + 1) * 1024,
        createdAt: sourceItem && sourceItem.createdAt ? String(sourceItem.createdAt) : nowIso(),
        updatedAt: sourceItem && sourceItem.updatedAt ? String(sourceItem.updatedAt) : nowIso(),
      };

      next.listItems.push(listItem);

      if (!hasExplicitPriceBookSource && brand && market && price !== null && !listItem.needsPriceSync) {
        const hasReference = next.priceBook.some((entry) => (
          entry.productId === productId
          && normalizeKey(entry.brand) === normalizeKey(brand)
          && normalizeKey(entry.market) === normalizeKey(market)
        ));

        // Preserve explicit price-book values on reload.
        // Only backfill references from list items when entry is missing.
        if (!hasReference) {
          upsertPriceInCollection(next.priceBook, {
            productId,
            brand,
            market,
            price,
            updatedAt: listItem.updatedAt,
          });
        }
      }
    }

    rebalanceOpenRanks(next);
    return next;
  }

  function tryParseToDatabase(parsed) {
    if (Array.isArray(parsed)) {
      return normalizeDatabase({ listItems: parsed });
    }

    if (parsed && typeof parsed === "object") {
      if (
        Array.isArray(parsed.products)
        || Array.isArray(parsed.priceBook)
        || Array.isArray(parsed.priceEntries)
        || Array.isArray(parsed.listItems)
      ) {
        return normalizeDatabase(parsed);
      }

      const legacyArray = extractLegacyArray(parsed);
      if (legacyArray) {
        return normalizeDatabase({ listItems: legacyArray });
      }
    }

    return null;
  }

  function loadDatabase() {
    try {
      const raw = localStorage.getItem(DB_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized = tryParseToDatabase(parsed);
        if (normalized) return normalized;
      }
    } catch {
      // Fallthrough to legacy migration.
    }

    for (const key of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const parsed = JSON.parse(raw);
        const normalized = tryParseToDatabase(parsed);
        if (!normalized) continue;

        localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
      } catch {
        // Ignore and continue.
      }
    }

    return createEmptyDb();
  }

  function persistDb() {
    localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(db));
  }

  function getDb() {
    return db;
  }

  function setDb(nextDb) {
    db = normalizeDatabase(nextDb);
    persistDb();
  }

  function getProductById(productId) {
    return db.products.find((product) => product.id === productId) || null;
  }

  function getProductName(productId) {
    const product = getProductById(productId);
    return product ? product.name : "Produto sem nome";
  }

  function ensureProductInDb(name) {
    const cleanName = normalizeText(name);
    if (!cleanName) return null;

    const key = normalizeKey(cleanName);
    const existing = db.products.find((product) => normalizeKey(product.name) === key);
    if (existing) return existing.id;

    const product = {
      id: safeId(),
      name: cleanName,
      createdAt: nowIso(),
    };

    db.products.push(product);
    persistDb();
    return product.id;
  }

  function upsertPriceInDb(productId, brand, market, price, updatedAt = nowIso()) {
    const cleanBrand = normalizeText(brand);
    const cleanMarket = normalizeText(market);
    const cleanPrice = parsePrice(price);

    if (!productId || !cleanBrand || !cleanMarket || cleanPrice === null) return false;

    const brandKey = normalizeKey(cleanBrand);
    const marketKey = normalizeKey(cleanMarket);

    const existing = db.priceBook.find((entry) => (
      entry.productId === productId
      && normalizeKey(entry.brand) === brandKey
      && normalizeKey(entry.market) === marketKey
    ));

    if (existing) {
      existing.brand = cleanBrand;
      existing.market = cleanMarket;
      existing.price = cleanPrice;
      existing.updatedAt = String(updatedAt || nowIso());
      persistDb();
      return true;
    }

    db.priceBook.push({
      id: safeId(),
      productId,
      brand: cleanBrand,
      market: cleanMarket,
      price: cleanPrice,
      updatedAt: String(updatedAt || nowIso()),
    });

    persistDb();
    return true;
  }

  function getPriceEntriesForProduct(productId) {
    return db.priceBook
      .filter((entry) => entry.productId === productId)
      .sort((a, b) => {
        const priceDiff = Number(a.price) - Number(b.price);
        if (priceDiff !== 0) return priceDiff;
        return String(b.updatedAt).localeCompare(String(a.updatedAt));
      });
  }

  function getTopTwoEntries(productId) {
    return getPriceEntriesForProduct(productId).slice(0, 2);
  }

  function getOpenItems(sourceDb = db) {
    const items = [...sourceDb.listItems]
      .filter((item) => !item.deleted && !item.completed);

    const openOrderMode = normalizeText(sourceDb && sourceDb.openOrderMode) === "manual"
      ? "manual"
      : "name";

    if (openOrderMode === "name") {
      const productNameById = new Map(
        (Array.isArray(sourceDb.products) ? sourceDb.products : [])
          .map((product) => [product.id, normalizeText(product.name)]),
      );

      return items.sort((a, b) => {
        const nameA = productNameById.get(a.productId) || "";
        const nameB = productNameById.get(b.productId) || "";
        const nameDiff = nameA.localeCompare(nameB, "pt-BR");
        if (nameDiff !== 0) return nameDiff;

        const brandDiff = normalizeText(a.brand).localeCompare(normalizeText(b.brand), "pt-BR");
        if (brandDiff !== 0) return brandDiff;

        const marketDiff = normalizeText(a.market).localeCompare(normalizeText(b.market), "pt-BR");
        if (marketDiff !== 0) return marketDiff;

        const rankDiff = Number(a.rank) - Number(b.rank);
        if (rankDiff !== 0) return rankDiff;

        return String(a.id).localeCompare(String(b.id), "pt-BR");
      });
    }

    return items.sort((a, b) => Number(a.rank) - Number(b.rank));
  }

  function getDoneItems() {
    return [...db.listItems]
      .filter((item) => !item.deleted && item.completed)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function getDeletedItems() {
    return [...db.listItems]
      .filter((item) => item.deleted)
      .sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")));
  }

  function rebalanceOpenRanks(targetDb = db) {
    const openItems = getOpenItems(targetDb);
    const rankMap = new Map();

    for (let i = 0; i < openItems.length; i += 1) {
      rankMap.set(openItems[i].id, (i + 1) * 1024);
    }

    targetDb.listItems = targetDb.listItems.map((item) => {
      if (!rankMap.has(item.id)) return item;
      return { ...item, rank: rankMap.get(item.id) };
    });
  }

  function getMaxOpenRank() {
    return getOpenItems().reduce((acc, item) => Math.max(acc, Number(item.rank) || 0), 0);
  }

  function parseImportedDatabase(text) {
    const cleanText = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!cleanText) return createEmptyDb();

    const parsed = JSON.parse(cleanText);
    const normalized = tryParseToDatabase(parsed);

    if (!normalized) {
      throw new Error("JSON invalido. Envie o banco do app ou uma lista de itens.");
    }

    return normalized;
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

  function buildExportFileName() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    return `Backup_Compras_${yyyy}.${mm}.${dd}_${hh}.${mi}h.json`;
  }

  window.ShoppingDb = {
    DB_STORAGE_KEY,
    nowIso,
    safeId,
    normalizeText,
    normalizeKey,
    parsePrice,
    parseQuantity,
    formatPrice,
    createEmptyDb,
    extractLegacyArray,
    normalizeDatabase,
    loadDatabase,
    persistDb,
    getDb,
    setDb,
    getProductById,
    getProductName,
    ensureProductInDb,
    upsertPriceInDb,
    getPriceEntriesForProduct,
    getTopTwoEntries,
    getOpenItems,
    getDoneItems,
    getDeletedItems,
    rebalanceOpenRanks,
    getMaxOpenRank,
    parseImportedDatabase,
    readFileAsText,
    buildExportFileName,
  };
})();
