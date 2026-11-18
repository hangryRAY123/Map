/* ============================================================
 * Клиенты на Яндекс Карте
 * Чистый JS, без зависимостей. Данные в window.CLIENTS_DATA
 * ============================================================ */

(function () {
    "use strict";

    const DATA = (window.CLIENTS_DATA || []).slice();
    const FILTER_OPTIONS = window.FILTER_OPTIONS || { responsible: [], kkt_types: [], geocode_precision: [] };

    // ===== Состояние =====
    const state = {
        checked: new Set(),         // id клиентов с галочкой
        markers: new Map(),         // id -> ymaps.Placemark
        search: "",
        filterResponsible: "",
        filterKkt: "",
        filterPrecision: "",
        showOnlySelected: false,   // режим «Показать выбранных»
    };

    // ===== Цвета меток по ответственному =====
    const COLORS = {
        "Пушкин": "#fc3f1d",        // красный (Яндекс)
        "Кондраков": "#1976d2",     // синий
        "Титов В.": "#2e7d32",      // зелёный
        "Титов, Мих": "#7b1fa2",    // фиолетовый
        "Фалин": "#f57c00",         // оранжевый
        "Центр": "#00838f",         // бирюзовый
        "nan": "#757575",           // серый
    };
    const DEFAULT_COLOR = "#5a5a5a";

    // ===== DOM =====
    const $list = document.getElementById("clients-list");
    const $empty = document.getElementById("empty-state");
    const $search = document.getElementById("search-input");
    const $searchClear = document.getElementById("search-clear");
    const $btnHideAll = document.getElementById("btn-hide-all");
    const $btnShowSelected = document.getElementById("btn-show-selected");
    const $btnShowAllList = document.getElementById("btn-show-all-list");
    const $btnResetFilters = document.getElementById("btn-reset-filters");
    const $filterResponsible = document.getElementById("filter-responsible");
    const $filterKkt = document.getElementById("filter-kkt");
    const $filterPrecision = document.getElementById("filter-precision");
    const $statTotal = document.getElementById("stat-total");
    const $statSelected = document.getElementById("stat-selected");
    const $badge = document.getElementById("map-badge");
    const $sidebarToggle = document.getElementById("sidebar-toggle");
    const $sidebar = document.getElementById("sidebar");
    const $tpl = document.getElementById("client-item-template");

    // ===== Заполнение фильтров =====
    function fillFilterOptions() {
        const fill = (el, opts) => {
            opts.forEach(opt => {
                const o = document.createElement("option");
                o.value = opt; o.textContent = opt;
                el.appendChild(o);
            });
        };
        fill($filterResponsible, FILTER_OPTIONS.responsible || []);
        fill($filterKkt, FILTER_OPTIONS.kkt_types || []);
        fill($filterPrecision, FILTER_OPTIONS.geocode_precision || []);
    }

    // ===== Карта =====
    let ymap = null;
    function initMap() {
        if (typeof ymaps === "undefined") {
            // API не загрузился (нет ключа / нет интернета) — покажем заглушку
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
                center: [59.939, 30.316],   // Санкт-Петербург
                zoom: 10,
                controls: ["zoomControl", "fullscreenControl", "typeSelector", "rulerControl"],
            });
            // Перерисовываем метки
            refreshMarkers();
        });
    }

    function colorFor(client) {
        return COLORS[client.responsible] || DEFAULT_COLOR;
    }

    function createPlacemark(client) {
        const color = colorFor(client);
        const pm = new ymaps.Placemark(
            [client.lat, client.lon],
            {
                balloonContentHeader: escapeHtml(client.name),
                balloonContentBody:
                    "<div style='max-width:300px;'>" +
                    "<b>Адрес:</b> " + escapeHtml(client.address) + "<br>" +
                    (client.found_address ? "<b>Найденный адрес:</b> " + escapeHtml(client.found_address) + "<br>" : "") +
                    "<b>Ответственный:</b> " + escapeHtml(client.responsible) + "<br>" +
                    "<b>Количество ККТ:</b> " + client.kkt_count + "<br>" +
                    (client.kkt_types.length ? "<b>Типы ККТ:</b> " + escapeHtml(client.kkt_types.join(", ")) + "<br>" : "") +
                    (client.contact ? "<b>Контакт:</b> " + escapeHtml(client.contact) : "") +
                    "</div>",
                clusterCaption: escapeHtml(client.name),
            },
            {
                preset: "islands#circleDotIcon",
                iconColor: color,
            }
        );
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
    function refreshMarkers() {
        if (!ymap) return;
        // Удалить те, что не должны быть видны
        for (const [id, pm] of state.markers) {
            if (!state.checked.has(id)) {
                ymap.geoObjects.remove(pm);
                state.markers.delete(id);
            }
        }
        // Добавить те, что должны быть видны
        DATA.forEach(client => {
            if (state.checked.has(client.id) && !state.markers.has(client.id)) {
                const pm = createPlacemark(client);
                ymap.geoObjects.add(pm);
                state.markers.set(client.id, pm);
            }
        });
        updateBadge();
    }

    function clearAllMarkers() {
        if (!ymap) return;
        for (const [, pm] of state.markers) {
            ymap.geoObjects.remove(pm);
        }
        state.markers.clear();
        updateBadge();
    }

    function updateBadge() {
        $badge.textContent = "меток на карте: " + state.markers.size;
    }

    function updateStats() {
        $statTotal.textContent = "всего: " + DATA.length;
        $statSelected.textContent = "выбрано: " + state.checked.size;
    }

    // ===== Рендер списка =====
    function passesFilters(client) {
        if (state.search) {
            const q = state.search.toLowerCase();
            const haystack = [
                client.name, client.address, client.found_address,
                client.responsible, client.contact, client.kkt_types.join(", "),
            ].join(" ").toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        if (state.filterResponsible && client.responsible !== state.filterResponsible) return false;
        if (state.filterKkt && !client.kkt_types.includes(state.filterKkt)) return false;
        if (state.filterPrecision && client.geocode_precision !== state.filterPrecision) return false;
        return true;
    }

    function shouldShowInList(client) {
        if (state.showOnlySelected && !state.checked.has(client.id)) return false;
        return passesFilters(client);
    }

    function renderList() {
        $list.innerHTML = "";
        let count = 0;
        // Сортировка: выбранные сверху, потом по имени
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
            $name.textContent = client.name;
            $resp.textContent = client.responsible || "—";
            $addr.textContent = client.address || client.found_address || "";

            $cb.addEventListener("click", e => e.stopPropagation());
            $cb.addEventListener("change", () => onCheckboxChange(client.id, $cb.checked, $item));
            $pin.addEventListener("click", e => {
                e.stopPropagation();
                flyToClient(client);
            });
            $item.addEventListener("click", () => {
                $cb.checked = !$cb.checked;
                onCheckboxChange(client.id, $cb.checked, $item);
            });
            frag.appendChild(node);
        });
        $list.appendChild(frag);
        if (count === 0) {
            $empty.classList.remove("hidden");
        } else {
            $empty.classList.add("hidden");
        }
        updateStats();
    }

    function onCheckboxChange(id, checked, $item) {
        if (checked) {
            state.checked.add(id);
            $item.classList.add("is-checked");
            // В режиме «только выбранные» — все элементы и так видны
            addMarker(id);
        } else {
            state.checked.delete(id);
            $item.classList.remove("is-checked");
            removeMarker(id);
            // Если режим «только выбранные» — убрать из списка
            if (state.showOnlySelected) {
                $item.remove();
                if ($list.children.length === 0) $empty.classList.remove("hidden");
            }
        }
        updateStats();
    }

    function addMarker(id) {
        if (!ymap || state.markers.has(id)) return;
        const client = DATA.find(c => c.id === id);
        if (!client) return;
        const pm = createPlacemark(client);
        ymap.geoObjects.add(pm);
        state.markers.set(id, pm);
        updateBadge();
    }

    function removeMarker(id) {
        if (!ymap) return;
        const pm = state.markers.get(id);
        if (pm) {
            ymap.geoObjects.remove(pm);
            state.markers.delete(id);
            updateBadge();
        }
    }

    function flyToClient(client) {
        if (!ymap) return;
        // Если метки нет — добавим временно
        const wasChecked = state.checked.has(client.id);
        if (!wasChecked) {
            addMarker(client.id);
        }
        ymap.setCenter([client.lat, client.lon], 16, { duration: 400, checkZoomRange: true });
        // Откроем балун
        const pm = state.markers.get(client.id);
        if (pm) pm.balloon.open();
    }

    // ===== Кнопки =====
    $btnHideAll.addEventListener("click", () => {
        state.checked.clear();
        clearAllMarkers();
        renderList();
        updateStats();
    });

    $btnShowSelected.addEventListener("click", () => {
        if (state.checked.size === 0) {
            // Нет выбранных — ничего не делаем, можно подсветить кнопку
            $btnShowSelected.style.background = "#ffcaca";
            setTimeout(() => $btnShowSelected.style.background = "", 200);
            return;
        }
        state.showOnlySelected = true;
        // Убираем все метки, потом оставляем только выбранные
        clearAllMarkers();
        state.checked.forEach(id => addMarker(id));
        renderList();
        $btnShowSelected.classList.add("hidden");
        $btnShowAllList.classList.remove("hidden");
        // Подгоним карту под выбранные
        if (ymap && state.markers.size > 0) {
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
    });

    $btnShowAllList.addEventListener("click", () => {
        state.showOnlySelected = false;
        $btnShowAllList.classList.add("hidden");
        $btnShowSelected.classList.remove("hidden");
        renderList();
    });

    $btnResetFilters.addEventListener("click", () => {
        state.search = "";
        state.filterResponsible = "";
        state.filterKkt = "";
        state.filterPrecision = "";
        $search.value = "";
        $searchClear.classList.remove("visible");
        $filterResponsible.value = "";
        $filterKkt.value = "";
        $filterPrecision.value = "";
        renderList();
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

    // ===== Фильтры =====
    $filterResponsible.addEventListener("change", () => {
        state.filterResponsible = $filterResponsible.value;
        renderList();
    });
    $filterKkt.addEventListener("change", () => {
        state.filterKkt = $filterKkt.value;
        renderList();
    });
    $filterPrecision.addEventListener("change", () => {
        state.filterPrecision = $filterPrecision.value;
        renderList();
    });

    // ===== Бургер на мобильных =====
    $sidebarToggle.addEventListener("click", () => {
        $sidebar.classList.toggle("open");
        $sidebarToggle.classList.toggle("open");
    });

    // ===== Старт =====
    fillFilterOptions();
    renderList();
    updateStats();
    initMap();
})();
