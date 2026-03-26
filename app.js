(() => {
  const dbApi = window.ShoppingDb;
  if (!dbApi) {
    console.error("ShoppingDb nao carregado.");
    return;
  }

  const page = document.body.dataset.page || "home";

  const syncStatusEl = document.getElementById("sync-status");
  const importJsonBtn = document.getElementById("import-json-btn");
  const exportJsonBtn = document.getElementById("export-json-btn");
  const jsonFileInputEl = document.getElementById("json-file-input");

  const home = {
    listForm: document.getElementById("list-form"),
    listProduct: document.getElementById("list-product"),
    listNewProduct: document.getElementById("list-new-product"),
    listBrand: document.getElementById("list-brand"),
    listMarket: document.getElementById("list-market"),
    listNewMarket: document.getElementById("list-new-market"),
    listPrice: document.getElementById("list-price"),
    listQuantity: document.getElementById("list-quantity"),
    cheapestHint: document.getElementById("cheapest-hint"),
    openList: document.getElementById("task-list-open"),
    openSummary: document.getElementById("open-summary"),
    doneList: document.getElementById("task-list-done"),
    doneSummary: document.getElementById("done-summary"),
    analyzeListBtn: document.getElementById("analyze-list-btn"),
    applyMarketBtn: document.getElementById("apply-market-btn"),
    quickAddToggleBtn: document.getElementById("quick-add-toggle-btn"),
    marketAnalysis: document.getElementById("market-analysis"),
    catalogList: document.getElementById("task-list-catalog"),
    stats: document.getElementById("stats"),
    itemTemplate: document.getElementById("list-item-template"),
    catalogItemTemplate: document.getElementById("catalog-item-template"),
  };

  const catalog = {
    referenceForm: document.getElementById("reference-form"),
    referenceProduct: document.getElementById("reference-product"),
    referenceNewProduct: document.getElementById("reference-new-product"),
    referenceBrand: document.getElementById("reference-brand"),
    referenceMarket: document.getElementById("reference-market"),
    referencePrice: document.getElementById("reference-price"),
    productsList: document.getElementById("products-list"),
  };

  const history = {
    filterProduct: document.getElementById("history-product-filter"),
    historyList: document.getElementById("history-list"),
  };

  const openDragState = {
    active: false,
    pointerId: null,
    draggedEl: null,
    handleEl: null,
    startedOrder: "",
  };

  const NEW_PRODUCT_OPTION_VALUE = "__new_product__";
  const NEW_MARKET_OPTION_VALUE = "__new_market__";
  const PRICE_SYNC_FIELDS = ["brand", "market", "price"];
  let marketAnalysisVisible = false;
  let bulkMarketApplied = false;
  let selectedBulkMarket = "";
  let quickAddVisible = false;
  let quickAddDraft = null;
  const catalogPendingEdits = new Map();

  function setSyncStatus(text) {
    if (!syncStatusEl) return;
    syncStatusEl.textContent = text;
  }

  function renderProductOptions(selectEl, opts = {}) {
    if (!selectEl) return;

    const {
      includeAll = false,
      includeNewOption = false,
      newOptionLabel = "+ Novo item",
      allLabel = "Todos",
      placeholder = "Selecione um produto",
      preserveValue = true,
    } = opts;

    const previousValue = preserveValue ? selectEl.value : "";
    selectEl.innerHTML = "";

    const first = document.createElement("option");
    first.value = "";
    first.textContent = includeAll ? allLabel : placeholder;
    selectEl.appendChild(first);

    if (includeNewOption && !includeAll) {
      const newOption = document.createElement("option");
      newOption.value = NEW_PRODUCT_OPTION_VALUE;
      newOption.textContent = newOptionLabel;
      selectEl.appendChild(newOption);
    }

    const products = [...dbApi.getDb().products].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const product of products) {
      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = product.name;
      selectEl.appendChild(option);
    }

    if (previousValue && products.some((product) => product.id === previousValue)) {
      selectEl.value = previousValue;
    }
  }

  function renderTopPriceLine(targetEl, productId, position) {
    if (!targetEl) return;

    const topTwo = dbApi.getTopTwoEntries(productId);
    const entry = topTwo[position - 1] || null;
    targetEl.innerHTML = "";

    const rankBadge = document.createElement("span");
    rankBadge.className = `top-rank-badge top-rank-${position}`;
    rankBadge.textContent = String(position);

    const text = document.createElement("span");
    text.className = "top-rank-text";
    text.textContent = entry
      ? `${entry.market} (${entry.brand}) - ${dbApi.formatPrice(entry.price)}`
      : "Sem referencia de preco";

    targetEl.append(rankBadge, text);
  }

  function getEntriesForProductBrand(productId, brand) {
    const brandKey = dbApi.normalizeKey(brand);
    if (!brandKey) return [];

    return dbApi.getPriceEntriesForProduct(productId)
      .filter((entry) => dbApi.normalizeKey(entry.brand) === brandKey);
  }

  function getBestEntriesByMarketForItem(item) {
    if (!item || !item.productId) return [];

    const hasBrand = Boolean(dbApi.normalizeText(item.brand));
    const sourceEntries = hasBrand
      ? getEntriesForProductBrand(item.productId, item.brand)
      : dbApi.getPriceEntriesForProduct(item.productId);

    const bestByMarket = new Map();
    for (const entry of sourceEntries) {
      const marketKey = dbApi.normalizeKey(entry.market);
      const price = Number(entry.price);
      if (!marketKey || !Number.isFinite(price)) continue;

      const current = bestByMarket.get(marketKey);
      if (!current || price < current.price) {
        bestByMarket.set(marketKey, {
          market: entry.market,
          price: Number(price.toFixed(2)),
        });
      }
    }

    return [...bestByMarket.values()];
  }

  function calculateMarketAnalysis(openItems) {
    const totalItems = openItems.length;
    const totalsByMarket = new Map();

    for (const item of openItems) {
      const quantity = getItemQuantity(item);
      const marketEntries = getBestEntriesByMarketForItem(item);

      for (const marketEntry of marketEntries) {
        const marketKey = dbApi.normalizeKey(marketEntry.market);
        const current = totalsByMarket.get(marketKey) || {
          market: marketEntry.market,
          total: 0,
          coveredItems: 0,
        };

        current.total += Number((marketEntry.price * quantity).toFixed(2));
        current.coveredItems += 1;
        totalsByMarket.set(marketKey, current);
      }
    }

    const rows = [...totalsByMarket.values()].map((row) => {
      const total = Number(row.total.toFixed(2));
      const missingItems = Math.max(totalItems - row.coveredItems, 0);
      return {
        market: row.market,
        total,
        coveredItems: row.coveredItems,
        missingItems,
      };
    });

    rows.sort((a, b) => {
      if (a.missingItems !== b.missingItems) return a.missingItems - b.missingItems;
      return a.total - b.total;
    });

    return {
      totalItems,
      rows,
    };
  }

  function getItemQuantity(item) {
    const parsed = dbApi.parseQuantity(item && item.quantity);
    return parsed || 1;
  }

  function formatQuantity(value) {
    const parsed = dbApi.parseQuantity(value);
    if (!parsed) return "1";

    if (Number.isInteger(parsed)) {
      return String(parsed);
    }

    return parsed.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }

  function formatReferenceDateTime(value) {
    const raw = dbApi.normalizeText(value);
    if (!raw) return "Sem data/hora";

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "Sem data/hora";

    return parsed.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getCheapestReferenceForItem(item) {
    if (!item || !item.productId) return null;

    const hasBrand = Boolean(dbApi.normalizeText(item.brand));
    const source = hasBrand
      ? getEntriesForProductBrand(item.productId, item.brand)
      : dbApi.getPriceEntriesForProduct(item.productId);

    return source[0] || null;
  }

  function getItemSpendAndLoss(item) {
    const quantity = getItemQuantity(item);
    const paidUnit = Number(item && item.price);
    const hasPaid = Number.isFinite(paidUnit);
    const cheapest = getCheapestReferenceForItem(item);

    if (!hasPaid || !cheapest || !Number.isFinite(Number(cheapest.price))) {
      return {
        quantity,
        paidUnit: hasPaid ? Number(paidUnit.toFixed(2)) : null,
        totalPaid: hasPaid ? Number((paidUnit * quantity).toFixed(2)) : null,
        cheapest,
        lossUnit: 0,
        lossTotal: 0,
        comparable: false,
      };
    }

    const rawLossUnit = Number((paidUnit - Number(cheapest.price)).toFixed(2));
    const lossUnit = rawLossUnit > 0 ? rawLossUnit : 0;
    return {
      quantity,
      paidUnit: Number(paidUnit.toFixed(2)),
      totalPaid: Number((paidUnit * quantity).toFixed(2)),
      cheapest,
      lossUnit,
      lossTotal: Number((lossUnit * quantity).toFixed(2)),
      comparable: true,
    };
  }

  function getRankBadgeClass(rank) {
    if (rank === 1) return "top-rank-1";
    if (rank === 2) return "top-rank-2";
    if (rank === 3) return "top-rank-3";
    return "top-rank-other";
  }

  function setRankBadge(badgeEl, rank) {
    if (!badgeEl) return;
    badgeEl.classList.remove("top-rank-1", "top-rank-2", "top-rank-3", "top-rank-other");

    if (Number.isInteger(rank) && rank > 0) {
      badgeEl.classList.add(getRankBadgeClass(rank));
      badgeEl.textContent = String(rank);
      return;
    }

    badgeEl.classList.add("top-rank-other");
    badgeEl.textContent = "-";
  }

  function renderRankReferenceLine(targetEl, entry, fallbackText = "") {
    if (!targetEl) return;
    targetEl.innerHTML = "";

    if (!entry) {
      if (fallbackText) {
        const text = document.createElement("span");
        text.className = "top-rank-text";
        text.textContent = fallbackText;
        targetEl.appendChild(text);
        targetEl.classList.remove("is-hidden");
      } else {
        targetEl.classList.add("is-hidden");
      }
      return;
    }

    const rankBadge = document.createElement("span");
    rankBadge.className = `top-rank-badge ${getRankBadgeClass(entry.rank)}`;
    rankBadge.textContent = String(entry.rank);

    const text = document.createElement("span");
    text.className = "top-rank-text";
    text.textContent = `${entry.market} - ${dbApi.formatPrice(entry.price)}`;

    targetEl.append(rankBadge, text);
    targetEl.classList.remove("is-hidden");
  }

  function renderItemRankingLines(item, mainBadgeEl, firstLineEl, secondLineEl) {
    const hasBrand = Boolean(dbApi.normalizeText(item && item.brand));
    if (!hasBrand) {
      setRankBadge(mainBadgeEl, null);
      renderRankReferenceLine(firstLineEl, null, "Defina a marca para comparar.");
      renderRankReferenceLine(secondLineEl, null);
      return;
    }

    const rankedEntries = getEntriesForProductBrand(item.productId, item.brand)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    if (rankedEntries.length === 0) {
      setRankBadge(mainBadgeEl, null);
      renderRankReferenceLine(firstLineEl, null, "Sem referencias para esta marca.");
      renderRankReferenceLine(secondLineEl, null);
      return;
    }

    const marketKey = dbApi.normalizeKey(item.market);
    let currentEntry = marketKey
      ? (rankedEntries.find((entry) => dbApi.normalizeKey(entry.market) === marketKey) || null)
      : null;

    if (!currentEntry) {
      const currentPrice = dbApi.parsePrice(item.price);
      if (currentPrice !== null) {
        currentEntry = rankedEntries.find((entry) => Number(entry.price) === Number(currentPrice)) || null;
      }
    }

    const currentRank = currentEntry ? currentEntry.rank : null;
    setRankBadge(mainBadgeEl, currentRank);

    const otherEntries = currentEntry
      ? rankedEntries.filter((entry) => entry.rank !== currentEntry.rank)
      : rankedEntries;

    renderRankReferenceLine(
      firstLineEl,
      otherEntries[0] || null,
      otherEntries.length === 0 ? "Sem outras referencias para esta marca." : "",
    );
    renderRankReferenceLine(secondLineEl, otherEntries[1] || null);
  }

  function renderDoneSummary(doneItems) {
    if (!home.doneSummary) return;

    let totalSpent = 0;
    let totalLoss = 0;
    let withoutPriceCount = 0;

    for (const item of doneItems) {
      const info = getItemSpendAndLoss(item);
      if (info.totalPaid === null) {
        withoutPriceCount += 1;
      } else {
        totalSpent += info.totalPaid;
      }
      totalLoss += info.lossTotal;
    }

    totalSpent = Number(totalSpent.toFixed(2));
    totalLoss = Number(totalLoss.toFixed(2));

    let summaryText = `Total comprado: ${dbApi.formatPrice(totalSpent)} | Perda por comprar mais caro: ${dbApi.formatPrice(totalLoss)}`;
    if (withoutPriceCount > 0) {
      summaryText += ` | ${withoutPriceCount} item(ns) sem preco`;
    }

    home.doneSummary.textContent = summaryText;
    home.doneSummary.classList.toggle("loss-high", totalLoss > 0);
  }

  function renderOpenSummary(openItems) {
    if (!home.openSummary) return;

    let totalOpen = 0;
    let withoutPriceCount = 0;

    for (const item of openItems) {
      const info = getItemSpendAndLoss(item);
      if (info.totalPaid === null) {
        withoutPriceCount += 1;
      } else {
        totalOpen += info.totalPaid;
      }
    }

    totalOpen = Number(totalOpen.toFixed(2));

    let text = `Previsao em aberto: ${dbApi.formatPrice(totalOpen)}`;
    if (withoutPriceCount > 0) {
      text += ` | ${withoutPriceCount} item(ns) sem preco`;
    }

    home.openSummary.textContent = text;
  }

  function getMarketRankForItem(item, marketName) {
    if (!item || !item.productId) return null;

    const targetMarketKey = dbApi.normalizeKey(marketName);
    if (!targetMarketKey) return null;

    const hasBrand = Boolean(dbApi.normalizeText(item.brand));
    if (!hasBrand) return null;

    const rankedEntries = getEntriesForProductBrand(item.productId, item.brand)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    if (rankedEntries.length === 0) return null;

    const currentEntry = rankedEntries.find(
      (entry) => dbApi.normalizeKey(entry.market) === targetMarketKey,
    ) || null;

    return currentEntry ? currentEntry.rank : null;
  }

  function splitOpenItemsBySelectedMarket(openItems, marketName) {
    const bestAtSelectedMarket = [];
    const cheaperElsewhere = [];

    for (const item of openItems) {
      const rankInSelectedMarket = getMarketRankForItem(item, marketName);
      if (rankInSelectedMarket === 1) {
        bestAtSelectedMarket.push(item);
      } else {
        cheaperElsewhere.push(item);
      }
    }

    return {
      bestAtSelectedMarket,
      cheaperElsewhere,
    };
  }

  function appendOpenGroupTitle(text) {
    if (!home.openList) return;
    const title = document.createElement("li");
    title.className = "open-group-title";
    title.textContent = text;
    home.openList.appendChild(title);
  }

  function appendOpenGroupEmpty(text) {
    if (!home.openList) return;
    const empty = document.createElement("li");
    empty.className = "open-group-empty";
    empty.textContent = text;
    home.openList.appendChild(empty);
  }

  function renderMarketAnalysis(openItems) {
    if (!home.marketAnalysis || !home.analyzeListBtn) return;

    home.analyzeListBtn.textContent = marketAnalysisVisible ? "Ocultar analise" : "Analisar lista";
    home.marketAnalysis.classList.toggle("is-hidden", !marketAnalysisVisible);
    if (!marketAnalysisVisible) return;

    home.marketAnalysis.innerHTML = "";

    const title = document.createElement("p");
    title.className = "market-analysis-title";
    title.textContent = "Comparativo total da lista em aberto por mercado";
    home.marketAnalysis.appendChild(title);

    if (openItems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "market-analysis-empty";
      empty.textContent = "Sem itens em aberto para analisar.";
      home.marketAnalysis.appendChild(empty);
      return;
    }

    const result = calculateMarketAnalysis(openItems);
    if (result.rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "market-analysis-empty";
      empty.textContent = "Sem referencias de preco para os itens atuais.";
      home.marketAnalysis.appendChild(empty);
      return;
    }

    const bestComplete = result.rows.find((row) => row.missingItems === 0) || null;
    const activeMarketKey = bulkMarketApplied ? dbApi.normalizeKey(selectedBulkMarket) : "";
    const list = document.createElement("ul");
    list.className = "market-analysis-list";

    for (const row of result.rows) {
      const itemEl = document.createElement("li");
      itemEl.className = "market-analysis-item";
      if (row.missingItems > 0) itemEl.classList.add("is-partial");

      const header = document.createElement("div");
      header.className = "market-analysis-head";

      const marketLine = document.createElement("strong");
      marketLine.className = "market-analysis-market";
      marketLine.textContent = `${row.market}: ${dbApi.formatPrice(row.total)}`;
      header.appendChild(marketLine);

      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "sync-btn market-analysis-use-btn";
      useBtn.textContent = "Usar mercado";
      useBtn.title = `Aplicar ${row.market} em todos os itens em aberto`;
      useBtn.addEventListener("click", () => {
        applyMarketToOpenItems(row.market);
      });
      header.appendChild(useBtn);
      itemEl.appendChild(header);

      const details = document.createElement("span");
      details.className = "market-analysis-details";
      if (row.missingItems > 0) {
        details.textContent = `Cobre ${row.coveredItems}/${result.totalItems} itens (faltam ${row.missingItems})`;
      } else {
        details.textContent = `Cobre ${result.totalItems}/${result.totalItems} itens`;
      }
      itemEl.appendChild(details);

      const tags = [];
      if (bestComplete && dbApi.normalizeKey(bestComplete.market) === dbApi.normalizeKey(row.market)) {
        tags.push({ text: "melhor total", active: false });
      }
      if (activeMarketKey && activeMarketKey === dbApi.normalizeKey(row.market)) {
        tags.push({ text: "em uso", active: true });
      }

      if (tags.length > 0) {
        const tagsRow = document.createElement("div");
        tagsRow.className = "market-analysis-tags";
        for (const tagInfo of tags) {
          const tag = document.createElement("span");
          tag.className = `market-analysis-tag${tagInfo.active ? " market-analysis-tag-active" : ""}`;
          tag.textContent = tagInfo.text;
          tagsRow.appendChild(tag);
        }
        itemEl.appendChild(tagsRow);
      }

      list.appendChild(itemEl);
    }

    home.marketAnalysis.appendChild(list);
  }

  async function loadFromImportedFile(file) {
    if (!file) return false;

    try {
      const text = await dbApi.readFileAsText(file);
      const parsed = dbApi.parseImportedDatabase(text);
      dbApi.setDb(parsed);
      renderCurrentPage();
      setSyncStatus(`JSON importado com sucesso (${file.name}).`);
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : "arquivo invalido.";
      setSyncStatus(`Erro ao importar JSON: ${message}`);
      return false;
    }
  }

  async function importDbJson() {
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const [handle] = await window.showOpenFilePicker({
          id: "compras-db-import",
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

  async function exportDbJson() {
    const db = dbApi.getDb();
    const jsonText = JSON.stringify(db, null, 2);

    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          id: "compras-db-export",
          suggestedName: dbApi.buildExportFileName(),
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
      link.download = dbApi.buildExportFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSyncStatus("JSON exportado por download.");
    } catch {
      setSyncStatus("Falha ao exportar JSON.");
    }
  }

  function wireCommonActions() {
    if (importJsonBtn) {
      importJsonBtn.addEventListener("click", () => {
        void importDbJson();
      });
    }

    if (exportJsonBtn) {
      exportJsonBtn.addEventListener("click", () => {
        void exportDbJson();
      });
    }

    if (jsonFileInputEl) {
      jsonFileInputEl.addEventListener("change", () => {
        const file = jsonFileInputEl.files && jsonFileInputEl.files[0];
        void loadFromImportedFile(file);
      });
    }
  }

  function fillHomeSuggestion(productId) {
    if (!home.cheapestHint) return;

    if (!productId) {
      home.cheapestHint.textContent = "Selecione um produto para sugestao de menor preco.";
      if (home.listQuantity && !dbApi.normalizeText(home.listQuantity.value)) home.listQuantity.value = "1";
      return;
    }

    if (productId === NEW_PRODUCT_OPTION_VALUE) {
      home.cheapestHint.textContent = "Digite o nome do novo item para adicionar na lista.";
      if (home.listQuantity && !dbApi.normalizeText(home.listQuantity.value)) home.listQuantity.value = "1";
      return;
    }

    const topTwo = dbApi.getTopTwoEntries(productId);
    if (topTwo.length === 0) {
      home.cheapestHint.textContent = "Sem referencia de preco para este produto.";
      if (home.listQuantity && !dbApi.normalizeText(home.listQuantity.value)) home.listQuantity.value = "1";
      return;
    }

    const best = topTwo[0];
    if (home.listQuantity && !dbApi.normalizeText(home.listQuantity.value)) home.listQuantity.value = "1";

    const second = topTwo[1]
      ? ` | 2o: ${topTwo[1].market} (${topTwo[1].brand}) - ${dbApi.formatPrice(topTwo[1].price)}`
      : "";

    home.cheapestHint.textContent = `Mais barato: ${best.market} (${best.brand}) - ${dbApi.formatPrice(best.price)}${second}`;
  }

  function syncHomeNewProductVisibility() {
    if (!home.listProduct || !home.listNewProduct) return false;

    const isNewProductMode = home.listProduct.value === NEW_PRODUCT_OPTION_VALUE;
    home.listProduct.classList.toggle("is-hidden", isNewProductMode);
    home.listProduct.required = !isNewProductMode;
    home.listNewProduct.classList.toggle("is-hidden", !isNewProductMode);
    home.listNewProduct.required = isNewProductMode;
    if (!isNewProductMode) {
      home.listNewProduct.value = "";
    }

    return isNewProductMode;
  }

  function syncHomeNewMarketVisibility() {
    if (!home.listMarket || !home.listNewMarket) return false;

    const isNewMarketMode = home.listMarket.value === NEW_MARKET_OPTION_VALUE;
    home.listMarket.classList.toggle("is-hidden", isNewMarketMode);
    home.listMarket.required = !isNewMarketMode;
    home.listNewMarket.classList.toggle("is-hidden", !isNewMarketMode);
    home.listNewMarket.required = isNewMarketMode;
    if (!isNewMarketMode) {
      home.listNewMarket.value = "";
    }

    return isNewMarketMode;
  }

  function syncCatalogNewProductVisibility() {
    if (!catalog.referenceProduct || !catalog.referenceNewProduct) return false;

    const isNewProductMode = catalog.referenceProduct.value === NEW_PRODUCT_OPTION_VALUE;
    catalog.referenceProduct.classList.toggle("is-hidden", isNewProductMode);
    catalog.referenceProduct.required = !isNewProductMode;
    catalog.referenceNewProduct.classList.toggle("is-hidden", !isNewProductMode);
    catalog.referenceNewProduct.required = isNewProductMode;
    if (!isNewProductMode) {
      catalog.referenceNewProduct.value = "";
    }

    return isNewProductMode;
  }

  function uniqueSortedOptions(values) {
    const map = new Map();
    for (const value of values) {
      const clean = dbApi.normalizeText(value);
      if (!clean) continue;
      const key = dbApi.normalizeKey(clean);
      if (!map.has(key)) map.set(key, clean);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  function findOptionByKey(options, value) {
    const wantedKey = dbApi.normalizeKey(value);
    if (!wantedKey) return "";
    for (const option of options) {
      if (dbApi.normalizeKey(option) === wantedKey) return option;
    }
    return "";
  }

  function setSelectOptions(
    selectEl,
    options,
    placeholder,
    preferredValue = "",
    fallbackValue = "",
    extraOptions = [],
  ) {
    if (!selectEl) return "";

    selectEl.innerHTML = "";

    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    selectEl.appendChild(first);

    const normalizedExtraValues = [];
    for (const extraOption of extraOptions) {
      if (!extraOption) continue;
      const optionValue = dbApi.normalizeText(extraOption.value);
      if (!optionValue) continue;

      const optionLabel = dbApi.normalizeText(extraOption.label) || optionValue;
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      selectEl.appendChild(option);
      normalizedExtraValues.push(optionValue);
    }

    for (const optionValue of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue;
      selectEl.appendChild(option);
    }

    const allValues = [...options, ...normalizedExtraValues];
    const preferred = findOptionByKey(allValues, preferredValue);
    const fallback = findOptionByKey(allValues, fallbackValue);
    const resolvedValue = preferred || fallback || options[0] || "";
    selectEl.value = resolvedValue;
    return resolvedValue;
  }

  function findPriceEntry(entries, brand, market) {
    if (!entries.length) return null;

    const brandKey = dbApi.normalizeKey(brand);
    const marketKey = dbApi.normalizeKey(market);
    if (brandKey && marketKey) {
      const exact = entries.find(
        (entry) => dbApi.normalizeKey(entry.brand) === brandKey && dbApi.normalizeKey(entry.market) === marketKey,
      );
      if (exact) return exact;
    }

    if (brandKey) {
      const byBrand = entries.find((entry) => dbApi.normalizeKey(entry.brand) === brandKey);
      if (byBrand) return byBrand;
    }

    return entries[0] || null;
  }

  function setHomePriceSelect(entry, placeholder) {
    if (!home.listPrice) return;

    home.listPrice.disabled = false;
    home.listPrice.placeholder = placeholder;

    if (!entry || !Number.isFinite(Number(entry.price))) {
      home.listPrice.value = "";
      return;
    }

    home.listPrice.value = Number(entry.price).toFixed(2).replace(".", ",");
  }

  function syncHomeReferenceSelectors(options = {}) {
    if (!home.listProduct || !home.listBrand || !home.listMarket || !home.listPrice) return;

    const {
      resetBrand = false,
      resetMarket = false,
      preferredBrand = "",
      preferredMarket = "",
    } = options;
    const productId = home.listProduct.value;
    const isNewMode = productId === NEW_PRODUCT_OPTION_VALUE;
    const hasProduct = Boolean(productId && !isNewMode);
    const entries = hasProduct ? dbApi.getPriceEntriesForProduct(productId) : [];

    if (entries.length === 0) {
      const emptyLabel = hasProduct || isNewMode ? "Sem cadastro" : "Selecione um produto";
      setSelectOptions(home.listBrand, [], emptyLabel);
      setSelectOptions(home.listMarket, [], emptyLabel);
      setHomePriceSelect(null, hasProduct || isNewMode ? "Sem preco cadastrado" : "Selecione um produto");
      home.listBrand.disabled = true;
      home.listMarket.disabled = true;
      syncHomeNewMarketVisibility();
      return;
    }

    home.listBrand.disabled = false;
    home.listMarket.disabled = false;

    const bestEntry = entries[0];
    const brandOptions = uniqueSortedOptions(entries.map((entry) => entry.brand));
    const brandValue = setSelectOptions(
      home.listBrand,
      brandOptions,
      "Selecione a marca",
      preferredBrand || (resetBrand ? "" : home.listBrand.value),
      bestEntry.brand,
    );

    const entriesForBrand = getEntriesForProductBrand(productId, brandValue);
    const sourceForMarket = entriesForBrand.length ? entriesForBrand : entries;
    const marketOptions = uniqueSortedOptions(sourceForMarket.map((entry) => entry.market));
    const marketFallback = sourceForMarket[0] ? sourceForMarket[0].market : "";
    const marketValue = setSelectOptions(
      home.listMarket,
      marketOptions,
      "Selecione o mercado",
      preferredMarket || (resetMarket ? "" : home.listMarket.value),
      marketFallback,
      [{ value: NEW_MARKET_OPTION_VALUE, label: "+ Novo mercado" }],
    );

    const isNewMarketMode = marketValue === NEW_MARKET_OPTION_VALUE;
    if (isNewMarketMode) {
      setHomePriceSelect(null, "Digite o preco para o novo mercado");
      syncHomeNewMarketVisibility();
      return;
    }

    const selectedEntry = findPriceEntry(sourceForMarket, brandValue, marketValue);
    if (selectedEntry && dbApi.normalizeKey(home.listMarket.value) !== dbApi.normalizeKey(selectedEntry.market)) {
      home.listMarket.value = selectedEntry.market;
    }
    setHomePriceSelect(selectedEntry, "Sem preco cadastrado");
    syncHomeNewMarketVisibility();
  }

  function createQuickAddDraft() {
    return {
      productId: "",
      brand: "",
      market: "",
      price: null,
      quantity: 1,
    };
  }

  function ensureQuickAddDraft() {
    if (!quickAddDraft || typeof quickAddDraft !== "object") {
      quickAddDraft = createQuickAddDraft();
    }
    return quickAddDraft;
  }

  function resetQuickAddDraft() {
    quickAddDraft = createQuickAddDraft();
  }

  function getQuickAddProductName() {
    const draft = ensureQuickAddDraft();
    if (!draft.productId) return "Produto";
    return dbApi.getProductName(draft.productId);
  }

  function setQuickAddVisible(nextVisible) {
    if (!home.quickAddToggleBtn) return;

    quickAddVisible = Boolean(nextVisible);
    home.quickAddToggleBtn.textContent = quickAddVisible ? "-" : "+";
    home.quickAddToggleBtn.title = quickAddVisible ? "Fechar adicao rapida" : "Adicionar item rapido";

    if (quickAddVisible) {
      ensureQuickAddDraft();
    } else {
      resetQuickAddDraft();
    }
    renderCurrentPage();
  }

  async function editQuickAddDraftField(field) {
    const draft = ensureQuickAddDraft();

    if (field === "product") {
      const db = dbApi.getDb();
      const productNames = [...db.products]
        .map((product) => dbApi.normalizeText(product.name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR"));

      const selectedName = await pickOptionFromList("Produto do item", getQuickAddProductName(), productNames);
      if (selectedName === null) return;

      const normalizedSelected = dbApi.normalizeText(selectedName);
      if (!normalizedSelected) return;

      const existing = db.products.find(
        (product) => dbApi.normalizeKey(product.name) === dbApi.normalizeKey(normalizedSelected),
      ) || null;

      let productId = existing ? existing.id : null;
      if (!productId) {
        productId = dbApi.ensureProductInDb(normalizedSelected);
      }
      if (!productId) {
        setSyncStatus("Nao foi possivel cadastrar o novo item.");
        return;
      }

      draft.productId = productId;
      const topTwo = dbApi.getTopTwoEntries(productId);
      if (topTwo[0]) {
        draft.brand = topTwo[0].brand;
        draft.market = topTwo[0].market;
        draft.price = topTwo[0].price;
      } else {
        draft.brand = "";
        draft.market = "";
        draft.price = null;
      }
      renderCurrentPage();
      return;
    }

    if (!draft.productId) {
      setSyncStatus("Selecione o produto primeiro.");
      return;
    }

    if (field === "brand") {
      const entries = dbApi.getPriceEntriesForProduct(draft.productId);
      const options = uniqueSortedOptions(entries.map((entry) => entry.brand));
      const selectedBrand = await pickOptionFromList("Marca do item", draft.brand, options);
      if (selectedBrand === null) return;

      draft.brand = dbApi.normalizeText(selectedBrand);
      const byBrand = getEntriesForProductBrand(draft.productId, draft.brand);
      if (byBrand[0]) {
        draft.market = byBrand[0].market;
        draft.price = byBrand[0].price;
      }
      renderCurrentPage();
      return;
    }

    if (field === "market") {
      const entries = dbApi.getPriceEntriesForProduct(draft.productId);
      const brandKey = dbApi.normalizeKey(draft.brand);
      const sourceEntries = brandKey
        ? entries.filter((entry) => dbApi.normalizeKey(entry.brand) === brandKey)
        : entries;
      const options = uniqueSortedOptions(sourceEntries.map((entry) => entry.market));
      const selectedMarket = await pickOptionFromList("Mercado do item", draft.market, options);
      if (selectedMarket === null) return;

      draft.market = dbApi.normalizeText(selectedMarket);
      const exact = sourceEntries.find(
        (entry) => dbApi.normalizeKey(entry.market) === dbApi.normalizeKey(draft.market),
      ) || null;
      if (exact) {
        if (!draft.brand) draft.brand = exact.brand;
        draft.price = exact.price;
      } else {
        draft.price = 0;
      }
      renderCurrentPage();
      return;
    }

    if (field === "price") {
      const current = Number.isFinite(Number(draft.price))
        ? Number(draft.price).toFixed(2).replace(".", ",")
        : "";
      const nextRaw = window.prompt("Preco do item", current);
      if (nextRaw === null) return;

      const nextPrice = dbApi.parsePrice(nextRaw);
      if (nextPrice === null) {
        setSyncStatus("Preco invalido. Use numero como 10,50");
        return;
      }
      draft.price = nextPrice;
      renderCurrentPage();
      return;
    }

    if (field === "quantity") {
      const current = formatQuantity(draft.quantity || 1);
      const nextRaw = window.prompt("Quantidade do item", current);
      if (nextRaw === null) return;

      const nextQty = dbApi.parseQuantity(nextRaw);
      if (!nextQty) {
        setSyncStatus("Quantidade invalida. Use numero maior que zero.");
        return;
      }
      draft.quantity = nextQty;
      renderCurrentPage();
    }
  }

  function submitQuickAddDraft() {
    const draft = ensureQuickAddDraft();
    const result = addItemToOpenList({
      productId: draft.productId,
      brand: draft.brand,
      market: draft.market,
      price: draft.price,
      quantity: draft.quantity,
    });

    if (!result.ok) {
      setSyncStatus(result.message);
      return;
    }

    setSyncStatus(`Item ${result.productName} adicionado na lista.`);
    resetQuickAddDraft();
    renderCurrentPage();
  }

  function renderQuickAddDraftItem() {
    if (!home.itemTemplate) return null;
    const draft = ensureQuickAddDraft();
    const node = home.itemTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add("quick-add-draft-item");

    const toggleBtn = node.querySelector(".btn-toggle");
    const titleEl = node.querySelector(".task-product");
    const saveSyncBtn = node.querySelector(".btn-save-sync");
    const discardSyncBtn = node.querySelector(".btn-discard-sync");
    const deleteBtn = node.querySelector(".btn-delete");
    const dragBtn = node.querySelector(".btn-drag");
    const moveUpBtn = node.querySelector(".btn-move-up");
    const moveDownBtn = node.querySelector(".btn-move-down");
    const brandBtn = node.querySelector(".btn-brand");
    const marketBtn = node.querySelector(".btn-market");
    const priceBtn = node.querySelector(".btn-price");
    const qtyBtn = node.querySelector(".btn-qty");
    const mainRankBadge = node.querySelector(".top-rank-main");
    const top1 = node.querySelector(".top-price-1");
    const top2 = node.querySelector(".top-price-2");
    const doneLossLine = node.querySelector(".done-loss-line");

    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.classList.add("quick-add-toggle");
      toggleBtn.title = "Novo item";
    }

    if (titleEl) {
      const productBtn = document.createElement("button");
      productBtn.type = "button";
      productBtn.className = "btn-inline btn-draft-product";
      productBtn.textContent = getQuickAddProductName();
      productBtn.addEventListener("click", () => {
        void editQuickAddDraftField("product");
      });
      titleEl.replaceWith(productBtn);
    }

    if (brandBtn) {
      brandBtn.textContent = draft.brand || "Marca";
      brandBtn.addEventListener("click", () => {
        void editQuickAddDraftField("brand");
      });
    }
    if (marketBtn) {
      marketBtn.textContent = draft.market || "Mercado";
      marketBtn.addEventListener("click", () => {
        void editQuickAddDraftField("market");
      });
    }
    if (priceBtn) {
      priceBtn.textContent = Number.isFinite(Number(draft.price)) ? dbApi.formatPrice(draft.price) : "Preco";
      priceBtn.addEventListener("click", () => {
        void editQuickAddDraftField("price");
      });
    }
    if (qtyBtn) {
      qtyBtn.textContent = `Qtd ${formatQuantity(draft.quantity || 1)}`;
      qtyBtn.addEventListener("click", () => {
        void editQuickAddDraftField("quantity");
      });
    }

    if (saveSyncBtn) {
      saveSyncBtn.classList.remove("is-hidden");
      saveSyncBtn.textContent = "Adicionar";
      saveSyncBtn.addEventListener("click", submitQuickAddDraft);
    }

    if (discardSyncBtn) {
      discardSyncBtn.classList.remove("is-hidden");
      discardSyncBtn.textContent = "Cancelar";
      discardSyncBtn.addEventListener("click", () => {
        resetQuickAddDraft();
        setQuickAddVisible(false);
      });
    }

    if (deleteBtn) deleteBtn.classList.add("is-hidden");
    if (dragBtn) dragBtn.classList.add("is-hidden");
    if (moveUpBtn) moveUpBtn.classList.add("is-hidden");
    if (moveDownBtn) moveDownBtn.classList.add("is-hidden");

    renderItemRankingLines(draft, mainRankBadge, top1, top2);
    if (top1 && !draft.productId) {
      top1.classList.remove("is-hidden");
      top1.textContent = "Clique em Produto/Marca/Mercado/Preco/Qtd para preencher.";
    }
    if (top2 && !draft.productId) {
      top2.classList.add("is-hidden");
    }
    if (doneLossLine) doneLossLine.classList.add("is-hidden");

    return node;
  }

  function addItemToOpenList(payload) {
    let productId = dbApi.normalizeText(payload && payload.productId);
    const newProductName = dbApi.normalizeText(payload && payload.newProductName);
    let brand = dbApi.normalizeText(payload && payload.brand);
    let market = dbApi.normalizeText(payload && payload.market);
    let price = dbApi.parsePrice(payload && payload.price);
    const rawPrice = dbApi.normalizeText(payload && payload.price);
    const rawQuantity = dbApi.normalizeText(payload && payload.quantity);
    let quantity = dbApi.parseQuantity(rawQuantity);

    if (!productId) {
      return { ok: false, message: "Selecione um produto cadastrado." };
    }

    if (productId === NEW_PRODUCT_OPTION_VALUE) {
      if (!newProductName) {
        return { ok: false, message: "Informe o nome do novo item." };
      }

      const createdId = dbApi.ensureProductInDb(newProductName);
      if (!createdId) {
        return { ok: false, message: "Nao foi possivel cadastrar o novo item." };
      }
      productId = createdId;
    }

    const hasAnyManualData = Boolean(brand || market || rawPrice);

    if (rawQuantity && !quantity) {
      return { ok: false, message: "Quantidade invalida. Use numero maior que zero." };
    }
    if (!quantity) quantity = 1;

    if (hasAnyManualData && (!brand || !market || price === null)) {
      return { ok: false, message: "Selecione marca, mercado e preco para adicionar o item." };
    }

    if (!hasAnyManualData) {
      const topTwo = dbApi.getTopTwoEntries(productId);
      if (topTwo[0]) {
        brand = topTwo[0].brand;
        market = topTwo[0].market;
        price = topTwo[0].price;
      }
    }

    const db = dbApi.getDb();
    const brandKey = dbApi.normalizeKey(brand);
    const marketKey = dbApi.normalizeKey(market);
    const nextPrice = price === null ? null : Number(Number(price).toFixed(2));

    const duplicatedOpenItem = db.listItems.find((item) => {
      if (item.deleted || item.completed) return false;
      if (item.productId !== productId) return false;
      if (dbApi.normalizeKey(item.brand) !== brandKey) return false;
      if (dbApi.normalizeKey(item.market) !== marketKey) return false;

      const currentPrice = Number(item.price);
      const currentPriceNormalized = Number.isFinite(currentPrice)
        ? Number(currentPrice.toFixed(2))
        : null;
      return currentPriceNormalized === nextPrice;
    }) || null;

    if (duplicatedOpenItem) {
      const duplicatedName = dbApi.getProductName(productId);
      const duplicatedLabel = `${duplicatedName}${brand ? ` | ${brand}` : ""}${market ? ` | ${market}` : ""}`;
      const message = `Item duplicado em aberto: ${duplicatedLabel}. Ajuste a quantidade no item existente.`;
      window.alert(message);
      return { ok: false, message };
    }

    db.listItems.push({
      id: dbApi.safeId(),
      productId,
      brand,
      market,
      price,
      quantity,
      completed: false,
      deleted: false,
      deletedAt: null,
      needsPriceSync: false,
      pendingSyncFields: createEmptyPendingSyncFields(),
      pendingOriginalValues: createEmptyPendingOriginalValues(),
      rank: dbApi.getMaxOpenRank() + 1024,
      createdAt: dbApi.nowIso(),
      updatedAt: dbApi.nowIso(),
    });
    dbApi.persistDb();

    if (brand && market && price !== null) {
      dbApi.upsertPriceInDb(productId, brand, market, price, dbApi.nowIso());
    }

    return {
      ok: true,
      productId,
      productName: dbApi.getProductName(productId),
    };
  }

  function getBulkMarketOptions(openItems = []) {
    const db = dbApi.getDb();
    return uniqueSortedOptions([
      ...db.priceBook.map((entry) => entry.market),
      ...openItems.map((item) => item.market),
    ]);
  }

  function getCurrentBuyModeLabel() {
    if (bulkMarketApplied) {
      return dbApi.normalizeText(selectedBulkMarket) || "Mercado";
    }
    return "Mais baratos";
  }

  function updateApplyMarketButtonState(openItems = null) {
    if (!home.applyMarketBtn) return;

    const sourceOpenItems = Array.isArray(openItems) ? openItems : dbApi.getOpenItems();
    if (sourceOpenItems.length === 0) {
      bulkMarketApplied = false;
      selectedBulkMarket = "";
      home.applyMarketBtn.disabled = true;
      home.applyMarketBtn.textContent = "Mais baratos";
      home.applyMarketBtn.title = "Nao ha itens em aberto.";
      return;
    }

    home.applyMarketBtn.disabled = false;
    home.applyMarketBtn.textContent = getCurrentBuyModeLabel();
    home.applyMarketBtn.title = "Escolher mercado para aplicar em toda a lista.";
  }

  function applyMarketToOpenItems(marketName) {
    const selectedMarket = dbApi.normalizeText(marketName);
    if (!selectedMarket) {
      setSyncStatus("Selecione um mercado para aplicar na lista.");
      return;
    }

    const db = dbApi.getDb();
    const openItems = dbApi.getOpenItems(db);
    if (openItems.length === 0) {
      setSyncStatus("Nao ha itens em aberto para atualizar.");
      return;
    }
    bulkMarketApplied = true;
    selectedBulkMarket = selectedMarket;

    const selectedMarketKey = dbApi.normalizeKey(selectedMarket);
    const updates = new Map();
    let changedCount = 0;
    let noReferenceCount = 0;
    let pendingBlockedCount = 0;

    for (const item of openItems) {
      if (hasAnyPendingSync(item)) {
        pendingBlockedCount += 1;
        continue;
      }

      const hasBrand = Boolean(dbApi.normalizeText(item.brand));
      const sourceEntries = hasBrand
        ? getEntriesForProductBrand(item.productId, item.brand)
        : dbApi.getPriceEntriesForProduct(item.productId);

      const marketEntry = sourceEntries.find(
        (entry) => dbApi.normalizeKey(entry.market) === selectedMarketKey,
      ) || null;

      const patch = marketEntry
        ? {
          market: marketEntry.market,
          price: marketEntry.price,
          ...(hasBrand ? {} : { brand: marketEntry.brand }),
        }
        : {
          market: selectedMarket,
          price: 0,
        };

      const preview = { ...item, ...patch };
      const hasTrackedDiff = PRICE_SYNC_FIELDS.some(
        (field) => Object.prototype.hasOwnProperty.call(patch, field)
          && !areTrackedFieldValuesEqual(field, item[field], preview[field]),
      );
      if (!hasTrackedDiff) continue;

      if (!marketEntry) noReferenceCount += 1;

      updates.set(item.id, {
        ...preview,
        needsPriceSync: false,
        pendingSyncFields: createEmptyPendingSyncFields(),
        pendingOriginalValues: createEmptyPendingOriginalValues(),
        updatedAt: dbApi.nowIso(),
      });
      changedCount += 1;
    }

    if (changedCount === 0) {
      setSyncStatus(`Nenhum item precisou ser alterado para ${selectedMarket}.`);
      renderCurrentPage();
      return;
    }

    db.listItems = db.listItems.map((item) => updates.get(item.id) || item);
    dbApi.persistDb();

    let message = `${changedCount} item(ns) atualizados para ${selectedMarket}.`;
    if (noReferenceCount > 0) {
      message += ` ${noReferenceCount} item(ns) sem referencia de preco nesse mercado.`;
    }
    if (pendingBlockedCount > 0) {
      message += ` ${pendingBlockedCount} item(ns) mantidos por terem alteracoes pendentes.`;
    }
    setSyncStatus(message);
    renderCurrentPage();
  }

  function getCheapestEntryForItem(item) {
    if (!item || !item.productId) return null;

    const hasBrand = Boolean(dbApi.normalizeText(item.brand));
    const sourceEntries = hasBrand
      ? getEntriesForProductBrand(item.productId, item.brand)
      : dbApi.getPriceEntriesForProduct(item.productId);

    let cheapest = null;
    for (const entry of sourceEntries) {
      const price = Number(entry.price);
      if (!Number.isFinite(price)) continue;
      if (!cheapest || price < cheapest.price) {
        cheapest = {
          brand: entry.brand,
          market: entry.market,
          price: Number(price.toFixed(2)),
        };
      }
    }

    return cheapest;
  }

  function applyCheapestToOpenItems() {
    const db = dbApi.getDb();
    const openItems = dbApi.getOpenItems(db);
    if (openItems.length === 0) {
      setSyncStatus("Nao ha itens em aberto para atualizar.");
      updateApplyMarketButtonState(openItems);
      return;
    }

    bulkMarketApplied = false;
    selectedBulkMarket = "";
    const updates = new Map();
    let changedCount = 0;
    let noReferenceCount = 0;
    let pendingBlockedCount = 0;

    for (const item of openItems) {
      if (hasAnyPendingSync(item)) {
        pendingBlockedCount += 1;
        continue;
      }

      const hasBrand = Boolean(dbApi.normalizeText(item.brand));
      const cheapestEntry = getCheapestEntryForItem(item);
      if (!cheapestEntry) {
        noReferenceCount += 1;
        continue;
      }

      const patch = {
        market: cheapestEntry.market,
        price: cheapestEntry.price,
        ...(hasBrand ? {} : { brand: cheapestEntry.brand }),
      };
      const preview = { ...item, ...patch };
      const hasTrackedDiff = PRICE_SYNC_FIELDS.some(
        (field) => Object.prototype.hasOwnProperty.call(patch, field)
          && !areTrackedFieldValuesEqual(field, item[field], preview[field]),
      );
      if (!hasTrackedDiff) continue;

      updates.set(item.id, {
        ...preview,
        needsPriceSync: false,
        pendingSyncFields: createEmptyPendingSyncFields(),
        pendingOriginalValues: createEmptyPendingOriginalValues(),
        updatedAt: dbApi.nowIso(),
      });
      changedCount += 1;
    }

    if (changedCount === 0) {
      let message = "Os itens ja estao no menor preco disponivel.";
      if (noReferenceCount > 0) {
        message += ` ${noReferenceCount} item(ns) sem referencia cadastrada.`;
      }
      setSyncStatus(message);
      renderCurrentPage();
      return;
    }

    db.listItems = db.listItems.map((item) => updates.get(item.id) || item);
    dbApi.persistDb();

    let message = `${changedCount} item(ns) ajustados para os menores precos.`;
    if (noReferenceCount > 0) message += ` ${noReferenceCount} item(ns) sem referencia cadastrada.`;
    if (pendingBlockedCount > 0) message += ` ${pendingBlockedCount} item(ns) mantidos por terem alteracoes pendentes.`;
    setSyncStatus(message);
    renderCurrentPage();
  }

  async function handleApplyMarketButtonClick() {
    const openItems = dbApi.getOpenItems();
    if (openItems.length === 0) {
      setSyncStatus("Nao ha itens em aberto para atualizar.");
      updateApplyMarketButtonState(openItems);
      return;
    }

    const markets = getBulkMarketOptions(openItems);
    if (markets.length === 0) {
      setSyncStatus("Nao ha mercados cadastrados para escolher.");
      return;
    }

    const CHEAPEST_OPTION = "Mais baratos";
    const marketOnlyOptions = markets.filter(
      (market) => dbApi.normalizeKey(market) !== dbApi.normalizeKey(CHEAPEST_OPTION),
    );
    const pickerOptions = [CHEAPEST_OPTION, ...marketOnlyOptions];
    const currentValue = getCurrentBuyModeLabel();

    const selectedMarket = await pickOptionFromList(
      "Escolher mercado para toda a lista",
      currentValue,
      pickerOptions,
    );
    if (selectedMarket === null) return;

    if (dbApi.normalizeKey(selectedMarket) === dbApi.normalizeKey(CHEAPEST_OPTION)) {
      applyCheapestToOpenItems();
      return;
    }

    applyMarketToOpenItems(selectedMarket);
  }

  function getEditableFieldOptions(item, field) {
    if (!item || !item.productId) return [];

    const entries = dbApi.getPriceEntriesForProduct(item.productId);
    if (field === "brand") {
      return uniqueSortedOptions(entries.map((entry) => entry.brand));
    }

    if (field === "market") {
      const brandKey = dbApi.normalizeKey(item.brand);
      const byBrand = brandKey
        ? entries.filter((entry) => dbApi.normalizeKey(entry.brand) === brandKey)
        : entries;

      return uniqueSortedOptions(byBrand.map((entry) => entry.market));
    }

    return [];
  }

  function pickOptionFromList(title, currentValue, options) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";

      const panel = document.createElement("div");
      panel.className = "picker-panel";

      const titleEl = document.createElement("h4");
      titleEl.className = "picker-title";
      titleEl.textContent = title;

      const optionsList = document.createElement("div");
      optionsList.className = "picker-options";

      const currentKey = dbApi.normalizeKey(currentValue);
      for (const optionValue of options) {
        const optionBtn = document.createElement("button");
        optionBtn.type = "button";
        optionBtn.className = "picker-option-btn";
        optionBtn.textContent = optionValue;
        if (currentKey && dbApi.normalizeKey(optionValue) === currentKey) {
          optionBtn.classList.add("is-selected");
        }
        optionBtn.addEventListener("click", () => {
          cleanup(optionValue);
        });
        optionsList.appendChild(optionBtn);
      }

      const customToggleBtn = document.createElement("button");
      customToggleBtn.type = "button";
      customToggleBtn.className = "picker-option-btn picker-option-custom";
      customToggleBtn.textContent = "Digitar outro...";

      const customInput = document.createElement("input");
      customInput.className = "picker-input is-hidden";
      customInput.type = "text";
      customInput.maxLength = 80;
      customInput.placeholder = "Digite o valor";

      const customActions = document.createElement("div");
      customActions.className = "picker-actions is-hidden";

      const customCancelBtn = document.createElement("button");
      customCancelBtn.type = "button";
      customCancelBtn.className = "picker-btn picker-btn-cancel";
      customCancelBtn.textContent = "Cancelar";

      const customSaveBtn = document.createElement("button");
      customSaveBtn.type = "button";
      customSaveBtn.className = "picker-btn picker-btn-save";
      customSaveBtn.textContent = "Salvar";

      customActions.append(customCancelBtn, customSaveBtn);

      const actions = document.createElement("div");
      actions.className = "picker-actions picker-actions-default";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "picker-btn picker-btn-cancel";
      cancelBtn.textContent = "Fechar";

      actions.append(cancelBtn);
      panel.append(titleEl, optionsList, customToggleBtn, customInput, customActions, actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      customInput.value = "";

      function cleanup(result) {
        overlay.remove();
        resolve(result);
      }

      function openCustomMode() {
        customInput.value = "";
        customInput.classList.remove("is-hidden");
        customActions.classList.remove("is-hidden");
        actions.classList.add("is-hidden");
        customToggleBtn.classList.add("is-hidden");
        customInput.focus();
      }

      function closeCustomMode() {
        customInput.classList.add("is-hidden");
        customActions.classList.add("is-hidden");
        actions.classList.remove("is-hidden");
        customToggleBtn.classList.remove("is-hidden");
      }

      function saveCustomMode() {
        const customText = dbApi.normalizeText(customInput.value);
        if (!customText) {
          setSyncStatus("Informe um valor para continuar.");
          customInput.focus();
          return;
        }
        cleanup(customText);
      }

      customToggleBtn.addEventListener("click", openCustomMode);
      customCancelBtn.addEventListener("click", closeCustomMode);
      customSaveBtn.addEventListener("click", saveCustomMode);
      cancelBtn.addEventListener("click", () => cleanup(null));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) cleanup(null);
      });
      panel.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") cleanup(null);
        if (event.key === "Enter") {
          event.preventDefault();
          if (!customActions.classList.contains("is-hidden")) {
            saveCustomMode();
          }
        }
      });

      overlay.tabIndex = -1;
      overlay.focus();
      const selectedBtn = optionsList.querySelector(".picker-option-btn.is-selected");
      if (selectedBtn) {
        selectedBtn.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function createEmptyPendingSyncFields() {
    return {
      brand: false,
      market: false,
      price: false,
    };
  }

  function createEmptyPendingOriginalValues() {
    return {};
  }

  function getPendingSyncFields(item) {
    const normalized = createEmptyPendingSyncFields();
    const raw = item && item.pendingSyncFields;

    if (raw && typeof raw === "object") {
      normalized.brand = Boolean(raw.brand);
      normalized.market = Boolean(raw.market);
      normalized.price = Boolean(raw.price);
    }

    return normalized;
  }

  function getPendingOriginalValues(item) {
    const normalized = createEmptyPendingOriginalValues();
    const raw = item && item.pendingOriginalValues;
    if (!raw || typeof raw !== "object") return normalized;

    for (const field of PRICE_SYNC_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;

      if (field === "price") {
        normalized[field] = dbApi.parsePrice(raw[field]);
      } else {
        normalized[field] = dbApi.normalizeText(raw[field]);
      }
    }

    return normalized;
  }

  function hasAnyPendingSyncFields(fields) {
    return Boolean(fields && (fields.brand || fields.market || fields.price));
  }

  function areTrackedFieldValuesEqual(field, a, b) {
    if (field === "price") {
      const first = dbApi.parsePrice(a);
      const second = dbApi.parsePrice(b);
      if (first === null && second === null) return true;
      return Number(first) === Number(second);
    }

    return dbApi.normalizeKey(a) === dbApi.normalizeKey(b);
  }

  function normalizeTrackedFieldValue(field, value) {
    if (field === "price") return dbApi.parsePrice(value);
    return dbApi.normalizeText(value);
  }

  function hasAnyPendingSync(item) {
    const fields = getPendingSyncFields(item);
    return hasAnyPendingSyncFields(fields);
  }

  function discardPendingField(itemId, field, label) {
    if (!PRICE_SYNC_FIELDS.includes(field)) return false;

    const db = dbApi.getDb();
    let changed = false;

    db.listItems = db.listItems.map((item) => {
      if (item.id !== itemId || item.deleted) return item;

      const pendingFields = getPendingSyncFields(item);
      if (!pendingFields[field]) return item;

      const pendingOriginalValues = getPendingOriginalValues(item);
      const hasOriginal = Object.prototype.hasOwnProperty.call(pendingOriginalValues, field);
      const restoredValue = hasOriginal ? pendingOriginalValues[field] : item[field];

      const nextPendingFields = { ...pendingFields, [field]: false };
      const nextPendingOriginalValues = { ...pendingOriginalValues };
      delete nextPendingOriginalValues[field];

      changed = true;
      return {
        ...item,
        [field]: restoredValue,
        needsPriceSync: hasAnyPendingSyncFields(nextPendingFields),
        pendingSyncFields: nextPendingFields,
        pendingOriginalValues: nextPendingOriginalValues,
        updatedAt: dbApi.nowIso(),
      };
    });

    if (!changed) return false;

    dbApi.persistDb();
    setSyncStatus(`Alteracao de ${label.toLowerCase()} descartada.`);
    renderCurrentPage();
    return true;
  }

  function savePendingSync(itemId) {
    const db = dbApi.getDb();
    const current = db.listItems.find((item) => item.id === itemId && !item.deleted) || null;
    if (!current) return;

    if (!hasAnyPendingSync(current)) {
      setSyncStatus("Nao ha alteracoes pendentes para salvar na base.");
      return;
    }

    const syncContext = getPriceSyncPromptContext(current);
    if (!syncContext.shouldAsk) {
      setSyncStatus("Item sem dados completos para atualizar a base.");
      return;
    }

    dbApi.upsertPriceInDb(
      current.productId,
      current.brand,
      current.market,
      current.price,
      dbApi.nowIso(),
    );

    db.listItems = db.listItems.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        needsPriceSync: false,
        pendingSyncFields: createEmptyPendingSyncFields(),
        pendingOriginalValues: createEmptyPendingOriginalValues(),
        updatedAt: dbApi.nowIso(),
      };
    });
    dbApi.persistDb();
    setSyncStatus("Alteracoes salvas na base.");
    renderCurrentPage();
  }

  function discardPendingSync(itemId) {
    const db = dbApi.getDb();
    let changed = false;

    db.listItems = db.listItems.map((item) => {
      if (item.id !== itemId || item.deleted) return item;

      const pendingFields = getPendingSyncFields(item);
      if (!hasAnyPendingSyncFields(pendingFields)) return item;

      const pendingOriginalValues = getPendingOriginalValues(item);
      const reverted = {
        ...item,
        needsPriceSync: false,
        pendingSyncFields: createEmptyPendingSyncFields(),
        pendingOriginalValues: createEmptyPendingOriginalValues(),
        updatedAt: dbApi.nowIso(),
      };

      for (const field of PRICE_SYNC_FIELDS) {
        if (!pendingFields[field]) continue;
        if (!Object.prototype.hasOwnProperty.call(pendingOriginalValues, field)) continue;
        reverted[field] = pendingOriginalValues[field];
      }

      changed = true;
      return reverted;
    });

    if (!changed) {
      setSyncStatus("Nao ha alteracoes pendentes para descartar.");
      return;
    }

    dbApi.persistDb();
    setSyncStatus("Alteracoes pendentes descartadas.");
    renderCurrentPage();
  }

  function updateListItem(itemId, patch) {
    const db = dbApi.getDb();
    let current = null;
    let changed = null;

    db.listItems = db.listItems.map((item) => {
      if (item.id !== itemId) return item;
      current = item;
      changed = { ...item, ...patch, updatedAt: dbApi.nowIso() };
      return changed;
    });

    if (!changed || !current) return;

    const changedPriceFields = PRICE_SYNC_FIELDS
      .some((field) => Object.prototype.hasOwnProperty.call(patch, field));

    const nextPendingFields = { ...getPendingSyncFields(current) };
    const nextPendingOriginalValues = { ...getPendingOriginalValues(current) };
    for (const field of PRICE_SYNC_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;

      const hasDiffToCurrent = !areTrackedFieldValuesEqual(field, current[field], changed[field]);
      if (hasDiffToCurrent) {
        if (!nextPendingFields[field]) {
          nextPendingOriginalValues[field] = normalizeTrackedFieldValue(field, current[field]);
        }
        nextPendingFields[field] = true;
      }

      if (nextPendingFields[field] && Object.prototype.hasOwnProperty.call(nextPendingOriginalValues, field)) {
        if (areTrackedFieldValuesEqual(field, changed[field], nextPendingOriginalValues[field])) {
          nextPendingFields[field] = false;
          delete nextPendingOriginalValues[field];
        }
      }
    }

    changed.pendingSyncFields = nextPendingFields;
    changed.pendingOriginalValues = nextPendingOriginalValues;
    changed.needsPriceSync = hasAnyPendingSyncFields(nextPendingFields);

    dbApi.persistDb();

    if (current.completed && changed.needsPriceSync && changedPriceFields) {
      const syncContext = getPriceSyncPromptContext(changed);
      if (syncContext.shouldAsk) {
        const shouldSync = window.confirm(syncContext.message);
        if (shouldSync) {
          dbApi.upsertPriceInDb(
            changed.productId,
            changed.brand,
            changed.market,
            changed.price,
            dbApi.nowIso(),
          );
          db.listItems = db.listItems.map((item) => {
            if (item.id !== itemId) return item;
            return {
              ...item,
              needsPriceSync: false,
              pendingSyncFields: createEmptyPendingSyncFields(),
              pendingOriginalValues: createEmptyPendingOriginalValues(),
              updatedAt: dbApi.nowIso(),
            };
          });
          dbApi.persistDb();
          setSyncStatus("Base atualizada com os dados do item concluido.");
        }
      }
    }

    renderCurrentPage();
  }

  function getPriceSyncPromptContext(item) {
    const productId = item && item.productId;
    const brand = dbApi.normalizeText(item && item.brand);
    const market = dbApi.normalizeText(item && item.market);
    const price = Number(item && item.price);

    if (!productId || !brand || !market || !Number.isFinite(price)) {
      return {
        shouldAsk: false,
        message: "",
      };
    }

    const existing = dbApi.getDb().priceBook.find((entry) => (
      entry.productId === productId
      && dbApi.normalizeKey(entry.brand) === dbApi.normalizeKey(brand)
      && dbApi.normalizeKey(entry.market) === dbApi.normalizeKey(market)
    ));

    if (!existing) {
      return {
        shouldAsk: true,
        message: `Deseja atualizar local e preco na base?\n${dbApi.getProductName(productId)} | ${brand} | ${market} | ${dbApi.formatPrice(price)}`,
      };
    }

    const samePrice = Number(existing.price) === price;
    if (samePrice) {
      return {
        shouldAsk: true,
        message: `Deseja atualizar preco e/ou local de compra na base?\n${dbApi.getProductName(productId)} | ${brand} | ${market} | ${dbApi.formatPrice(price)}`,
      };
    }

    return {
      shouldAsk: true,
      message: `Deseja atualizar preco na base para este local?\n${dbApi.getProductName(productId)} | ${brand} | ${market} | ${dbApi.formatPrice(price)}`,
    };
  }

  async function promptAndUpdateItemField(item, field) {
    const label = field === "price"
      ? "Preco"
      : field === "market"
        ? "Mercado"
        : field === "quantity"
          ? "Quantidade"
          : "Marca";
    const current = field === "price"
      ? (Number.isFinite(Number(item.price)) ? String(item.price) : "")
      : field === "quantity"
        ? String(getItemQuantity(item))
      : dbApi.normalizeText(item[field]);

    if (field === "price") {
      const nextRaw = window.prompt(`${label} do item`, current);
      if (nextRaw === null) return;

      const nextPrice = dbApi.parsePrice(nextRaw);
      if (nextPrice === null) {
        setSyncStatus("Preco invalido. Use numero como 7.89");
        return;
      }
      updateListItem(item.id, { price: nextPrice });
      return;
    }

    if (field === "quantity") {
      const nextRaw = window.prompt(`${label} do item`, current);
      if (nextRaw === null) return;

      const nextQty = dbApi.parseQuantity(nextRaw);
      if (!nextQty) {
        setSyncStatus("Quantidade invalida. Use numero maior que zero.");
        return;
      }

      updateListItem(item.id, { quantity: nextQty });
      return;
    }

    const options = getEditableFieldOptions(item, field);
    let nextText = "";

    if (options.length > 0) {
      const selected = await pickOptionFromList(`${label} do item`, current, options);
      if (selected === null) return;
      nextText = dbApi.normalizeText(selected);
    } else {
      const nextRaw = window.prompt(`${label} do item`, current);
      if (nextRaw === null) return;
      nextText = dbApi.normalizeText(nextRaw);
    }

    if (!nextText) {
      setSyncStatus(`${label} nao pode ficar vazio.`);
      return;
    }

    if (field === "market") {
      const entries = dbApi.getPriceEntriesForProduct(item.productId);
      const brandKey = dbApi.normalizeKey(item.brand);
      const sourceEntries = brandKey
        ? entries.filter((entry) => dbApi.normalizeKey(entry.brand) === brandKey)
        : entries;
      const hasReferenceForMarket = sourceEntries.some(
        (entry) => dbApi.normalizeKey(entry.market) === dbApi.normalizeKey(nextText),
      );

      if (!hasReferenceForMarket) {
        updateListItem(item.id, { market: nextText, price: 0 });
        setSyncStatus("Mercado sem referencia para este item. Preco definido como 0.");
        return;
      }
    }

    updateListItem(item.id, { [field]: nextText });
  }

  function moveOpenItem(itemId, offset) {
    const db = dbApi.getDb();
    const ordered = dbApi.getOpenItems();
    const index = ordered.findIndex((item) => item.id === itemId);
    if (index < 0) return;

    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= ordered.length) return;

    db.openOrderMode = "manual";

    const [picked] = ordered.splice(index, 1);
    ordered.splice(nextIndex, 0, picked);

    const rankMap = new Map();
    for (let i = 0; i < ordered.length; i += 1) {
      rankMap.set(ordered[i].id, (i + 1) * 1024);
    }

    db.listItems = db.listItems.map((item) => {
      if (!rankMap.has(item.id)) return item;
      return { ...item, rank: rankMap.get(item.id), updatedAt: dbApi.nowIso() };
    });

    dbApi.persistDb();
    renderCurrentPage();
  }

  function serializeOpenDomOrder() {
    if (!home.openList) return "";

    return [...home.openList.querySelectorAll(".task-item[data-item-id]")]
      .map((el) => String(el.dataset.itemId || ""))
      .filter(Boolean)
      .join("|");
  }

  function persistOpenOrderFromDom() {
    if (!home.openList) return false;

    const orderedIds = [...home.openList.querySelectorAll(".task-item[data-item-id]")]
      .map((el) => String(el.dataset.itemId || ""))
      .filter(Boolean);

    if (orderedIds.length === 0) return false;

    const rankMap = new Map();
    for (let i = 0; i < orderedIds.length; i += 1) {
      rankMap.set(orderedIds[i], (i + 1) * 1024);
    }

    const db = dbApi.getDb();
    let changedAny = false;

    db.listItems = db.listItems.map((item) => {
      if (item.deleted || item.completed || !rankMap.has(item.id)) return item;

      const nextRank = rankMap.get(item.id);
      if (Number(item.rank) === Number(nextRank)) return item;

      changedAny = true;
      return { ...item, rank: nextRank, updatedAt: dbApi.nowIso() };
    });

    if (!changedAny) return false;

    db.openOrderMode = "manual";
    dbApi.persistDb();
    return true;
  }

  function clearOpenDragState() {
    openDragState.active = false;
    openDragState.pointerId = null;
    openDragState.draggedEl = null;
    openDragState.handleEl = null;
    openDragState.startedOrder = "";
  }

  function finishOpenItemDrag(event) {
    if (!openDragState.active) return;

    const draggedEl = openDragState.draggedEl;
    const handleEl = openDragState.handleEl;

    document.removeEventListener("pointermove", onOpenItemDragMove);
    document.removeEventListener("pointerup", finishOpenItemDrag);
    document.removeEventListener("pointercancel", finishOpenItemDrag);

    if (handleEl && event && Number.isInteger(openDragState.pointerId)) {
      try {
        if (handleEl.hasPointerCapture(openDragState.pointerId)) {
          handleEl.releasePointerCapture(openDragState.pointerId);
        }
      } catch {
        // Ignore pointer capture release failures.
      }
    }

    if (draggedEl) {
      draggedEl.classList.remove("is-dragging");
    }

    const endOrder = serializeOpenDomOrder();
    const hasOrderChanged = Boolean(openDragState.startedOrder && endOrder && endOrder !== openDragState.startedOrder);
    clearOpenDragState();

    if (hasOrderChanged && persistOpenOrderFromDom()) {
      setSyncStatus("Ordem da lista atualizada.");
      renderCurrentPage();
    }
  }

  function onOpenItemDragMove(event) {
    if (!openDragState.active || !home.openList || !openDragState.draggedEl) return;
    event.preventDefault();

    const draggedEl = openDragState.draggedEl;
    const siblings = [...home.openList.querySelectorAll(".task-item[data-item-id]")]
      .filter((el) => el !== draggedEl);

    let placed = false;
    for (const sibling of siblings) {
      const rect = sibling.getBoundingClientRect();
      const middleY = rect.top + (rect.height / 2);
      if (event.clientY < middleY) {
        home.openList.insertBefore(draggedEl, sibling);
        placed = true;
        break;
      }
    }

    if (!placed) {
      home.openList.appendChild(draggedEl);
    }
  }

  function startOpenItemDrag(event, itemEl, handleEl) {
    if (!home.openList || openDragState.active || !itemEl || !handleEl) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.preventDefault();

    openDragState.active = true;
    openDragState.pointerId = event.pointerId;
    openDragState.draggedEl = itemEl;
    openDragState.handleEl = handleEl;
    openDragState.startedOrder = serializeOpenDomOrder();

    itemEl.classList.add("is-dragging");

    try {
      handleEl.setPointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture errors.
    }

    document.addEventListener("pointermove", onOpenItemDragMove, { passive: false });
    document.addEventListener("pointerup", finishOpenItemDrag);
    document.addEventListener("pointercancel", finishOpenItemDrag);
  }

  function wireOpenListDragHandles() {
    if (!home.openList) return;

    const handles = home.openList.querySelectorAll(".btn-drag");
    for (const handle of handles) {
      const itemEl = handle.closest(".task-item");
      if (!itemEl) continue;

      handle.addEventListener("pointerdown", (event) => {
        startOpenItemDrag(event, itemEl, handle);
      });
    }
  }

  function toggleComplete(itemId) {
    const db = dbApi.getDb();
    const reopenRank = dbApi.getMaxOpenRank() + 1024;
    const currentItem = db.listItems.find((item) => item.id === itemId && !item.deleted) || null;
    if (!currentItem) return;

    let syncPriceOnComplete = false;
    if (!currentItem.completed && hasAnyPendingSync(currentItem)) {
      const syncContext = getPriceSyncPromptContext(currentItem);
      if (syncContext.shouldAsk) {
        syncPriceOnComplete = window.confirm(syncContext.message);
      }
    }

    db.listItems = db.listItems.map((item) => {
      if (item.id !== itemId || item.deleted) return item;

      if (item.completed) {
        return { ...item, completed: false, rank: reopenRank, updatedAt: dbApi.nowIso() };
      }

      const pendingFields = syncPriceOnComplete
        ? createEmptyPendingSyncFields()
        : getPendingSyncFields(item);
      const pendingOriginalValues = syncPriceOnComplete
        ? createEmptyPendingOriginalValues()
        : getPendingOriginalValues(item);

      return {
        ...item,
        completed: true,
        needsPriceSync: hasAnyPendingSyncFields(pendingFields),
        pendingSyncFields: pendingFields,
        pendingOriginalValues: pendingOriginalValues,
        updatedAt: dbApi.nowIso(),
      };
    });

    dbApi.persistDb();

    if (!currentItem.completed && syncPriceOnComplete) {
      dbApi.upsertPriceInDb(
        currentItem.productId,
        currentItem.brand,
        currentItem.market,
        currentItem.price,
        dbApi.nowIso(),
      );
      setSyncStatus("Item concluido e base de preco/local atualizada.");
    }

    renderCurrentPage();
  }

  function removeFromShoppingList(itemId) {
    const db = dbApi.getDb();
    db.listItems = db.listItems.map((item) => {
      if (item.id !== itemId || item.deleted) return item;
      return {
        ...item,
        deleted: true,
        deletedAt: dbApi.nowIso(),
        completed: false,
        updatedAt: dbApi.nowIso(),
      };
    });

    dbApi.persistDb();
    renderCurrentPage();
  }

  function addCatalogItemToOpen(productId) {
    const db = dbApi.getDb();
    const refs = dbApi.getPriceEntriesForProduct(productId);
    const ref = refs[0] || null;

    const brand = ref ? ref.brand : "";
    const market = ref ? ref.market : "";
    const price = ref ? ref.price : null;

    db.listItems.push({
      id: dbApi.safeId(),
      productId,
      brand,
      market,
      price,
      quantity: 1,
      completed: false,
      deleted: false,
      deletedAt: null,
      needsPriceSync: false,
      pendingSyncFields: createEmptyPendingSyncFields(),
      pendingOriginalValues: createEmptyPendingOriginalValues(),
      rank: dbApi.getMaxOpenRank() + 1024,
      createdAt: dbApi.nowIso(),
      updatedAt: dbApi.nowIso(),
    });

    dbApi.persistDb();
    setSyncStatus(`Item ${dbApi.getProductName(productId)} adicionado em Em aberto.`);
    renderCurrentPage();
  }

  function renderHomeListItem(item, index, total, mode) {
    const node = home.itemTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.itemId = item.id;

    const toggleBtn = node.querySelector(".btn-toggle");
    const titleEl = node.querySelector(".task-product") || node.querySelector("h3");
    const saveSyncBtn = node.querySelector(".btn-save-sync");
    const discardSyncBtn = node.querySelector(".btn-discard-sync");
    const deleteBtn = node.querySelector(".btn-delete");
    const dragBtn = node.querySelector(".btn-drag");
    const moveUpBtn = node.querySelector(".btn-move-up");
    const moveDownBtn = node.querySelector(".btn-move-down");

    const brandBtn = node.querySelector(".btn-brand");
    const marketBtn = node.querySelector(".btn-market");
    const priceBtn = node.querySelector(".btn-price");
    const qtyBtn = node.querySelector(".btn-qty");
    const mainRankBadge = node.querySelector(".top-rank-main");

    const top1 = node.querySelector(".top-price-1");
    const top2 = node.querySelector(".top-price-2");
    const doneLossLine = node.querySelector(".done-loss-line");

    titleEl.textContent = dbApi.getProductName(item.productId);
    brandBtn.textContent = item.brand || "Definir";
    marketBtn.textContent = item.market || "Local";
    priceBtn.textContent = Number.isFinite(Number(item.price)) ? dbApi.formatPrice(item.price) : "Preco";
    if (qtyBtn) qtyBtn.textContent = `Qtd ${formatQuantity(getItemQuantity(item))}`;

    const pendingFields = getPendingSyncFields(item);
    const hasPendingSync = pendingFields.brand || pendingFields.market || pendingFields.price;
    brandBtn.classList.toggle("pending-sync", pendingFields.brand);
    marketBtn.classList.toggle("pending-sync", pendingFields.market);
    priceBtn.classList.toggle("pending-sync", pendingFields.price);

    if (saveSyncBtn) {
      saveSyncBtn.classList.toggle("is-hidden", !hasPendingSync);
      saveSyncBtn.addEventListener("click", () => savePendingSync(item.id));
    }
    if (discardSyncBtn) {
      discardSyncBtn.classList.toggle("is-hidden", !hasPendingSync);
      discardSyncBtn.addEventListener("click", () => discardPendingSync(item.id));
    }

    renderItemRankingLines(item, mainRankBadge, top1, top2);

    node.classList.toggle("done", mode === "done");
    brandBtn.addEventListener("click", () => promptAndUpdateItemField(item, "brand"));
    marketBtn.addEventListener("click", () => promptAndUpdateItemField(item, "market"));
    priceBtn.addEventListener("click", () => promptAndUpdateItemField(item, "price"));
    if (qtyBtn) qtyBtn.addEventListener("click", () => promptAndUpdateItemField(item, "quantity"));

    if (mode === "open") {
      toggleBtn.classList.remove("checked");
      toggleBtn.addEventListener("click", () => toggleComplete(item.id));
      deleteBtn.textContent = "Retirar";
      deleteBtn.title = "Retirar da lista";
      deleteBtn.addEventListener("click", () => removeFromShoppingList(item.id));
      if (dragBtn) dragBtn.classList.remove("is-hidden");
      if (doneLossLine) doneLossLine.classList.add("is-hidden");

      if (moveUpBtn) {
        moveUpBtn.disabled = index === 0;
        moveUpBtn.addEventListener("click", () => moveOpenItem(item.id, -1));
      }
      if (moveDownBtn) {
        moveDownBtn.disabled = index === total - 1;
        moveDownBtn.addEventListener("click", () => moveOpenItem(item.id, 1));
      }
    }

    if (mode === "done") {
      toggleBtn.classList.add("checked");
      toggleBtn.addEventListener("click", () => toggleComplete(item.id));
      if (dragBtn) dragBtn.classList.add("is-hidden");
      if (moveUpBtn) moveUpBtn.classList.add("is-hidden");
      if (moveDownBtn) moveDownBtn.classList.add("is-hidden");
      deleteBtn.textContent = "Retirar";
      deleteBtn.title = "Retirar da lista";
      deleteBtn.addEventListener("click", () => removeFromShoppingList(item.id));

      if (doneLossLine) {
        doneLossLine.classList.remove("is-hidden", "loss-high", "loss-neutral");
        const info = getItemSpendAndLoss(item);

        if (info.totalPaid === null) {
          doneLossLine.textContent = `Qtd ${formatQuantity(info.quantity)} | Sem preco final para calcular perda.`;
          doneLossLine.classList.add("loss-neutral");
        } else if (!info.cheapest) {
          doneLossLine.textContent = `Qtd ${formatQuantity(info.quantity)} | Total ${dbApi.formatPrice(info.totalPaid)} | Sem referencia para comparar perda.`;
          doneLossLine.classList.add("loss-neutral");
        } else if (info.lossTotal > 0) {
          doneLossLine.textContent = `Qtd ${formatQuantity(info.quantity)} | Total ${dbApi.formatPrice(info.totalPaid)} | Perda neste item: ${dbApi.formatPrice(info.lossTotal)}`;
          doneLossLine.classList.add("loss-high");
        } else {
          doneLossLine.textContent = `Qtd ${formatQuantity(info.quantity)} | Total ${dbApi.formatPrice(info.totalPaid)} | Sem perda neste item`;
          doneLossLine.classList.add("loss-neutral");
        }
      }
    }

    return node;
  }

  function renderHomePage() {
    if (!home.openList || !home.doneList || !home.catalogList || !home.catalogItemTemplate) return;

    renderProductOptions(home.listProduct, { includeNewOption: true });
    syncHomeNewProductVisibility();
    fillHomeSuggestion(home.listProduct ? home.listProduct.value : "");
    syncHomeReferenceSelectors();

    home.openList.innerHTML = "";
    home.doneList.innerHTML = "";
    home.catalogList.innerHTML = "";

    const db = dbApi.getDb();
    dbApi.rebalanceOpenRanks(db);
    dbApi.persistDb();

    const openItems = dbApi.getOpenItems();
    const doneItems = dbApi.getDoneItems();
    const listedProductIds = new Set([
      ...openItems.map((item) => item.productId),
      ...doneItems.map((item) => item.productId),
    ]);
    const catalogProducts = [...db.products]
      .filter((product) => !listedProductIds.has(product.id))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    if (quickAddVisible) {
      const draftNode = renderQuickAddDraftItem();
      if (draftNode) home.openList.appendChild(draftNode);
    }

    if (openItems.length === 0) {
      if (!quickAddVisible) {
        home.openList.innerHTML = '<li class="empty-state">Nenhum item em aberto.</li>';
      }
    } else {
      const openIndexMap = new Map();
      for (let i = 0; i < openItems.length; i += 1) {
        openIndexMap.set(openItems[i].id, i);
      }

      const shouldSplitBySelectedMarket = bulkMarketApplied
        && Boolean(dbApi.normalizeText(selectedBulkMarket));

      if (shouldSplitBySelectedMarket) {
        const selectedMarketLabel = dbApi.normalizeText(selectedBulkMarket);
        const groups = splitOpenItemsBySelectedMarket(openItems, selectedMarketLabel);

        appendOpenGroupTitle(
          `Mais baratos em ${selectedMarketLabel} (1 no ranking): ${groups.bestAtSelectedMarket.length}`,
        );
        if (groups.bestAtSelectedMarket.length === 0) {
          appendOpenGroupEmpty(`Nenhum item com menor preco em ${selectedMarketLabel}.`);
        } else {
          for (const item of groups.bestAtSelectedMarket) {
            const globalIndex = openIndexMap.get(item.id) || 0;
            home.openList.appendChild(renderHomeListItem(item, globalIndex, openItems.length, "open"));
          }
        }

        appendOpenGroupTitle(
          `Comprar em ${selectedMarketLabel}, mas mais barato em outro mercado: ${groups.cheaperElsewhere.length}`,
        );
        if (groups.cheaperElsewhere.length === 0) {
          appendOpenGroupEmpty("Nenhum item neste grupo.");
        } else {
          for (const item of groups.cheaperElsewhere) {
            const globalIndex = openIndexMap.get(item.id) || 0;
            home.openList.appendChild(renderHomeListItem(item, globalIndex, openItems.length, "open"));
          }
        }
      } else {
        for (let i = 0; i < openItems.length; i += 1) {
          home.openList.appendChild(renderHomeListItem(openItems[i], i, openItems.length, "open"));
        }
      }
      wireOpenListDragHandles();
    }
    updateApplyMarketButtonState(openItems);
    renderOpenSummary(openItems);
    renderMarketAnalysis(openItems);

    if (doneItems.length === 0) {
      home.doneList.innerHTML = '<li class="empty-state">Nenhum item concluido.</li>';
    } else {
      for (let i = 0; i < doneItems.length; i += 1) {
        home.doneList.appendChild(renderHomeListItem(doneItems[i], i, doneItems.length, "done"));
      }
    }
    renderDoneSummary(doneItems);

    if (catalogProducts.length === 0) {
      home.catalogList.innerHTML = '<li class="empty-state">Todos os produtos ja estao na lista.</li>';
    } else {
      for (const product of catalogProducts) {
        const node = home.catalogItemTemplate.content.firstElementChild.cloneNode(true);
        const nameEl = node.querySelector(".catalog-name");
        const top1El = node.querySelector(".top-price-1");
        const top2El = node.querySelector(".top-price-2");
        const addBtn = node.querySelector(".btn-add-catalog");

        nameEl.textContent = product.name;
        renderTopPriceLine(top1El, product.id, 1);
        renderTopPriceLine(top2El, product.id, 2);

        addBtn.addEventListener("click", () => {
          addCatalogItemToOpen(product.id);
        });

        home.catalogList.appendChild(node);
      }
    }

    if (home.stats) {
      home.stats.textContent = `${openItems.length} em aberto | ${doneItems.length} concluidos`;
    }
  }

  function initHomePage() {
    if (!home.openList) return;

    if (home.listProduct) {
      home.listProduct.addEventListener("change", () => {
        const isNewMode = syncHomeNewProductVisibility();
        if (isNewMode && home.listNewProduct) {
          home.listNewProduct.focus();
        }
        fillHomeSuggestion(home.listProduct.value);
        syncHomeReferenceSelectors({ resetBrand: true, resetMarket: true });
      });
    }

    if (home.listBrand) {
      home.listBrand.addEventListener("change", () => {
        syncHomeReferenceSelectors({ resetMarket: true });
      });
    }

    if (home.listMarket) {
      home.listMarket.addEventListener("change", () => {
        const isNewMarketMode = syncHomeNewMarketVisibility();
        syncHomeReferenceSelectors();
        if (isNewMarketMode && home.listNewMarket) {
          home.listNewMarket.focus();
        }
      });
    }

    if (home.applyMarketBtn) {
      home.applyMarketBtn.addEventListener("click", () => {
        handleApplyMarketButtonClick();
      });
    }

    if (home.analyzeListBtn) {
      home.analyzeListBtn.addEventListener("click", () => {
        marketAnalysisVisible = !marketAnalysisVisible;
        renderCurrentPage();
      });
    }

    if (home.quickAddToggleBtn) {
      home.quickAddToggleBtn.addEventListener("click", () => {
        setQuickAddVisible(!quickAddVisible);
      });
    }

    if (home.listForm) {
      home.listForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const isNewMarketMode = home.listMarket
          ? home.listMarket.value === NEW_MARKET_OPTION_VALUE
          : false;

        const result = addItemToOpenList({
          productId: home.listProduct ? home.listProduct.value : "",
          newProductName: home.listNewProduct ? home.listNewProduct.value : "",
          brand: home.listBrand ? home.listBrand.value : "",
          market: isNewMarketMode
            ? (home.listNewMarket ? home.listNewMarket.value : "")
            : (home.listMarket ? home.listMarket.value : ""),
          price: home.listPrice ? home.listPrice.value : "",
          quantity: home.listQuantity ? home.listQuantity.value : "",
        });

        if (!result.ok) {
          setSyncStatus(result.message);
          return;
        }

        setSyncStatus(`Item ${result.productName} adicionado na lista.`);
        renderCurrentPage();
      });
    }

    quickAddVisible = false;
    resetQuickAddDraft();
    if (home.quickAddToggleBtn) {
      home.quickAddToggleBtn.textContent = "+";
      home.quickAddToggleBtn.title = "Adicionar item rapido";
    }
  }

  function getCatalogRowKey(row) {
    if (!row || !row.type) return "";
    if (row.type === "product" && row.product) return `product:${row.product.id}`;
    if (row.type === "reference" && row.entry) return `reference:${row.entry.id}`;
    return "";
  }

  function getCatalogBaseValues(row) {
    if (!row) return {};
    if (row.type === "product") {
      return {
        name: row.product ? dbApi.normalizeText(row.product.name) : "",
      };
    }

    return {
      brand: row.entry ? dbApi.normalizeText(row.entry.brand) : "",
      market: row.entry ? dbApi.normalizeText(row.entry.market) : "",
      price: row.entry ? dbApi.parsePrice(row.entry.price) : null,
    };
  }

  function normalizeCatalogEditValue(field, value) {
    if (field === "price") return dbApi.parsePrice(value);
    return dbApi.normalizeText(value);
  }

  function areCatalogEditValuesEqual(field, a, b) {
    if (field === "price") {
      const first = dbApi.parsePrice(a);
      const second = dbApi.parsePrice(b);
      if (first === null && second === null) return true;
      return Number(first) === Number(second);
    }

    return dbApi.normalizeKey(a) === dbApi.normalizeKey(b);
  }

  function getCatalogPendingPatch(rowKey) {
    const pending = catalogPendingEdits.get(rowKey);
    if (!pending || typeof pending !== "object") return {};
    return { ...pending };
  }

  function hasCatalogPendingPatch(rowKey) {
    return Object.keys(getCatalogPendingPatch(rowKey)).length > 0;
  }

  function getCatalogRowValues(row) {
    const rowKey = getCatalogRowKey(row);
    const base = getCatalogBaseValues(row);
    const pending = getCatalogPendingPatch(rowKey);
    return { ...base, ...pending };
  }

  function setCatalogPendingField(row, field, rawValue) {
    const rowKey = getCatalogRowKey(row);
    if (!rowKey) return false;

    const base = getCatalogBaseValues(row);
    const normalized = normalizeCatalogEditValue(field, rawValue);
    if (field === "price" && normalized === null) {
      setSyncStatus("Preco invalido. Use numero como 7.89");
      return false;
    }
    if (field !== "price" && !normalized) {
      setSyncStatus("Campo nao pode ficar vazio.");
      return false;
    }

    const nextPatch = getCatalogPendingPatch(rowKey);
    if (areCatalogEditValuesEqual(field, normalized, base[field])) {
      delete nextPatch[field];
    } else {
      nextPatch[field] = normalized;
    }

    if (Object.keys(nextPatch).length === 0) {
      catalogPendingEdits.delete(rowKey);
    } else {
      catalogPendingEdits.set(rowKey, nextPatch);
    }

    renderCurrentPage();
    return true;
  }

  function discardCatalogPendingRow(rowKey) {
    if (!rowKey || !catalogPendingEdits.has(rowKey)) {
      setSyncStatus("Nao ha alteracoes pendentes para descartar.");
      return;
    }

    catalogPendingEdits.delete(rowKey);
    setSyncStatus("Alteracoes descartadas.");
    renderCurrentPage();
  }

  async function promptCatalogReferenceTextField(row, field, label, options = []) {
    const currentValues = getCatalogRowValues(row);
    const current = dbApi.normalizeText(currentValues[field]);
    let nextValue = "";

    if (options.length > 0) {
      const selected = await pickOptionFromList(label, current, options);
      if (selected === null) return;
      nextValue = dbApi.normalizeText(selected);
    } else {
      const nextRaw = window.prompt(label, current);
      if (nextRaw === null) return;
      nextValue = dbApi.normalizeText(nextRaw);
    }

    if (!nextValue) {
      setSyncStatus(`${label} nao pode ficar vazio.`);
      return;
    }

    setCatalogPendingField(row, field, nextValue);
  }

  async function editCatalogRowField(row, field) {
    if (!row) return;

    if (row.type === "product" && field === "name") {
      const currentValues = getCatalogRowValues(row);
      const currentName = dbApi.normalizeText(currentValues.name || row.productName);
      const nextRaw = window.prompt("Nome do produto", currentName);
      if (nextRaw === null) return;
      const nextName = dbApi.normalizeText(nextRaw);
      if (!nextName) {
        setSyncStatus("Nome do produto nao pode ficar vazio.");
        return;
      }
      setCatalogPendingField(row, "name", nextName);
      return;
    }

    if (row.type !== "reference") return;

    if (field === "brand") {
      const brandOptions = uniqueSortedOptions(
        dbApi.getPriceEntriesForProduct(row.entry.productId).map((entry) => entry.brand),
      );
      await promptCatalogReferenceTextField(row, "brand", "Marca da referencia", brandOptions);
      return;
    }

    if (field === "market") {
      const currentValues = getCatalogRowValues(row);
      const brandKey = dbApi.normalizeKey(currentValues.brand);
      const entries = dbApi.getPriceEntriesForProduct(row.entry.productId);
      const marketSource = brandKey
        ? entries.filter((entry) => dbApi.normalizeKey(entry.brand) === brandKey)
        : entries;
      const marketOptions = uniqueSortedOptions(marketSource.map((entry) => entry.market));
      await promptCatalogReferenceTextField(row, "market", "Mercado da referencia", marketOptions);
      return;
    }

    if (field === "price") {
      const currentValues = getCatalogRowValues(row);
      const currentPrice = Number.isFinite(Number(currentValues.price)) ? String(currentValues.price) : "";
      const nextRaw = window.prompt("Preco da referencia", currentPrice);
      if (nextRaw === null) return;
      const nextPrice = dbApi.parsePrice(nextRaw);
      if (nextPrice === null) {
        setSyncStatus("Preco invalido. Use numero como 7.89");
        return;
      }
      setCatalogPendingField(row, "price", nextPrice);
    }
  }

  function syncOpenItemsWithSavedReference(productId, brand, market, price, options = {}) {
    const nextBrand = dbApi.normalizeText(brand);
    const nextMarket = dbApi.normalizeText(market);
    const nextPrice = dbApi.parsePrice(price);
    if (!productId || !nextBrand || !nextMarket || nextPrice === null) return 0;

    const db = dbApi.getDb();
    const oldBrandKey = dbApi.normalizeKey(options.oldBrand);
    const oldMarketKey = dbApi.normalizeKey(options.oldMarket);
    const nextBrandKey = dbApi.normalizeKey(nextBrand);
    const nextMarketKey = dbApi.normalizeKey(nextMarket);
    let syncedOpenCount = 0;

    db.listItems = db.listItems.map((item) => {
      if (item.deleted || item.completed || item.productId !== productId) return item;
      if (hasAnyPendingSync(item)) return item;

      const itemBrandKey = dbApi.normalizeKey(item.brand);
      const itemMarketKey = dbApi.normalizeKey(item.market);
      const matchesNew = itemBrandKey === nextBrandKey && itemMarketKey === nextMarketKey;
      const matchesOld = Boolean(oldBrandKey && oldMarketKey)
        && itemBrandKey === oldBrandKey
        && itemMarketKey === oldMarketKey;
      if (!matchesNew && !matchesOld) return item;

      const hasDiff = (
        itemBrandKey !== nextBrandKey
        || itemMarketKey !== nextMarketKey
        || Number(item.price) !== Number(nextPrice)
      );
      if (!hasDiff) return item;

      syncedOpenCount += 1;
      return {
        ...item,
        brand: nextBrand,
        market: nextMarket,
        price: nextPrice,
        updatedAt: dbApi.nowIso(),
      };
    });

    return syncedOpenCount;
  }

  function findDuplicateCatalogReference(productId, brand, market, excludeEntryId = "") {
    const normalizedProductId = dbApi.normalizeText(productId);
    const brandKey = dbApi.normalizeKey(brand);
    const marketKey = dbApi.normalizeKey(market);
    if (!normalizedProductId || !brandKey || !marketKey) return null;

    const db = dbApi.getDb();
    return db.priceBook.find((candidate) => (
      candidate.id !== excludeEntryId
      && candidate.productId === normalizedProductId
      && dbApi.normalizeKey(candidate.brand) === brandKey
      && dbApi.normalizeKey(candidate.market) === marketKey
    )) || null;
  }

  function notifyDuplicateCatalogReference(productId, brand, market) {
    const productName = dbApi.getProductName(productId);
    const message = `Referencia duplicada no cadastro: ${productName} | ${brand} | ${market}.`;
    window.alert(message);
    setSyncStatus(message);
  }

  function saveCatalogPendingRow(row) {
    const rowKey = getCatalogRowKey(row);
    if (!rowKey || !hasCatalogPendingPatch(rowKey)) {
      setSyncStatus("Nao ha alteracoes pendentes para salvar.");
      return;
    }

    const db = dbApi.getDb();
    const patch = getCatalogPendingPatch(rowKey);

    if (row.type === "product") {
      const product = db.products.find((candidate) => candidate.id === row.product.id);
      if (!product) {
        setSyncStatus("Produto nao encontrado.");
        return;
      }

      const nextName = dbApi.normalizeText(
        Object.prototype.hasOwnProperty.call(patch, "name") ? patch.name : product.name,
      );
      if (!nextName) {
        setSyncStatus("Nome do produto nao pode ficar vazio.");
        return;
      }

      const duplicated = db.products.some((candidate) => (
        candidate.id !== product.id
        && dbApi.normalizeKey(candidate.name) === dbApi.normalizeKey(nextName)
      ));
      if (duplicated) {
        setSyncStatus("Ja existe um produto com esse nome.");
        return;
      }

      product.name = nextName;
      dbApi.persistDb();
      catalogPendingEdits.delete(rowKey);
      setSyncStatus(`Produto atualizado para ${nextName}.`);
      renderCurrentPage();
      return;
    }

    const entry = db.priceBook.find((candidate) => candidate.id === row.entry.id);
    if (!entry) {
      setSyncStatus("Referencia nao encontrada.");
      return;
    }

    const nextBrand = dbApi.normalizeText(
      Object.prototype.hasOwnProperty.call(patch, "brand") ? patch.brand : entry.brand,
    );
    const nextMarket = dbApi.normalizeText(
      Object.prototype.hasOwnProperty.call(patch, "market") ? patch.market : entry.market,
    );
    const nextPrice = dbApi.parsePrice(
      Object.prototype.hasOwnProperty.call(patch, "price") ? patch.price : entry.price,
    );

    if (!nextBrand) {
      setSyncStatus("Marca nao pode ficar vazia.");
      return;
    }
    if (!nextMarket) {
      setSyncStatus("Mercado nao pode ficar vazio.");
      return;
    }
    if (nextPrice === null) {
      setSyncStatus("Preco invalido. Use numero como 7.89");
      return;
    }

    const oldBrand = dbApi.normalizeText(entry.brand);
    const oldMarket = dbApi.normalizeText(entry.market);

    const duplicate = findDuplicateCatalogReference(entry.productId, nextBrand, nextMarket, entry.id);
    if (duplicate) {
      notifyDuplicateCatalogReference(entry.productId, nextBrand, nextMarket);
      return;
    }

    entry.brand = nextBrand;
    entry.market = nextMarket;
    entry.price = nextPrice;
    entry.updatedAt = dbApi.nowIso();

    const syncedOpenCount = syncOpenItemsWithSavedReference(
      entry.productId,
      nextBrand,
      nextMarket,
      nextPrice,
      { oldBrand, oldMarket },
    );

    dbApi.persistDb();
    catalogPendingEdits.delete(rowKey);
    const syncMessage = syncedOpenCount > 0
      ? ` Referencia sincronizada em ${syncedOpenCount} item(ns) em aberto.`
      : "";
    setSyncStatus(`Referencia atualizada com sucesso.${syncMessage}`);
    renderCurrentPage();
  }

  function deleteCatalogProduct(productId) {
    const productName = dbApi.getProductName(productId);
    const confirmed = window.confirm(
      `Excluir produto "${productName}"?\nIsso remove tambem referencias e itens da lista ligados a ele.`,
    );

    if (!confirmed) return;

    const db = dbApi.getDb();
    const exists = db.products.some((product) => product.id === productId);
    if (!exists) {
      setSyncStatus("Produto nao encontrado.");
      return;
    }

    const referenceIds = db.priceBook
      .filter((entry) => entry.productId === productId)
      .map((entry) => entry.id);

    db.products = db.products.filter((product) => product.id !== productId);
    db.priceBook = db.priceBook.filter((entry) => entry.productId !== productId);
    db.listItems = db.listItems.filter((item) => item.productId !== productId);
    catalogPendingEdits.delete(`product:${productId}`);
    for (const referenceId of referenceIds) {
      catalogPendingEdits.delete(`reference:${referenceId}`);
    }
    dbApi.rebalanceOpenRanks(db);
    dbApi.persistDb();

    setSyncStatus(`Produto ${productName} excluido com sucesso.`);
    renderCurrentPage();
  }

  function editCatalogProduct(productId) {
    const db = dbApi.getDb();
    const product = db.products.find((candidate) => candidate.id === productId);
    if (!product) {
      setSyncStatus("Produto nao encontrado.");
      return;
    }

    const nextNameRaw = window.prompt("Nome do produto", product.name);
    if (nextNameRaw === null) return;

    const nextName = dbApi.normalizeText(nextNameRaw);
    if (!nextName) {
      setSyncStatus("Nome do produto nao pode ficar vazio.");
      return;
    }

    const duplicated = db.products.some((candidate) => (
      candidate.id !== productId
      && dbApi.normalizeKey(candidate.name) === dbApi.normalizeKey(nextName)
    ));

    if (duplicated) {
      setSyncStatus("Ja existe um produto com esse nome.");
      return;
    }

    product.name = nextName;
    dbApi.persistDb();

    setSyncStatus(`Produto atualizado para ${nextName}.`);
    renderCurrentPage();
  }

  function deletePriceReference(entryId) {
    const db = dbApi.getDb();
    const entry = db.priceBook.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setSyncStatus("Referencia nao encontrada.");
      return;
    }

    const entryLabel = `${dbApi.getProductName(entry.productId)} | ${entry.brand} | ${entry.market} | ${dbApi.formatPrice(entry.price)}`;
    const confirmed = window.confirm(`Excluir referencia?\n${entryLabel}`);
    if (!confirmed) return;

    db.priceBook = db.priceBook.filter((candidate) => candidate.id !== entryId);
    catalogPendingEdits.delete(`reference:${entryId}`);
    dbApi.persistDb();

    setSyncStatus("Referencia excluida com sucesso.");
    renderCurrentPage();
  }

  function editPriceReference(entryId) {
    const db = dbApi.getDb();
    const entry = db.priceBook.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setSyncStatus("Referencia nao encontrada.");
      return;
    }

    const nextBrandRaw = window.prompt("Marca da referencia", entry.brand);
    if (nextBrandRaw === null) return;
    const nextBrand = dbApi.normalizeText(nextBrandRaw);
    if (!nextBrand) {
      setSyncStatus("Marca nao pode ficar vazia.");
      return;
    }

    const nextMarketRaw = window.prompt("Mercado da referencia", entry.market);
    if (nextMarketRaw === null) return;
    const nextMarket = dbApi.normalizeText(nextMarketRaw);
    if (!nextMarket) {
      setSyncStatus("Mercado nao pode ficar vazio.");
      return;
    }

    const currentPrice = Number.isFinite(Number(entry.price)) ? String(entry.price) : "";
    const nextPriceRaw = window.prompt("Preco da referencia", currentPrice);
    if (nextPriceRaw === null) return;
    const nextPrice = dbApi.parsePrice(nextPriceRaw);
    if (nextPrice === null) {
      setSyncStatus("Preco invalido. Use numero como 7.89");
      return;
    }

    const duplicate = findDuplicateCatalogReference(entry.productId, nextBrand, nextMarket, entry.id);
    if (duplicate) {
      notifyDuplicateCatalogReference(entry.productId, nextBrand, nextMarket);
      return;
    }

    entry.brand = nextBrand;
    entry.market = nextMarket;
    entry.price = nextPrice;
    entry.updatedAt = dbApi.nowIso();

    dbApi.persistDb();
    setSyncStatus("Referencia atualizada com sucesso.");
    renderCurrentPage();
  }

  function renderCatalogPage() {
    if (!catalog.productsList) return;

    renderProductOptions(catalog.referenceProduct, {
      includeNewOption: true,
      newOptionLabel: "Escrever outro item",
    });
    syncCatalogNewProductVisibility();

    const db = dbApi.getDb();
    const sortedProducts = [...db.products].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    const cheapestByBrandMap = new Map();
    for (const entry of db.priceBook) {
      const brandKey = dbApi.normalizeKey(entry.brand);
      const entryPrice = Number(entry.price);
      if (!entry.productId || !brandKey || !Number.isFinite(entryPrice)) continue;

      const groupKey = `${entry.productId}::${brandKey}`;
      const currentMin = cheapestByBrandMap.get(groupKey);
      if (!Number.isFinite(currentMin) || entryPrice < currentMin) {
        cheapestByBrandMap.set(groupKey, entryPrice);
      }
    }

    const unifiedRows = [];
    for (const product of sortedProducts) {
      const entries = dbApi.getPriceEntriesForProduct(product.id);
      if (entries.length === 0) {
        unifiedRows.push({
          type: "product",
          product,
          productName: product.name,
          brand: "",
          market: "",
        });
        continue;
      }

      for (const entry of entries) {
        unifiedRows.push({
          type: "reference",
          product,
          entry,
          productName: product.name,
          brand: entry.brand,
          market: entry.market,
        });
      }
    }

    unifiedRows.sort((a, b) => {
      const productDiff = a.productName.localeCompare(b.productName, "pt-BR");
      if (productDiff !== 0) return productDiff;

      const brandDiff = a.brand.localeCompare(b.brand, "pt-BR");
      if (brandDiff !== 0) return brandDiff;

      return a.market.localeCompare(b.market, "pt-BR");
    });

    catalog.productsList.innerHTML = "";
    if (unifiedRows.length === 0) {
      catalog.productsList.innerHTML = '<li class="empty-state">Nenhum item cadastrado ainda.</li>';
      return;
    }

    const validRowKeys = new Set(unifiedRows.map((row) => getCatalogRowKey(row)));
    for (const pendingKey of [...catalogPendingEdits.keys()]) {
      if (!validRowKeys.has(pendingKey)) {
        catalogPendingEdits.delete(pendingKey);
      }
    }

    for (const row of unifiedRows) {
      const rowKey = getCatalogRowKey(row);
      const rowValues = getCatalogRowValues(row);
      const pendingPatch = getCatalogPendingPatch(rowKey);
      const hasPending = hasCatalogPendingPatch(rowKey);

      const li = document.createElement("li");
      li.className = "price-history-item row-action-item";

      const details = document.createElement("div");
      details.className = "row-action-text";
      const detailsMain = document.createElement("span");
      detailsMain.className = "row-action-main";

      const actions = document.createElement("div");
      actions.className = "row-action-buttons";

      if (row.type === "product") {
        const nameBtn = document.createElement("button");
        nameBtn.type = "button";
        nameBtn.className = "catalog-inline-btn";
        nameBtn.textContent = rowValues.name || row.productName;
        if (Object.prototype.hasOwnProperty.call(pendingPatch, "name")) {
          nameBtn.classList.add("pending-sync");
        }
        nameBtn.addEventListener("click", () => {
          void editCatalogRowField(row, "name");
        });

        detailsMain.append(nameBtn, document.createTextNode(" | sem referencias de preco"));
        details.appendChild(detailsMain);

        if (hasPending) {
          const saveBtn = document.createElement("button");
          saveBtn.type = "button";
          saveBtn.className = "btn-mini-save";
          saveBtn.textContent = "Salvar";
          saveBtn.title = "Salvar alteracoes";
          saveBtn.addEventListener("click", () => saveCatalogPendingRow(row));

          const discardBtn = document.createElement("button");
          discardBtn.type = "button";
          discardBtn.className = "btn-mini-discard";
          discardBtn.textContent = "Descartar";
          discardBtn.title = "Descartar alteracoes";
          discardBtn.addEventListener("click", () => discardCatalogPendingRow(rowKey));

          actions.append(saveBtn, discardBtn);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btn-mini-delete";
        deleteBtn.textContent = "Excluir";
        deleteBtn.title = "Excluir produto";
        deleteBtn.addEventListener("click", () => deleteCatalogProduct(row.product.id));

        actions.append(deleteBtn);
        li.append(details, actions);
        catalog.productsList.appendChild(li);
        continue;
      }

      const brandBtn = document.createElement("button");
      brandBtn.type = "button";
      brandBtn.className = "catalog-inline-btn";
      brandBtn.textContent = rowValues.brand || "Definir marca";
      if (Object.prototype.hasOwnProperty.call(pendingPatch, "brand")) {
        brandBtn.classList.add("pending-sync");
      }
      brandBtn.addEventListener("click", () => {
        void editCatalogRowField(row, "brand");
      });

      const marketBtn = document.createElement("button");
      marketBtn.type = "button";
      marketBtn.className = "catalog-inline-btn";
      marketBtn.textContent = rowValues.market || "Definir mercado";
      if (Object.prototype.hasOwnProperty.call(pendingPatch, "market")) {
        marketBtn.classList.add("pending-sync");
      }
      marketBtn.addEventListener("click", () => {
        void editCatalogRowField(row, "market");
      });

      const priceBtn = document.createElement("button");
      priceBtn.type = "button";
      priceBtn.className = "catalog-inline-btn";
      priceBtn.textContent = Number.isFinite(Number(rowValues.price))
        ? dbApi.formatPrice(rowValues.price)
        : "Definir preco";
      if (Object.prototype.hasOwnProperty.call(pendingPatch, "price")) {
        priceBtn.classList.add("pending-sync");
      }
      priceBtn.addEventListener("click", () => {
        void editCatalogRowField(row, "price");
      });

      detailsMain.append(
        document.createTextNode(`${row.productName} | `),
        brandBtn,
        document.createTextNode(" | "),
        marketBtn,
        document.createTextNode(" | "),
        priceBtn,
      );

      const brandGroupKey = `${row.entry.productId}::${dbApi.normalizeKey(rowValues.brand)}`;
      const cheapestForBrand = cheapestByBrandMap.get(brandGroupKey);
      if (Number.isFinite(cheapestForBrand) && Number(rowValues.price) === cheapestForBrand) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "mais barato";
        detailsMain.appendChild(tag);
      }

      const detailsMeta = document.createElement("small");
      detailsMeta.className = "row-action-meta";
      detailsMeta.textContent = `Referencia: ${formatReferenceDateTime(row.entry.updatedAt)}`;
      details.append(detailsMain, detailsMeta);

      if (hasPending) {
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn-mini-save";
        saveBtn.textContent = "Salvar";
        saveBtn.title = "Salvar alteracoes";
        saveBtn.addEventListener("click", () => saveCatalogPendingRow(row));

        const discardBtn = document.createElement("button");
        discardBtn.type = "button";
        discardBtn.className = "btn-mini-discard";
        discardBtn.textContent = "Descartar";
        discardBtn.title = "Descartar alteracoes";
        discardBtn.addEventListener("click", () => discardCatalogPendingRow(rowKey));

        actions.append(saveBtn, discardBtn);
      }

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-mini-delete";
      deleteBtn.textContent = "Excluir";
      deleteBtn.title = "Excluir referencia";
      deleteBtn.addEventListener("click", () => deletePriceReference(row.entry.id));

      actions.append(deleteBtn);
      li.append(details, actions);
      catalog.productsList.appendChild(li);
    }
  }

  function initCatalogPage() {
    if (catalog.referenceForm && catalog.referenceProduct) {
      catalog.referenceProduct.addEventListener("change", () => {
        const isNewMode = syncCatalogNewProductVisibility();
        if (isNewMode && catalog.referenceNewProduct) {
          catalog.referenceNewProduct.focus();
        }
      });

      catalog.referenceForm.addEventListener("submit", (event) => {
        event.preventDefault();

        let productId = catalog.referenceProduct.value;
        if (!productId) {
          setSyncStatus("Selecione um produto cadastrado ou + Novo item.");
          return;
        }

        if (productId === NEW_PRODUCT_OPTION_VALUE) {
          const newProductName = dbApi.normalizeText(catalog.referenceNewProduct ? catalog.referenceNewProduct.value : "");
          if (!newProductName) {
            setSyncStatus("Informe o nome do novo item.");
            if (catalog.referenceNewProduct) catalog.referenceNewProduct.focus();
            return;
          }

          const createdId = dbApi.ensureProductInDb(newProductName);
          if (!createdId) {
            setSyncStatus("Nao foi possivel cadastrar o novo item.");
            return;
          }
          productId = createdId;
        }

        const brand = dbApi.normalizeText(catalog.referenceBrand ? catalog.referenceBrand.value : "");
        const market = dbApi.normalizeText(catalog.referenceMarket ? catalog.referenceMarket.value : "");
        const price = dbApi.parsePrice(catalog.referencePrice ? catalog.referencePrice.value : "");

        if (!brand || !market || price === null) {
          setSyncStatus("Preencha produto, marca, mercado e preco valido.");
          return;
        }

        const duplicate = findDuplicateCatalogReference(productId, brand, market);
        if (duplicate) {
          notifyDuplicateCatalogReference(productId, brand, market);
          return;
        }

        dbApi.upsertPriceInDb(productId, brand, market, price, dbApi.nowIso());
        const syncedOpenCount = syncOpenItemsWithSavedReference(productId, brand, market, price);
        if (syncedOpenCount > 0) {
          dbApi.persistDb();
        }
        const syncMessage = syncedOpenCount > 0
          ? ` Lista em aberto sincronizada em ${syncedOpenCount} item(ns).`
          : "";
        setSyncStatus(`Referencia salva para ${dbApi.getProductName(productId)}.${syncMessage}`);
        catalog.referenceForm.reset();
        syncCatalogNewProductVisibility();
        renderCurrentPage();
      });
    }
  }

  function renderHistoryPage() {
    if (!history.filterProduct || !history.historyList) return;

    renderProductOptions(history.filterProduct, {
      includeAll: true,
      allLabel: "Todos os produtos",
      placeholder: "Todos os produtos",
    });

    const selectedProductId = history.filterProduct.value;
    const db = dbApi.getDb();
    const products = selectedProductId
      ? db.products.filter((product) => product.id === selectedProductId)
      : [...db.products].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    history.historyList.innerHTML = "";
    let hasAny = false;

    for (const product of products) {
      const entries = dbApi.getPriceEntriesForProduct(product.id);
      if (entries.length === 0) continue;
      hasAny = true;

      const title = document.createElement("li");
      title.className = "history-group-title";
      title.textContent = product.name;
      history.historyList.appendChild(title);

      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const li = document.createElement("li");
        li.className = "price-history-item";
        li.textContent = `${i + 1}o | ${entry.market} (${entry.brand}) | ${dbApi.formatPrice(entry.price)} | Atualizado em ${new Date(entry.updatedAt).toLocaleString("pt-BR")}`;

        if (i === 0) {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = "mais barato";
          li.appendChild(tag);
        }

        history.historyList.appendChild(li);
      }
    }

    if (!hasAny) {
      history.historyList.innerHTML = '<li class="empty-state">Nenhum historico de preco para o filtro selecionado.</li>';
    }
  }

  function initHistoryPage() {
    if (!history.filterProduct) return;

    history.filterProduct.addEventListener("change", () => {
      renderCurrentPage();
    });
  }

  function renderCurrentPage() {
    if (page === "home") {
      renderHomePage();
      return;
    }

    if (page === "catalog") {
      renderCatalogPage();
      return;
    }

    if (page === "history") {
      renderHistoryPage();
    }
  }

  function initPage() {
    if (page === "home") initHomePage();
    if (page === "catalog") initCatalogPage();
    if (page === "history") initHistoryPage();
  }

  setSyncStatus("Base pronta. Cadastre produtos e compare precos.");
  wireCommonActions();
  initPage();
  renderCurrentPage();
})();
