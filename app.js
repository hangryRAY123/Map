/* ============================================================
 * Клиенты на Яндекс Карте
 * Чистый JS, без зависимостей. Данные в window.CLIENTS_DATA
 * ============================================================ */

(function () {
    "use strict";

    const DATA = (window.CLIENTS_DATA || []).slice();

    // ===== Состояние =====
    const state = {
        checked: new Set(),         // id клиентов с галочкой
        markers: new Map(),         // id -> ymaps.Placemark
        search: "",
        showOnlySelected: false,    // режим «Показать выбранных»
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
    const EXTRA_COLOR = "#ff6f00";  // цвет метки для клиентов из файла проверки адресов

    // ===== DOM =====
    const $list = document.getElementById("clients-list");
    const $empty = document.getElementById("empty-state");
    const $search = document.getElementById("search-input");
    const $searchClear = document.getElementById("search-clear");
    const $btnHideAll = document.getElementById("btn-hide-all");
    const $btnShowSelected = document.getElementById("btn-show-selected");
    const $btnShowAllOnMap = document.getElementById("btn-show-all-on-map");
    const $btnShowAllList = document.getElementById("btn-show-all-list");
    const $statTotal = document.getElementById("stat-total");
    const $statSelected = document.getElementById("stat-selected");
    const $badge = document.getElementById("map-badge");
    const $sidebarToggle = document.getElementById("sidebar-toggle");
    const $sidebar = document.getElementById("sidebar");
    const $tpl = document.getElementById("client-item-template");

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
                center: [59.939, 30.316],   // Санкт-Петербург
                zoom: 10,
                controls: ["zoomControl", "fullscreenControl", "typeSelector", "rulerControl"],
            });
            refreshMarkers();
        });
    }

    function colorFor(client) {
        if (client.is_extra) return EXTRA_COLOR;
        return COLORS[client.responsible] || DEFAULT_COLOR;
    }

    function createPlacemark(client) {
        const color = colorFor(client);
        const extraBadge = client.is_extra
            ? '<div style="display:inline-block;background:#fff3e0;color:#ff6f00;font-size:10px;padding:1px 6px;border-radius:6px;margin-left:4px;">проверка адреса</div>'
            : "";
        const pm = new ymaps.Placemark(
            [client.lat, client.lon],
            {
                balloonContentHeader: escapeHtml(client.name) + extraBadge,
                balloonContentBody:
                    "<div style='max-width:320px;'>" +
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

    function updateBadge() {
        $badge.textContent = "меток на карте: " + state.markers.size;
    }

    function updateStats() {
        $statTotal.textContent = "всего: " + DATA.length;
        $statSelected.textContent = "выбрано: " + state.checked.size;
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
            if (client.is_extra) $item.classList.add("is-extra");
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
        $empty.classList.toggle("hidden", count > 0);
        updateStats();
    }

    function onCheckboxChange(id, checked, $item) {
        if (checked) {
            state.checked.add(id);
            $item.classList.add("is-checked");
            addMarker(id);
        } else {
            state.checked.delete(id);
            $item.classList.remove("is-checked");
            removeMarker(id);
            if (state.showOnlySelected) {
                $item.remove();
                if ($list.children.length === 0) $empty.classList.remove("hidden");
            }
        }
        updateStats();
    }

    function flyToClient(client) {
        if (!ymap) return;
        const wasChecked = state.checked.has(client.id);
        if (!wasChecked) {
            state.checked.add(client.id);
            addMarker(client.id);
            // Обновляем чекбокс в списке
            const $cb = document.querySelector('.client-item[data-id="' + client.id + '"] .client-checkbox');
            if ($cb) {
                $cb.checked = true;
                $cb.closest(".client-item").classList.add("is-checked");
            }
            updateStats();
        }
        ymap.setCenter([client.lat, client.lon], 16, { duration: 400, checkZoomRange: true });
        const pm = state.markers.get(client.id);
        if (pm) pm.balloon.open();
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

    // ===== Кнопки =====
    $btnHideAll.addEventListener("click", () => {
        state.checked.clear();
        clearAllMarkers();
        renderList();
        updateStats();
    });

    $btnShowSelected.addEventListener("click", () => {
        if (state.checked.size === 0) {
            $btnShowSelected.style.background = "#ffcaca";
            setTimeout(() => $btnShowSelected.style.background = "", 200);
            return;
        }
        state.showOnlySelected = true;
        clearAllMarkers();
        state.checked.forEach(id => addMarker(id));
        renderList();
        $btnShowSelected.classList.add("hidden");
        $btnShowAllOnMap.classList.add("hidden");
        $btnHideAll.classList.add("hidden");
        $btnShowAllList.classList.remove("hidden");
        fitBoundsToMarkers();
    });

    $btnShowAllOnMap.addEventListener("click", () => {
        // Отмечаем всех клиентов и показываем на карте
        state.checked = new Set(DATA.map(c => c.id));
        clearAllMarkers();
        state.checked.forEach(id => addMarker(id));
        if (state.showOnlySelected) {
            // В режиме "только выбранные" — выходим из него, т.к. выбраны все
            state.showOnlySelected = false;
            $btnShowSelected.classList.remove("hidden");
            $btnShowAllOnMap.classList.remove("hidden");
            $btnHideAll.classList.remove("hidden");
            $btnShowAllList.classList.add("hidden");
        }
        renderList();
        fitBoundsToMarkers();
    });

    $btnShowAllList.addEventListener("click", () => {
        state.showOnlySelected = false;
        $btnShowAllList.classList.add("hidden");
        $btnShowSelected.classList.remove("hidden");
        $btnShowAllOnMap.classList.remove("hidden");
        $btnHideAll.classList.remove("hidden");
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

    // ===== Бургер на мобильных =====
    $sidebarToggle.addEventListener("click", () => {
        $sidebar.classList.toggle("open");
        $sidebarToggle.classList.toggle("open");
    });

    // ===== Старт =====
    renderList();
    updateStats();
    initMap();
})();
