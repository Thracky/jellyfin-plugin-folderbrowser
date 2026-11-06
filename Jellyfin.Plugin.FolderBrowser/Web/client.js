(function () {
    'use strict';

    if (window.__folderBrowser) {
        return;
    }
    window.__folderBrowser = true;

    // The view lives on the music library route as an extra hash parameter:
    //   #/music?topParentId=<library>&folder=<folder id>
    // so every folder level is a history entry and the back button walks up.
    var ROUTE = 'music';
    var PARAM = 'folder';
    var ROOT_CLASS = 'folderbrowser-root';
    var MENU_ITEM_CLASS = 'folderbrowser-menuitem';
    var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    var renderToken = 0;

    function api() {
        return window.ApiClient;
    }

    function currentRoute() {
        var match = /^#\/([^?]*)\??(.*)$/.exec(location.hash);
        if (!match) {
            return null;
        }
        return { path: match[1], params: new URLSearchParams(match[2]) };
    }

    function hashFor(params) {
        return '#/' + ROUTE + '?' + params.toString();
    }

    // sub: '/'-separated folder below the item's folder. Jellyfin models an album as one item whose tracks are
    // all direct children, even when they sit in "Disc 1/", "Bonus/" and so on, so those folders are rebuilt
    // from the track paths and addressed by item id + relative path.
    function folderHash(folderId, sub) {
        var route = currentRoute();
        var params = route ? route.params : new URLSearchParams();
        params.set(PARAM, folderId);
        if (sub) {
            params.set('sub', sub);
        } else {
            params.delete('sub');
        }
        return hashFor(params);
    }

    function openFolder(folderId, sub) {
        location.hash = folderHash(folderId, sub);
    }

    // Like openFolder, but replaces the current history entry (used when the shown folder no longer exists).
    function replaceFolder(folderId, sub) {
        location.replace(folderHash(folderId, sub));
    }

    function leaveFolders() {
        var route = currentRoute();
        if (!route) {
            return;
        }
        route.params.delete(PARAM);
        route.params.delete('sub');
        location.hash = hashFor(route.params);
    }

    function esc(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML.replace(/"/g, '&quot;');
    }

    function baseName(path) {
        var parts = String(path).split(/[\\/]/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : String(path);
    }

    function displayName(item) {
        if (!item.Path) {
            return item.Name || '';
        }
        var name = baseName(item.Path);
        if (!item.IsFolder) {
            var dot = name.lastIndexOf('.');
            if (dot > 0) {
                name = name.slice(0, dot);
            }
        }
        return name;
    }

    function formatDuration(ticks) {
        if (!ticks) {
            return '';
        }
        var seconds = Math.round(ticks / 10000000);
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
    }

    function toast(message) {
        var el = document.createElement('div');
        el.textContent = message;
        el.style.cssText = 'position:fixed;left:50%;bottom:6em;transform:translateX(-50%);background:#202020;color:#fff;' +
            'padding:.8em 1.4em;border-radius:.3em;z-index:100000;box-shadow:0 2px 8px rgba(0,0,0,.5);';
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 2500);
    }

    function errorText(err) {
        if (err && typeof err.text === 'function') {
            return err.text().then(function (t) {
                return t || (err.status ? 'HTTP ' + err.status : 'Request failed');
            }, function () {
                return 'Request failed';
            });
        }
        return Promise.resolve((err && err.message) || 'Request failed');
    }

    // ---------- styles ----------

    var style = document.createElement('style');
    // The library's own toolbar ("Albums ▾", Play All, …) is a row in the app header, not part of #musicPage.
    // While the folder view is active its React content is hidden and ours is shown in the same row.
    var NATIVE_TOOLBAR = 'header .MuiToolbar-root:has(> button[aria-controls="library-view-menu"])';
    style.textContent =
        'html[data-folderbrowser] #musicPage > :not(.' + ROOT_CLASS + ') { display: none !important; }' +
        'html[data-folderbrowser] ' + NATIVE_TOOLBAR + ' > :not(.folderbrowser-toolbar) { display: none !important; }' +
        'html:not([data-folderbrowser]) .folderbrowser-toolbar { display: none !important; }' +
        '.' + ROOT_CLASS + ' { padding-top: .5em; }' +
        '.folderbrowser-toolbar { display: flex; align-items: center; gap: .5em; flex: 1; min-width: 0; }' +
        '.folderbrowser-title { display: flex; align-items: center; gap: .1em; font-size: 1.6em; background: none; border: 0;' +
        ' color: inherit; cursor: pointer; padding: .1em .3em; border-radius: .2em; font-family: inherit; }' +
        '.folderbrowser-title:hover { background: rgba(128,128,128,.2); }' +
        '.folderbrowser-actions, .folderbrowser-selection { display: flex; align-items: center; gap: .3em; margin-left: auto; }' +
        '.folderbrowser-toolbar.has-selection .folderbrowser-actions { display: none; }' +
        '.folderbrowser-toolbar:not(.has-selection) .folderbrowser-selection { display: none; }' +
        '.folderbrowser-count { margin-right: .5em; opacity: .9; }' +
        '.folderbrowser-batch { display: flex; align-items: center; gap: .3em; background: none; border: 0; color: inherit;' +
        ' cursor: pointer; font-family: inherit; font-size: inherit; padding: .4em .7em; border-radius: .2em; }' +
        '.folderbrowser-batch:hover { background: rgba(128,128,128,.2); }' +
        '.folderbrowser-check { width: 1.2em; height: 1.2em; margin: 0 1em 0 .2em; flex-shrink: 0; cursor: pointer; }' +
        '.folderbrowser-check-spacer { width: 1.2em; margin: 0 1em 0 .2em; flex-shrink: 0; }' +
        '.folderbrowser-row.selected { background: rgba(128,128,128,.15); }' +
        '.folderbrowser-toolbar:not(.can-select) .folderbrowser-selectall-idle { display: none; }' +
        '.folderbrowser-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: .2em; margin: 0 0 .75em .3em; opacity: .9; }' +
        '.folderbrowser-crumbs a { color: inherit; cursor: pointer; text-decoration: none; }' +
        '.folderbrowser-crumbs a:hover { text-decoration: underline; }' +
        '.folderbrowser-crumbs .current { font-weight: 600; }' +
        // Rows outside the viewport are not laid out or painted; large folders only cost what is on screen.
        '.folderbrowser-row { cursor: pointer; content-visibility: auto; contain-intrinsic-size: auto 4.5em; }' +
        '.folderbrowser-thumb { width: 3em; height: 3em; flex-shrink: 0; object-fit: cover;' +
        ' border-radius: .2em; display: flex; align-items: center; justify-content: center; margin-right: 1em; }' +
        '.folderbrowser-thumb .material-icons { font-size: 2em; opacity: .7; }' +
        '.folderbrowser-index { width: 3em; text-align: center; opacity: .7; flex-shrink: 0; margin-right: 1em; }' +
        '.folderbrowser-empty { padding: 2em .5em; opacity: .7; }' +
        'html[data-folderbrowser] .' + MENU_ITEM_CLASS + ' { font-weight: 600; }';
    document.head.appendChild(style);

    // ---------- view-menu entry ----------

    // The library page's view dropdown ("Albums ▾") is an MUI menu rendered while open; add "Folders" to it.
    function addMenuEntry() {
        var route = currentRoute();
        if (!route || route.path !== ROUTE) {
            return;
        }
        var list = document.querySelector('#library-view-menu ul[role="menu"]');
        if (!list || list.querySelector('.' + MENU_ITEM_CLASS)) {
            return;
        }
        var template = list.querySelector('li[role="menuitem"]');
        if (!template) {
            return;
        }
        var item = document.createElement('li');
        item.className = template.className.replace(/\bMui-selected\b/g, '') + ' ' + MENU_ITEM_CLASS;
        item.setAttribute('role', 'menuitem');
        item.setAttribute('tabindex', '-1');
        item.textContent = 'Folders';
        item.addEventListener('click', function (e) {
            e.stopPropagation();
            closeMenu(list);
            var libraryId = currentRoute().params.get('topParentId');
            if (libraryId) {
                openFolder(libraryId);
            }
        });
        list.appendChild(item);
    }

    function closeMenu(list) {
        var popover = list.closest('.MuiPopover-root');
        var backdrop = popover && popover.querySelector('.MuiBackdrop-root');
        if (backdrop) {
            backdrop.click();
        }
    }

    // Leaving the folder view through the title: show the library's normal views and open their menu.
    function openNativeMenu() {
        leaveFolders();
        var attempts = 0;
        var timer = setInterval(function () {
            var button = document.querySelector('button[aria-controls="library-view-menu"]');
            var ready = button && !document.documentElement.hasAttribute('data-folderbrowser');
            if (ready || ++attempts > 40) {
                clearInterval(timer);
                if (ready) {
                    button.click();
                }
            }
        }, 50);
    }

    // ---------- folder view ----------

    function sync() {
        addMenuEntry();

        var route = currentRoute();
        var folderId = route && route.path === ROUTE ? route.params.get(PARAM) : null;
        var libraryId = route ? route.params.get('topParentId') : null;
        var sub = (route && route.params.get('sub')) || '';
        var page = document.getElementById('musicPage');

        if (!folderId || !libraryId || !api()) {
            document.documentElement.removeAttribute('data-folderbrowser');
            document.querySelectorAll('.' + ROOT_CLASS + ', .folderbrowser-toolbar').forEach(function (el) { el.remove(); });
            return;
        }
        if (ensureToolbar()) {
            updateToolbarState();
        }
        if (!page) {
            return;
        }

        document.documentElement.setAttribute('data-folderbrowser', '');
        var root = page.querySelector(':scope > .' + ROOT_CLASS);
        if (!root) {
            root = document.createElement('div');
            root.className = ROOT_CLASS + ' padded-left padded-right padded-bottom-page';
            root.addEventListener('click', onRootClick);
            page.appendChild(root);
        }
        var key = folderId + '|' + sub;
        if (root.getAttribute('data-key') !== key) {
            root.setAttribute('data-key', key);
            root.setAttribute('data-folder', folderId);
            root.setAttribute('data-sub', sub);
            root.setAttribute('data-library', libraryId);
            selection = {};
            lastChecked = null;
            render(root, folderId, libraryId, sub, false);
        }
    }

    // Returns true when the toolbar was (re)created, e.g. after React re-rendered the header.
    function ensureToolbar() {
        var host = document.querySelector(NATIVE_TOOLBAR);
        if (!host || host.querySelector(':scope > .folderbrowser-toolbar')) {
            return false;
        }
        var toolbar = document.createElement('div');
        toolbar.className = 'folderbrowser-toolbar';
        toolbar.innerHTML = toolbarHtml();
        toolbar.addEventListener('click', onToolbarClick);
        host.appendChild(toolbar);
        return true;
    }

    function onToolbarClick(e) {
        var button = e.target.closest('[data-action]');
        var route = currentRoute();
        var folderId = route && route.params.get(PARAM);
        var sub = (route && route.params.get('sub')) || '';
        if (!button || !folderId) {
            return;
        }
        var action = button.getAttribute('data-action');
        if (action === 'views') {
            openNativeMenu();
        } else if (action === 'play') {
            play(folderId, { mode: 'PlayNow', subPath: sub });
        } else if (action === 'shuffle') {
            play(folderId, { mode: 'PlayNow', shuffle: true, subPath: sub });
        } else if (action === 'queue') {
            play(folderId, { mode: 'PlayLast', subPath: sub }, 'Added to queue');
        } else if (action === 'batch') {
            sortFolders(button, selectedIds());
        } else if (action === 'selectall') {
            document.querySelectorAll('.' + ROOT_CLASS + ' .folderbrowser-row[data-selectable]').forEach(function (row) {
                selection[row.getAttribute('data-id')] = true;
            });
            updateSelectionUi();
        } else if (action === 'clear') {
            selection = {};
            lastChecked = null;
            updateSelectionUi();
        }
    }

    // ---------- selection (needs Folder Sorter) ----------

    var selection = {}; // album id -> true, for the folder currently shown
    var lastChecked = null; // id of the last row ticked, for shift-click ranges
    var selectableCount = 0; // album rows with a checkbox in the current list

    function selectedIds() {
        return Object.keys(selection);
    }

    // Brings the rows in line with `selection`. Called only after a render or a selection change: it walks
    // every row, so it must never run on a timer or from the DOM observer.
    function updateSelectionUi() {
        var rows = document.querySelectorAll('.' + ROOT_CLASS + ' .folderbrowser-row[data-selectable]');
        var present = {};
        rows.forEach(function (row) {
            var id = row.getAttribute('data-id');
            present[id] = true;
            var checked = selection[id] === true;
            if (row.classList.contains('selected') !== checked) {
                row.classList.toggle('selected', checked);
            }
            var box = row.querySelector('.folderbrowser-check');
            if (box && box.checked !== checked) {
                box.checked = checked;
            }
        });
        // Drop selections whose rows are gone (moved, deleted, or no longer listed).
        Object.keys(selection).forEach(function (id) {
            if (!present[id]) {
                delete selection[id];
            }
        });
        selectableCount = rows.length;
        updateToolbarState();
    }

    function updateToolbarState() {
        var toolbar = document.querySelector('.folderbrowser-toolbar');
        if (!toolbar) {
            return;
        }
        var count = selectedIds().length;
        if (toolbar.classList.contains('has-selection') !== count > 0) {
            toolbar.classList.toggle('has-selection', count > 0);
        }
        if (toolbar.classList.contains('can-select') !== selectableCount > 0) {
            toolbar.classList.toggle('can-select', selectableCount > 0);
        }
        var label = toolbar.querySelector('.folderbrowser-count');
        var text = count + ' selected';
        if (label.textContent !== text) {
            label.textContent = text;
        }
    }

    function toggleSelection(row, checked, range) {
        var id = row.getAttribute('data-id');
        if (range && lastChecked) {
            var rows = Array.prototype.slice.call(document.querySelectorAll('.' + ROOT_CLASS + ' .folderbrowser-row[data-selectable]'));
            var ids = rows.map(function (r) { return r.getAttribute('data-id'); });
            var from = ids.indexOf(lastChecked);
            var to = ids.indexOf(id);
            if (from >= 0 && to >= 0) {
                ids.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(function (rangeId) {
                    if (checked) {
                        selection[rangeId] = true;
                    } else {
                        delete selection[rangeId];
                    }
                });
            }
        } else if (checked) {
            selection[id] = true;
        } else {
            delete selection[id];
        }
        lastChecked = id;
        updateSelectionUi();
    }

    function sortFolders(anchor, ids) {
        var sorter = folderSorter();
        if (!sorter || !ids.length) {
            return;
        }
        sorter.showMenu(anchor, ids.length === 1 ? ids[0] : ids).then(function (result) {
            if (!result) {
                return;
            }
            // Folder Sorter 2 reports which ids were handled; anything else counts as "something changed".
            if (result.succeeded) {
                result.succeeded.forEach(function (id) { delete selection[id]; });
            }
            refresh();
        });
    }

    function loadAncestors(folderId, libraryId) {
        if (folderId === libraryId) {
            return Promise.resolve([]);
        }
        var url = api().getUrl('Items/' + folderId + '/Ancestors', { userId: api().getCurrentUserId() });
        return api().getJSON(url).then(function (ancestors) {
            // Ancestors run from the parent upwards; keep the part below the library and put it in order.
            var chain = [];
            for (var i = 0; i < ancestors.length && ancestors[i].Id !== libraryId; i++) {
                chain.unshift(ancestors[i]);
            }
            return chain;
        });
    }

    function loadChildren(folderId) {
        return api().getItems(api().getCurrentUserId(), {
            ParentId: folderId,
            Fields: 'Path,CanDelete',
            EnableImageTypes: 'Primary',
            ImageTypeLimit: 1,
            EnableUserData: false,
            EnableTotalRecordCount: false
        }).then(function (result) {
            return (result.Items || []).filter(function (i) {
                return i.IsFolder || i.MediaType === 'Audio';
            });
        });
    }

    function segments(path) {
        return String(path).split(/[\\/]/).filter(Boolean);
    }

    // Splits the children into what sits directly in `base` and the on-disk subfolders below it.
    function entriesBelow(items, base) {
        var baseSegments = segments(base);
        var direct = [];
        var subfolders = {};
        items.forEach(function (item) {
            if (!item.Path) {
                direct.push(item);
                return;
            }
            var parts = segments(item.Path);
            for (var i = 0; i < baseSegments.length; i++) {
                if (parts[i] !== baseSegments[i]) {
                    return;
                }
            }
            var rest = parts.slice(baseSegments.length);
            if (rest.length === 1) {
                direct.push(item);
            } else if (rest.length > 1) {
                var name = rest[0];
                subfolders[name] = (subfolders[name] || 0) + (item.IsFolder ? 0 : 1);
            }
        });
        return {
            direct: direct,
            subfolders: Object.keys(subfolders).map(function (name) {
                return { name: name, trackCount: subfolders[name] };
            })
        };
    }

    // refresh: redraw the folder in place (keeps the current rows on screen until the new ones are ready, so
    // the scroll position stays where it was) and go up a level if the folder itself is gone.
    function render(root, folderId, libraryId, sub, refresh) {
        var token = ++renderToken;
        if (!refresh) {
            root.innerHTML = '<div class="folderbrowser-crumbs"></div>' +
                '<div class="folderbrowser-list"><div class="folderbrowser-empty">Loading…</div></div>';
        }

        var uid = api().getCurrentUserId();
        Promise.all([
            api().getItem(uid, libraryId),
            folderId === libraryId ? null : api().getItem(uid, folderId),
            loadAncestors(folderId, libraryId),
            loadChildren(folderId)
        ]).then(function (r) {
            if (token !== renderToken || !root.isConnected) {
                return;
            }
            var library = r[0];
            var folder = r[1];
            var subParts = segments(sub);

            var crumbs = [{ id: library.Id, label: library.Name }]
                .concat(r[2].map(function (a) { return { id: a.Id, label: displayName(a) }; }));
            if (folder) {
                crumbs.push({ id: folder.Id, label: displayName(folder) });
            }
            subParts.forEach(function (part, i) {
                crumbs.push({ id: folderId, sub: subParts.slice(0, i + 1).join('/'), label: part });
            });
            root.querySelector('.folderbrowser-crumbs').innerHTML = crumbs.map(function (c, i) {
                return i === crumbs.length - 1
                    ? '<span class="current">' + esc(c.label) + '</span>'
                    : '<a data-crumb="' + esc(c.id) + '" data-crumb-sub="' + esc(c.sub || '') + '">' + esc(c.label) +
                        '</a><span class="material-icons chevron_right" aria-hidden="true"></span>';
            }).join('');

            // The library root has no single folder on disk (it can span several media folders).
            var base = folder && folder.Path ? segments(folder.Path).concat(subParts).join('/') : null;
            var entries = base === null ? { direct: r[3], subfolders: [] } : entriesBelow(r[3], base);

            // Same order the server uses for playback: tracks first, then folders; numbers in numeric order.
            var tracks = entries.direct.filter(function (i) { return !i.IsFolder; });
            var folders = entries.direct.filter(function (i) { return i.IsFolder; })
                .map(function (i) { return { item: i, name: displayName(i) }; })
                .concat(entries.subfolders.map(function (s) { return { sub: s, name: s.name }; }));
            tracks.sort(function (a, b) { return collator.compare(displayName(a), displayName(b)); });
            folders.sort(function (a, b) { return collator.compare(a.name, b.name); });

            var selectable = !!folderSorter() && folders.some(function (f) { return f.item && isSortable(f.item); });
            var html = tracks.map(trackRowHtml).join('') + folders.map(function (f) {
                return f.item
                    ? folderRowHtml(f.item, selectable)
                    : subfolderRowHtml(f.sub, subParts.concat(f.sub.name).join('/'), selectable);
            }).join('');
            root.querySelector('.folderbrowser-list').innerHTML = html || '<div class="folderbrowser-empty">This folder is empty.</div>';
            updateSelectionUi();
        }).catch(function (err) {
            if (token !== renderToken) {
                return;
            }
            if (refresh && err && err.status === 404) {
                // The folder was emptied and removed by the last move/delete: show its parent instead.
                var crumbsLinks = root.querySelectorAll('.folderbrowser-crumbs a[data-crumb]');
                var parent = crumbsLinks[crumbsLinks.length - 1];
                if (parent) {
                    replaceFolder(parent.getAttribute('data-crumb'), parent.getAttribute('data-crumb-sub'));
                    return;
                }
            }
            errorText(err).then(function (text) {
                root.querySelector('.folderbrowser-list').innerHTML =
                    '<div class="folderbrowser-empty">Could not load this folder: ' + esc(text) + '</div>';
            });
        });
    }

    function refresh() {
        var root = document.querySelector('.' + ROOT_CLASS);
        if (root && root.getAttribute('data-key')) {
            render(root, root.getAttribute('data-folder'), root.getAttribute('data-library'), root.getAttribute('data-sub') || '', true);
        }
    }

    function toolbarHtml() {
        return '<button type="button" class="folderbrowser-title" data-action="views" title="Library views">' +
            '<span>Folders</span><span class="material-icons arrow_drop_down" aria-hidden="true"></span></button>' +
            '<div class="folderbrowser-actions">' +
            iconButton('play', 'play_arrow', 'Play all') +
            iconButton('shuffle', 'shuffle', 'Shuffle') +
            iconButton('queue', 'playlist_add', 'Add to queue') +
            '<span class="folderbrowser-selectall-idle">' + iconButton('selectall', 'select_all', 'Select all') + '</span>' +
            '</div>' +
            '<div class="folderbrowser-selection">' +
            '<span class="folderbrowser-count"></span>' +
            '<button type="button" class="folderbrowser-batch" data-action="batch" title="Move or delete the selected folders">' +
            '<span class="material-icons drive_file_move" aria-hidden="true"></span><span>Move or delete…</span></button>' +
            iconButton('selectall', 'select_all', 'Select all') +
            iconButton('clear', 'close', 'Clear selection') +
            '</div>';
    }

    function iconButton(action, icon, title) {
        return '<button is="paper-icon-button-light" type="button" class="paper-icon-button-light" data-action="' + action +
            '" title="' + esc(title) + '"><span class="material-icons ' + icon + '" aria-hidden="true"></span></button>';
    }

    function rowHtml(attributes, lead, name, secondary, buttons) {
        return '<div class="listItem listItem-border folderbrowser-row" ' + attributes + '>' + lead +
            '<div class="listItemBody"><div class="listItemBodyText">' + esc(name) + '</div>' +
            (secondary ? '<div class="listItemBodyText secondary">' + esc(secondary) + '</div>' : '') +
            '</div>' + buttons + '</div>';
    }

    var FOLDER_ICON = '<div class="folderbrowser-thumb"><span class="material-icons folder" aria-hidden="true"></span></div>';

    function isSortable(item) {
        return item.Type === 'MusicAlbum' && item.CanDelete === true;
    }

    // selectable: the list has a checkbox column; rows that can't be selected get a spacer to stay aligned.
    function folderRowHtml(item, selectable) {
        var tag = item.ImageTags && item.ImageTags.Primary;
        var sortable = selectable && isSortable(item);
        var lead = (selectable
            ? (sortable
                ? '<input type="checkbox" class="folderbrowser-check" data-action="select" aria-label="Select ' + esc(displayName(item)) + '">'
                : '<span class="folderbrowser-check-spacer"></span>')
            : '') +
            (tag
                ? '<img class="folderbrowser-thumb" loading="lazy" decoding="async" alt="" src="' +
                    esc(api().getScaledImageUrl(item.Id, { type: 'Primary', maxHeight: 120, tag: tag })) + '">'
                : FOLDER_ICON);
        var secondary = item.Type === 'MusicAlbum'
            ? [item.AlbumArtist, item.ProductionYear].filter(Boolean).join(' · ')
            : '';
        var buttons = iconButton('play', 'play_arrow', 'Play') +
            iconButton('queue', 'playlist_add', 'Add to queue') +
            (item.Type === 'MusicAlbum' ? iconButton('album', 'album', 'Open album page') : '') +
            (sortable ? iconButton('sort', 'drive_file_move', 'Move or delete folder (Folder Sorter)') : '');
        return rowHtml('data-kind="folder" data-id="' + esc(item.Id) + '"' + (sortable ? ' data-selectable' : ''),
            lead, displayName(item), secondary, buttons);
    }

    function subfolderRowHtml(sub, subPath, selectable) {
        var count = sub.trackCount === 1 ? '1 track' : sub.trackCount + ' tracks';
        var buttons = iconButton('play', 'play_arrow', 'Play') + iconButton('queue', 'playlist_add', 'Add to queue');
        var lead = (selectable ? '<span class="folderbrowser-check-spacer"></span>' : '') + FOLDER_ICON;
        return rowHtml('data-kind="sub" data-sub="' + esc(subPath) + '"', lead, sub.name, count, buttons);
    }

    function trackRowHtml(item) {
        var lead = '<div class="folderbrowser-index">' + esc(item.IndexNumber || '') + '</div>';
        var secondary = [(item.Artists || []).join(', '), formatDuration(item.RunTimeTicks)].filter(Boolean).join(' · ');
        var buttons = iconButton('play', 'play_arrow', 'Play from here') + iconButton('queue', 'playlist_add', 'Add to queue');
        return rowHtml('data-kind="track" data-id="' + esc(item.Id) + '"', lead, displayName(item), secondary, buttons);
    }

    function onRootClick(e) {
        var root = e.currentTarget;
        var folderId = root.getAttribute('data-folder');
        var sub = root.getAttribute('data-sub') || '';

        var crumb = e.target.closest('[data-crumb]');
        if (crumb) {
            openFolder(crumb.getAttribute('data-crumb'), crumb.getAttribute('data-crumb-sub'));
            return;
        }

        var row = e.target.closest('.folderbrowser-row');
        if (!row) {
            return;
        }
        var button = e.target.closest('[data-action]');
        var action = button ? button.getAttribute('data-action') : 'open';
        var kind = row.getAttribute('data-kind');
        var id = row.getAttribute('data-id');

        if (action === 'select') {
            toggleSelection(row, button.checked, e.shiftKey);
            return;
        }

        if (kind === 'folder') {
            if (action === 'sort') {
                sortFolders(button, [id]);
            } else if (action === 'album') {
                location.hash = '#/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(api().serverId());
            } else if (action === 'play') {
                play(id, { mode: 'PlayNow' });
            } else if (action === 'queue') {
                play(id, { mode: 'PlayLast' }, 'Added to queue');
            } else {
                openFolder(id);
            }
        } else if (kind === 'sub') {
            var subPath = row.getAttribute('data-sub');
            if (action === 'play') {
                play(folderId, { mode: 'PlayNow', subPath: subPath });
            } else if (action === 'queue') {
                play(folderId, { mode: 'PlayLast', subPath: subPath }, 'Added to queue');
            } else {
                openFolder(folderId, subPath);
            }
        } else if (action === 'queue') {
            queueTrack(id);
        } else {
            play(folderId, { mode: 'PlayNow', subPath: sub, startItemId: id });
        }
    }

    function play(folderId, options, successMessage) {
        var query = { mode: options.mode };
        if (options.shuffle) {
            query.shuffle = true;
        }
        if (options.startItemId) {
            query.startItemId = options.startItemId;
        }
        if (options.subPath) {
            query.subPath = options.subPath;
        }
        api().ajax({
            type: 'POST',
            url: api().getUrl('FolderBrowser/Folders/' + folderId + '/Play', query)
        }).then(function () {
            if (successMessage) {
                toast(successMessage);
            }
        }, function (err) {
            errorText(err).then(function (text) { window.alert(text); });
        });
    }

    function queueTrack(trackId) {
        api().getSessions({ DeviceId: api().deviceId() }).then(function (sessions) {
            var session = sessions && sessions[0];
            if (!session) {
                throw new Error('No active session for this device.');
            }
            return api().ajax({
                type: 'POST',
                url: api().getUrl('Sessions/' + session.Id + '/Playing', { playCommand: 'PlayLast', itemIds: trackId })
            });
        }).then(function () {
            toast('Added to queue');
        }, function (err) {
            errorText(err).then(function (text) { window.alert(text); });
        });
    }

    var scheduled = false;
    function scheduleSync() {
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(function () {
                scheduled = false;
                sync();
            });
        }
    }

    // Folder Sorter is optional: its script publishes window.FolderSorter. Without it the button is not shown.
    function folderSorter() {
        var sorter = window.FolderSorter;
        return sorter && typeof sorter.showMenu === 'function' ? sorter : null;
    }

    // Folder Sorter's script may load after a folder was already drawn.
    document.addEventListener('foldersorter:ready', refresh);
    window.addEventListener('hashchange', scheduleSync);
    window.addEventListener('popstate', scheduleSync);
    // Watch the page for route/React changes, but ignore changes inside our own elements: reacting to those
    // would schedule another sync for every update we make ourselves.
    var OWN = '.' + ROOT_CLASS + ', .folderbrowser-toolbar';
    new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
            var target = records[i].target;
            var el = target.nodeType === 1 ? target : target.parentElement;
            if (!el || !el.closest(OWN)) {
                scheduleSync();
                return;
            }
        }
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
    sync();
})();
