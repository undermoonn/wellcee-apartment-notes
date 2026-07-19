(() => {
  "use strict";

  const FAVORITES_KEY = "wellceeApartmentFavorites";
  const NOTES_KEY = "wellceeApartmentNotes";
  const NOTE_DETAILS_KEY = "wellceeApartmentNoteDetails";
  const WELLCEE_ORIGIN = "https://www.wellcee.com";

  const favoriteTab = document.getElementById("favorite-tab");
  const noteTab = document.getElementById("note-tab");
  const viewTrack = document.getElementById("view-track");
  const favoritePanel = document.getElementById("favorite-panel");
  const notePanel = document.getElementById("note-panel");
  const favoriteList = document.getElementById("favorite-list");
  const noteList = document.getElementById("note-list");
  const favoriteEmptyState = document.getElementById("favorite-empty-state");
  const noteEmptyState = document.getElementById("note-empty-state");
  const favoriteCount = document.getElementById("favorite-count");
  const noteCount = document.getElementById("note-count");

  function getStoredData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        {
          [FAVORITES_KEY]: {},
          [NOTES_KEY]: {},
          [NOTE_DETAILS_KEY]: {}
        },
        (result) => resolve(result)
      );
    });
  }

  function removeFavorite(listingId) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [FAVORITES_KEY]: {} }, (result) => {
        const favorites = result[FAVORITES_KEY] || {};
        delete favorites[listingId];
        chrome.storage.local.set({ [FAVORITES_KEY]: favorites }, resolve);
      });
    });
  }

  function toggleFavorite(listingId, listing) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [FAVORITES_KEY]: {} }, (result) => {
        const favorites = result[FAVORITES_KEY] || {};

        if (favorites[listingId]) {
          delete favorites[listingId];
        } else {
          favorites[listingId] = {
            id: listingId,
            title: listing?.title || `Wellcee 房源 ${listingId}`,
            url:
              listing?.url ||
              `${WELLCEE_ORIGIN}/rent-apartment/${listingId}`,
            createdAt: Date.now()
          };
        }

        chrome.storage.local.set({ [FAVORITES_KEY]: favorites }, resolve);
      });
    });
  }

  function createFavoriteItem(favorite, note) {
    const item = document.createElement("article");
    item.className = "favorite-item";

    const link = document.createElement("a");
    link.className = "favorite-item__link";
    link.href = favorite.url;
    link.title = "打开房源";

    const title = document.createElement("strong");
    title.className = "favorite-item__title";
    title.textContent = favorite.title || `Wellcee 房源 ${favorite.id}`;

    const meta = document.createElement("span");
    meta.className = "favorite-item__meta";
    meta.textContent = `房源 #${favorite.id}`;

    link.append(title, meta);

    if (note?.trim()) {
      const noteText = document.createElement("p");
      noteText.className = "favorite-item__note";
      noteText.textContent = note;
      link.appendChild(noteText);
    }

    link.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.tabs.create({ url: favorite.url });
      window.close();
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "favorite-item__remove";
    removeButton.setAttribute("aria-label", `取消收藏 ${favorite.title || favorite.id}`);
    removeButton.title = "取消收藏";
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      await removeFavorite(favorite.id);
      await render();
    });

    item.append(link, removeButton);
    return item;
  }

  function createNoteItem(listingId, note, details, favorite) {
    const listing = details || favorite;
    const item = document.createElement("article");
    item.className = "favorite-item favorite-item--note";

    const link = document.createElement("a");
    link.className = "favorite-item__link";
    link.href = listing?.url || `${WELLCEE_ORIGIN}/rent-apartment/${listingId}`;
    link.title = "打开房源";

    const title = document.createElement("strong");
    title.className = "favorite-item__title";
    title.textContent = listing?.title || `Wellcee 房源 ${listingId}`;

    const meta = document.createElement("span");
    meta.className = "favorite-item__meta";
    meta.textContent = `房源 #${listingId}`;

    const noteText = document.createElement("p");
    noteText.className = "favorite-item__note";
    noteText.textContent = note;

    link.append(title, meta, noteText);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.tabs.create({ url: link.href });
      window.close();
    });

    const favoriteButton = document.createElement("button");
    const isFavorite = Boolean(favorite);
    favoriteButton.type = "button";
    favoriteButton.className = "favorite-item__favorite-state";
    favoriteButton.setAttribute("aria-pressed", String(isFavorite));
    favoriteButton.setAttribute(
      "aria-label",
      isFavorite ? `取消收藏 ${title.textContent}` : `收藏 ${title.textContent}`
    );
    favoriteButton.title = isFavorite ? "取消收藏" : "收藏房源";
    favoriteButton.addEventListener("click", async () => {
      favoriteButton.disabled = true;
      await toggleFavorite(listingId, listing);
      await render();
    });

    item.append(link, favoriteButton);
    return item;
  }

  function selectView(view) {
    const showFavorites = view === "favorites";
    viewTrack.dataset.view = showFavorites ? "favorites" : "notes";
    favoritePanel.inert = !showFavorites;
    notePanel.inert = showFavorites;
    favoritePanel.setAttribute("aria-hidden", String(!showFavorites));
    notePanel.setAttribute("aria-hidden", String(showFavorites));
    favoriteTab.classList.toggle("is-active", showFavorites);
    noteTab.classList.toggle("is-active", !showFavorites);
    favoriteTab.setAttribute("aria-selected", String(showFavorites));
    noteTab.setAttribute("aria-selected", String(!showFavorites));
  }

  async function render() {
    const result = await getStoredData();
    const favorites = Object.values(result[FAVORITES_KEY] || {}).sort(
      (left, right) => (right.createdAt || 0) - (left.createdAt || 0)
    );
    const notes = result[NOTES_KEY] || {};
    const noteDetails = result[NOTE_DETAILS_KEY] || {};
    const noteEntries = Object.entries(notes)
      .filter(([, note]) => typeof note === "string" && note.trim())
      .reverse()
      .sort(
        ([leftId], [rightId]) =>
          (noteDetails[rightId]?.updatedAt || 0) -
          (noteDetails[leftId]?.updatedAt || 0)
      );
    const favoritesById = Object.fromEntries(
      favorites.map((favorite) => [String(favorite.id), favorite])
    );

    favoriteList.replaceChildren();
    noteList.replaceChildren();
    favoriteCount.textContent = String(favorites.length);
    noteCount.textContent = String(noteEntries.length);
    favoriteEmptyState.hidden = favorites.length > 0;
    noteEmptyState.hidden = noteEntries.length > 0;

    favorites.forEach((favorite) => {
      favoriteList.appendChild(createFavoriteItem(favorite, notes[favorite.id]));
    });

    noteEntries.forEach(([listingId, note]) => {
      noteList.appendChild(
        createNoteItem(
          listingId,
          note,
          noteDetails[listingId],
          favoritesById[listingId]
        )
      );
    });
  }

  favoriteTab.addEventListener("click", () => selectView("favorites"));
  noteTab.addEventListener("click", () => selectView("notes"));

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === "local" &&
      (changes[FAVORITES_KEY] ||
        changes[NOTES_KEY] ||
        changes[NOTE_DETAILS_KEY])
    ) {
      render();
    }
  });

  render();
})();
