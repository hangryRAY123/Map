/* ============================================================
 * Клиенты на Яндекс Карте
 * Чистый JS, без зависимостей. Данные в window.CLIENTS_DATA
 *
 * Концепция:
 *  - На карте могут быть видны метки клиентов независимо от выбора.
 *  - state.checked — множество клиентов, выделенных пользователем
 *    (клик по метке на карте или чекбокс в списке).
 *  - state.allMarkersOnMap — показаны ли все метки на карте.
 *  - URL хранит список выбранных (#ids=...) и режим показа (#view=selected).
 * ============================================================ */

(function () {
    "use strict";

    const DATA = (window.CLIENTS_DATA || []).slice();
    const ID_INDEX = new Map(DATA.map(c => [c.id, c]));

    // ===== Состояние =====
    const state = {
        checked: new Set(),         // id выбранных клиентов
        markers: new Map(),         // id -> ymaps.Placemark (текущие метки на карте)
        allMarkersOnMap: false,    // показаны ли все метки
        search: "",
        showOnlySelected: false,   // режим «только выбранные» в списке
    };

    // ===== Цвета меток по ответственному =====
    const COLORS = {
        "Пушкин": "#fc3f1d",
        "Кондраков": "#1976d2",
        "Титов В.": "#2e7d32",
        "Титов, Мих": "#7b1fa2",
        "Фалин": "#f57c00",
        "Центр": "#00838f",
        "nan": "#757575",
    };
    const DEFAULT_COLOR = "#5a5a5a";
    const EXTRA_COLOR = "#ff6f00";
    const SELECTED_COLOR = "#000000";  // цвет выбранной метки (чёрный контур)

    // ===== DOM =====
    const $list = document.getElementById("clients-list");
    const $empty = document.getElementById("empty-state");
    const $search = document.getElementById("search-input");
    const $searchClear = document.getElementById("search-clear");
    const $btnHideAll = document.getElementById("btn-hide-all");
    const $btnShowSelected = document.getElementById("btn-show-selected");
    const $btnShowAllOnMap = document.getElementById("btn-show-all-on-map");
    const $btnKeepOnlySelected = document.getElementById("btn-keep-only-selected");
    const $btnShowAllList = document.getElementById("btn-show-all-list");
    const $statTotal = document.getElementById("stat-total");
    const $statSelected = document.getElementById("stat-selected");
    const $badge = document.getElementById("map-badge");
    const $sidebarToggle = document.getElementById("sidebar-toggle");
    const $sidebar = document.getElementById("sidebar");
    const $tpl = document.getElementById("client-item-template");

    // ===== Работа с URL =====
    // Формат: #ids=1,2,3&view=selected&all=1
    function updateUrl() {
        const parts = [];
        if (state.checked.size > 0) {
            const idsStr = Array.from(state.checked).sort((a, b) => a - b).join(",");
            parts.push("ids=" + idsStr);
        }
        if (state.showOnlySelected) parts.push("view=selected");
        if (state.allMarkersOnMap) parts.push("all=1");
        const newHash = parts.length ? "#" + parts.join("&") : "";
        const curHash = window.location.hash || "";
        if (curHash !== newHash) {
            const newUrl = window.location.pathname + window.location.search + newHash;
            window.history.replaceState(null, "", newUrl);
        }
    }

    function parseUrlState() {
        const hash = window.location.hash.replace(/^#/, "");
        if (!hash) return { ids: [], viewSelected: false, all: false };
        const params = {};
        hash.split("&").forEach(kv => {
            const idx = kv.indexOf("=");
            if (idx > 0) {
                params[kv.slice(0, idx)] = decodeURIComponent(kv.slice(idx + 1));
            }
        });
        let ids = [];
        if (params.ids) {
            ids = params.ids.split(",")
                .map(s => parseInt(s, 10))
                .filter(n => !isNaN(n) && ID_INDEX.has(n));
        }
        return {
            ids: ids,
            viewSelected: params.view === "selected",
            all: params.all === "1",
        };
    }

    function restoreFromUrl() {
        const parsed = parseUrlState();
        if (parsed.ids.length > 0) {
            parsed.ids.forEach(id => state.checked.add(id));
        }
        if (parsed.all) {
            state.allMarkersOnMap = true;
        }
        if (parsed.viewSelected) {
            state.showOnlySelected = true;
            $btnShowSelected.classList.add("hidden");
            $btnShowAllOnMap.classList.add("hidden");
            $btnHideAll.classList.add("hidden");
            $btnKeepOnlySelected.classList.add("hidden");
            $btnShowAllList.classList.remove("hidden");
        }
    }

    // ===== Карта =====
    let ymap = null;
    function initMap() {
        if (typeof ymaps === "undefined") {
            const $map = document.getElementById("map");
            $map.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:center;' +
                'height:100%;flex-direction:column;color:#8e8e93;padding:20px;text-align:center;">' +
                '<div style="font-size:48px;margin-bottom:12px;">🗺️</div>' +
                '<div style="font-size:16px;font-weight:500;margin-bottom:8px;color:#1f1f1f;">' +
                'Яндекс Карты не загрузились</div>' +
                '<div style="font-size:13px;max-width:380px;line-height:1.5;">' +
                'Откройте <code>index.html</code> в текстовом редакторе и вставьте ' +
                'ваш API-ключ Яндекс Карт вместо <code>PASTE_YOUR_API_KEY_HERE</code>. ' +
                'Ключ бесплатно: <a href="https://developer.tech.yandex.ru/maps/" ' +
                'target="_blank" style="color:#fc3f1d;">developer.tech.yandex.ru/maps</a></div>' +
                '</div>';
            return;
        }
        ymaps.ready(function () {
            ymap = new ymaps.Map("map", {
                center: [59.939, 30.316],
                zoom: 10,
                controls: ["zoomControl", "fullscreenControl", "typeSelector", "rulerControl"],
            });
            // Если в URL был all=1 — показать все метки
            if (state.allMarkersOnMap) {
                showAllMarkersOnMap();
            } else if (state.checked.size > 0) {
                // Иначе показать только выбранные
                state.checked.forEach(id => addMarker(id));
                fitBoundsToMarkers();
            }
            updateBadge();
            updateKeepButton();
        });
    }

    function colorFor(client) {
        if (client.is_extra) return EXTRA_COLOR;
        return COLORS[client.responsible] || DEFAULT_COLOR;
    }

    function createPlacemark(client) {
        const color = colorFor(client);
        const isSelected = state.checked.has(client.id);
        const extraBadge = client.is_extra
            ? '<div style="display:inline-block;background:#fff3e0;color:#ff6f00;font-size:10px;padding:1px 6px;border-radius:6px;margin-left:4px;">проверка адреса</div>'
            : "";
        const selectedBadge = isSelected
            ? '<div style="display:inline-block;background:#000;color:#fff;font-size:10px;padding:1px 6px;border-radius:6px;margin-left:4px;">✓ выбран</div>'
            : "";

        const pm = new ymaps.Placemark(
            [client.lat, client.lon],
            {
                balloonContentHeader: escapeHtml(client.name) + extraBadge + selectedBadge,
                balloonContentBody:
                    "<div style='max-width:320px;'>" +
                    "<b>Адрес:</b> " + escapeHtml(client.address) + "<br>" +
                    (client.found_address ? "<b>Найденный адрес:</b> " + escapeHtml(client.found_address) + "<br>" : "") +
                    "<b>Ответственный:</b> " + escapeHtml(client.responsible) + "<br>" +
                    "<b>Количество ККТ:</b> " + client.kkt_count + "<br>" +
                    (client.kkt_types.length ? "<b>Типы ККТ:</b> " + escapeHtml(client.kkt_types.join(", ")) + "<br>" : "") +
                    (client.contact ? "<b>Контакт:</b> " + escapeHtml(client.contact) + "<br>" : "") +
                    "<hr style='margin:6px 0;'>" +
                    "<div style='font-size:11px;color:#888;'>" +
                    (isSelected ? "✓ Клиент в списке выбранных. Клик по метке снимет выделение." : "Клик по метке — добавить в выбранные") +
                    "</div>" +
                    "</div>",
                clusterCaption: escapeHtml(client.name),
            },
            {
                // Выбранные — крупная метка с обводкой, обычные — точка
                preset: isSelected ? "islands#circleIcon" : "islands#circleDotIcon",
                iconColor: color,
                // Для выбранных добавим контур
                iconStrokeColor: isSelected ? "#000000" : "FFFFFF",
                iconStrokeWidth: isSelected ? 3 : 1,
            }
        );
        // Клик по метке — добавить/снять выделение (не убирая саму метку)
        pm.events.add("click", () => {
            const newChecked = !state.checked.has(client.id);
            toggleChecked(client.id, newChecked);
        });
        return pm;
    }

    function escapeHtml(s) {
        if (s == null) return "";
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ===== Работа с метками =====
    function showAllMarkersOnMap() {
        if (!ymap) return;
        // Снимаем все метки, потом добавляем все
        clearAllMarkers();
        DATA.forEach(client => {
            const pm = createPlacemark(client);
            ymap.geoObjects.add(pm);
            state.markers.set(client.id, pm);
        });
        state.allMarkersOnMap = true;
        updateBadge();
        updateKeepButton();
    }

    function clearAllMarkers() {
        if (!ymap) return;
        for (const [, pm] of state.markers) {
            ymap.geoObjects.remove(pm);
        }
        state.markers.clear();
        updateBadge();
        updateKeepButton();
    }

    function addMarker(id) {
        if (!ymap || state.markers.has(id)) return;
        const client = ID_INDEX.get(id);
        if (!client) return;
        const pm = createPlacemark(client);
        ymap.geoObjects.add(pm);
        state.markers.set(id, pm);
        updateBadge();
        updateKeepButton();
    }

    function removeMarker(id) {
        if (!ymap) return;
        const pm = state.markers.get(id);
        if (pm) {
            ymap.geoObjects.remove(pm);
            state.markers.delete(id);
            updateBadge();
            updateKeepButton();
        }
    }

    // Обновить визуальное отображение метки (когда меняется выбор, но метка остаётся)
    function refreshMarkerVisual(id) {
        if (!ymap) return;
        const pm = state.markers.get(id);
        if (!pm) return;
        const client = ID_INDEX.get(id);
        if (!client) return;
        const isSelected = state.checked.has(id);
        const color = colorFor(client);
        // Меняем preset и свойства обводки
        pm.options.set("preset", isSelected ? "islands#circleIcon" : "islands#circleDotIcon");
        pm.options.set("iconColor", color);
        pm.options.set("iconStrokeColor", isSelected ? "#000000" : "FFFFFF");
        pm.options.set("iconStrokeWidth", isSelected ? 3 : 1);
        // Обновляем balloonContent с актуальным selectedBadge
        const extraBadge = client.is_extra
            ? '<div style="display:inline-block;background:#fff3e0;color:#ff6f00;font-size:10px;padding:1px 6px;border-radius:6px;margin-left:4px;">проверка адреса</div>'
            : "";
        const selectedBadge = isSelected
            ? '<div style="display:inline-block;background:#000;color:#fff;font-size:10px;padding:1px 6px;border-radius:6px;margin-left:4px;">✓ выбран</div>'
            : "";
        pm.properties.set("balloonContentHeader", escapeHtml(client.name) + extraBadge + selectedBadge);
        pm.properties.set("balloonContentBody",
            "<div style='max-width:320px;'>" +
            "<b>Адрес:</b> " + escapeHtml(client.address) + "<br>" +
            (client.found_address ? "<b>Найденный адрес:</b> " + escapeHtml(client.found_address) + "<br>" : "") +
            "<b>Ответственный:</b> " + escapeHtml(client.responsible) + "<br>" +
            "<b>Количество ККТ:</b> " + client.kkt_count + "<br>" +
            (client.kkt_types.length ? "<b>Типы ККТ:</b> " + escapeHtml(client.kkt_types.join(", ")) + "<br>" : "") +
            (client.contact ? "<b>Контакт:</b> " + escapeHtml(client.contact) + "<br>" : "") +
            "<hr style='margin:6px 0;'>" +
            "<div style='font-size:11px;color:#888;'>" +
            (isSelected ? "✓ Клиент в списке выбранных. Клик по метке снимет выделение." : "Клик по метке — добавить в выбранные") +
            "</div>" +
            "</div>"
        );
    }

    function updateBadge() {
        $badge.textContent = "меток на карте: " + state.markers.size;
    }

    function updateStats() {
        $statTotal.textContent = "всего: " + DATA.length;
        $statSelected.textContent = "выбрано: " + state.checked.size;
    }

    function updateKeepButton() {
        // Кнопка "Убрать остальных" активна только когда:
        //  - есть выбранные (state.checked.size > 0)
        //  - на карте есть метки помимо выбранных (markers.size > checked.size)
        if (!$btnKeepOnlySelected) return;
        const hasOthers = state.markers.size > state.checked.size;
        const canUse = state.checked.size > 0 && hasOthers;
        $btnKeepOnlySelected.disabled = !canUse;
    }

    function fitBoundsToMarkers() {
        if (!ymap || state.markers.size === 0) return;
        try {
            ymap.setBounds(ymap.geoObjects.getBounds(), {
                checkZoomRange: true,
                duration: 400,
                zoomMargin: 30,
            });
        } catch (e) {
            // ignore
        }
    }

    // ===== Переключение выбора =====
    function toggleChecked(id, checked) {
        const $item = $list.querySelector('.client-item[data-id="' + id + '"]');
        const $cb = $item ? $item.querySelector(".client-checkbox") : null;
        if (checked) {
            state.checked.add(id);
            if ($item) $item.classList.add("is-checked");
            if ($cb) $cb.checked = true;
            // Если метки нет на карте — добавим (только если не в режиме "все метки")
            if (!state.markers.has(id)) {
                addMarker(id);
            } else {
                refreshMarkerVisual(id);
            }
        } else {
            state.checked.delete(id);
            if ($item) $item.classList.remove("is-checked");
            if ($cb) $cb.checked = false;
            // Если включён режим "только выбранные" — снять метку
            if (state.showOnlySelected && state.markers.has(id)) {
                removeMarker(id);
                if ($item) {
                    $item.remove();
                    if ($list.children.length === 0) $empty.classList.remove("hidden");
                }
            } else if (state.markers.has(id)) {
                refreshMarkerVisual(id);
            }
        }
        updateStats();
        updateUrl();
        updateKeepButton();
    }

    // ===== Рендер списка =====
    function passesSearch(client) {
        if (!state.search) return true;
        const q = state.search.toLowerCase();
        const haystack = [
            client.name, client.address, client.found_address,
            client.responsible, client.contact, client.kkt_types.join(", "),
        ].join(" ").toLowerCase();
        return haystack.includes(q);
    }

    function shouldShowInList(client) {
        if (state.showOnlySelected && !state.checked.has(client.id)) return false;
        return passesSearch(client);
    }

    function renderList() {
        $list.innerHTML = "";
        let count = 0;
        const sorted = DATA.slice().sort((a, b) => {
            const ca = state.checked.has(a.id) ? 0 : 1;
            const cb = state.checked.has(b.id) ? 0 : 1;
            if (ca !== cb) return ca - cb;
            return a.name.localeCompare(b.name, "ru");
        });

        const frag = document.createDocumentFragment();
        sorted.forEach(client => {
            if (!shouldShowInList(client)) return;
            count++;
            const node = $tpl.content.cloneNode(true);
            const $item = node.querySelector(".client-item");
            const $cb = node.querySelector(".client-checkbox");
            const $name = node.querySelector(".client-name");
            const $resp = node.querySelector(".client-responsible");
            const $addr = node.querySelector(".client-address");
            const $pin = node.querySelector(".client-pin");

            $item.dataset.id = client.id;
            $cb.checked = state.checked.has(client.id);
            if ($cb.checked) $item.classList.add("is-checked");
            if (client.is_extra) $item.classList.add("is-extra");
            $name.textContent = client.name;
            $resp.textContent = client.responsible || "—";
            $addr.textContent = client.address || client.found_address || "";

            $cb.addEventListener("click", e => e.stopPropagation());
            $cb.addEventListener("change", () => {
                toggleChecked(client.id, $cb.checked);
            });
            $pin.addEventListener("click", e => {
                e.stopPropagation();
                flyToClient(client);
            });
            $item.addEventListener("click", () => {
                $cb.checked = !$cb.checked;
                toggleChecked(client.id, $cb.checked);
            });
            frag.appendChild(node);
        });
        $list.appendChild(frag);
        $empty.classList.toggle("hidden", count > 0);
        updateStats();
    }

    function flyToClient(client) {
        if (!ymap) return;
        // Если метки нет на карте — добавим
        if (!state.markers.has(client.id)) {
            addMarker(client.id);
        }
        ymap.setCenter([client.lat, client.lon], 16, { duration: 400, checkZoomRange: true });
        const pm = state.markers.get(client.id);
        if (pm) pm.balloon.open();
    }

    // ===== Кнопки =====
    $btnHideAll.addEventListener("click", () => {
        // Снять выбор со всех и убрать все метки
        state.checked.clear();
        clearAllMarkers();
        state.allMarkersOnMap = false;
        renderList();
        updateStats();
        updateUrl();
    });

    $btnShowSelected.addEventListener("click", () => {
        if (state.checked.size === 0) {
            $btnShowSelected.style.background = "#ffcaca";
            setTimeout(() => $btnShowSelected.style.background = "", 200);
            return;
        }
        // Режим «только выбранные»: на карте оставить только выбранные,
        // в списке — только выбранные
        state.showOnlySelected = true;
        state.allMarkersOnMap = false;
        clearAllMarkers();
        state.checked.forEach(id => addMarker(id));
        renderList();
        $btnShowSelected.classList.add("hidden");
        $btnShowAllOnMap.classList.add("hidden");
        $btnHideAll.classList.add("hidden");
        $btnKeepOnlySelected.classList.add("hidden");
        $btnShowAllList.classList.remove("hidden");
        fitBoundsToMarkers();
        updateUrl();
    });

    $btnShowAllOnMap.addEventListener("click", () => {
        // Показать на карте всех клиентов (метки видны), но не менять выбор
        showAllMarkersOnMap();
        // Если были в режиме "только выбранные" — выходим
        if (state.showOnlySelected) {
            state.showOnlySelected = false;
            $btnShowSelected.classList.remove("hidden");
            $btnShowAllOnMap.classList.remove("hidden");
            $btnHideAll.classList.remove("hidden");
            $btnKeepOnlySelected.classList.remove("hidden");
            $btnShowAllList.classList.add("hidden");
        }
        renderList();
        updateUrl();
    });

    $btnKeepOnlySelected.addEventListener("click", () => {
        // Убрать с карты всех, кроме выбранных.
        // Не менять выбор и не переключать режим списка.
        if (state.checked.size === 0) return;
        // Снимаем метки, которых нет в checked
        const idsToRemove = [];
        for (const id of state.markers.keys()) {
            if (!state.checked.has(id)) idsToRemove.push(id);
        }
        idsToRemove.forEach(id => removeMarker(id));
        state.allMarkersOnMap = false;
        // Подгоним карту под оставшиеся метки
        fitBoundsToMarkers();
        updateUrl();
        updateKeepButton();
    });

    $btnShowAllList.addEventListener("click", () => {
        state.showOnlySelected = false;
        $btnShowAllList.classList.add("hidden");
        $btnShowSelected.classList.remove("hidden");
        $btnShowAllOnMap.classList.remove("hidden");
        $btnHideAll.classList.remove("hidden");
        $btnKeepOnlySelected.classList.remove("hidden");
        renderList();
        updateUrl();
    });

    // ===== Поиск =====
    let searchTimer = null;
    $search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        state.search = $search.value.trim();
        $searchClear.classList.toggle("visible", state.search.length > 0);
        searchTimer = setTimeout(renderList, 150);
    });
    $searchClear.addEventListener("click", () => {
        $search.value = "";
        state.search = "";
        $searchClear.classList.remove("visible");
        renderList();
        $search.focus();
    });

    // ===== Бургер на мобильных =====
    $sidebarToggle.addEventListener("click", () => {
        $sidebar.classList.toggle("open");
        $sidebarToggle.classList.toggle("open");
    });

    // ===== Старт =====
    restoreFromUrl();
    renderList();
    updateStats();
    initMap();
    if (state.checked.size > 0 && !state.allMarkersOnMap) {
        const tryFit = () => {
            if (ymap && state.markers.size > 0) {
                fitBoundsToMarkers();
            } else {
                setTimeout(tryFit, 200);
            }
        };
        setTimeout(tryFit, 300);
    }
})();
