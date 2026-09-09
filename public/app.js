(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const state = {
    current: null,
    view: 'home',
    all: [],
    folders: [],
    selected: null,
    mode: localStorage.getItem('saadView') || 'list',
    pending: null,
  };
  let refreshTokenPromise = null;

  const bn = '০১২৩৪৫৬৭৮৯';
  const ar = '٠١٢٣٤٥٦٧٨٩';

  function norm(value) {
    return String(value || '')
      .split('')
      .map(char => {
        const banglaIndex = bn.indexOf(char);
        const arabicIndex = ar.indexOf(char);
        return banglaIndex > -1 ? banglaIndex : arabicIndex > -1 ? arabicIndex : char;
      })
      .join('')
      .replace(/[^0-9]/g, '');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getToken() {
    return sessionStorage.getItem('token') || '';
  }

  function setToken(token) {
    if (token) sessionStorage.setItem('token', token);
    else sessionStorage.removeItem('token');
  }

  function isMobileViewport() {
    return window.matchMedia('(max-width: 700px)').matches;
  }

  function requireLogin(message = 'Session expired. Please login again.') {
    setToken('');
    $('#app').classList.add('hide');
    $('#lock').classList.remove('hide');
    $('#unlock').disabled = false;
    $('#unlock').textContent = 'Unlock workspace →';
    $('#error').textContent = message;
    $('#pin').focus();
  }

  async function refreshSessionToken() {
    if (refreshTokenPromise) return refreshTokenPromise;
    const currentToken = getToken();
    if (!currentToken) throw new Error('No session token');

    refreshTokenPromise = (async () => {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + currentToken },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.token) {
        throw new Error(payload.error || 'Session refresh failed');
      }
      setToken(payload.token);
      return payload.token;
    })();

    try {
      return await refreshTokenPromise;
    } finally {
      refreshTokenPromise = null;
    }
  }

  async function api(path, options = {}) {
    const { _retry = false, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers || {});
    const token = getToken();

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }

    const response = await fetch(path, { ...fetchOptions, headers });
    let payload = {};

    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      if (response.status === 401 && token && !_retry) {
        try {
          await refreshSessionToken();
          return api(path, { ...options, _retry: true });
        } catch (error) {
          requireLogin(error.message || 'Session expired. Please login again.');
          throw error;
        }
      }
      const source = payload.source ? `${payload.source}: ` : '';
      const detail = payload.detail ? ` ${payload.detail}` : '';
      throw new Error(`${source}${payload.error || 'Request failed'}${detail}`.trim());
    }

    return payload;
  }

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.remove('hide');
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.add('hide'), 3000);
  }

  function human(bytes) {
    const value = Number(bytes || 0);
    if (!value) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function iconForItem(item) {
    if (item.kind === 'folder') return 'folder';
    const name = String(item.name || '').toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif|svg)$/.test(name)) return 'image';
    if (/\.(mp4|mkv|mov|avi|webm)$/.test(name)) return 'movie';
    if (/\.(mp3|wav|ogg|m4a|flac)$/.test(name)) return 'music_note';
    if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'folder_zip';
    if (/\.(pdf)$/.test(name)) return 'picture_as_pdf';
    return 'description';
  }

  function size(folderId) {
    return state.all
      .filter(item => item.kind === 'file' && item.parent_id === folderId)
      .reduce((total, item) => total + Number(item.size_bytes || 0), 0);
  }

  function isFileView() {
    return state.view !== 'settings' && state.view !== 'security';
  }

  function updateDropVisibility() {
    $('#drop').classList.toggle('hide', !isFileView());
  }

  function updateSelectionVisibility() {
    $('#selection').classList.toggle('hide', !state.selected);
    if (state.selected) {
      const selectedItem = state.all.find(item => item.id === state.selected);
      $('#selectedName').textContent = selectedItem ? selectedItem.name : '';
      $('#downloadSelected').classList.toggle('hide', selectedItem?.kind === 'folder');
    }
  }

  function folderPath(folderId) {
    const map = new Map(state.all.map(item => [item.id, item]));
    const parts = [];
    let cursor = map.get(folderId);
    while (cursor) {
      parts.unshift(cursor.name);
      cursor = cursor.parent_id ? map.get(cursor.parent_id) : null;
    }
    return parts.length ? `Home / ${parts.join(' / ')}` : 'Home';
  }

  function setTableMode() {
    $('#table').classList.toggle('grid', state.mode === 'grid');
    $('#view').textContent = state.mode === 'grid' ? 'Grid' : 'List';
    $('#list').classList.toggle('active', state.mode === 'list');
    $('#grid').classList.toggle('active', state.mode === 'grid');
    $('#list').setAttribute('aria-pressed', String(state.mode === 'list'));
    $('#grid').setAttribute('aria-pressed', String(state.mode === 'grid'));
  }

  function updateStats() {
    const files = state.all.filter(item => item.kind === 'file');
    const folders = state.all.filter(item => item.kind === 'folder');
    const used = files.reduce((total, item) => total + Number(item.size_bytes || 0), 0);

    $('#filesCount').textContent = files.length;
    $('#foldersCount').textContent = folders.length;
    $('#used').textContent = human(used);
    $('#storage').textContent = `${human(used)} used · telegram-backed`;
    $('#bar').style.width = files.length ? '6%' : '0%';
    
  }

  function getVisibleItems() {
    const query = $('#search').value.trim().toLowerCase();
    let list = state.view === 'recent'
      ? state.all.filter(item => item.kind === 'file')
      : state.all.filter(item => item.parent_id === state.current);

    if (query) {
      list = list.filter(item => item.name.toLowerCase().includes(query));
    }

    const sort = $('#sort').value;
    list.sort((a, b) => {
      if (state.view === 'recent' && sort === 'date') {
        return new Date(b.created_at) - new Date(a.created_at);
      }
      if (sort === 'date') {
        return new Date(b.created_at) - new Date(a.created_at);
      }
      if (sort === 'size') {
        return Number(b.size_bytes || size(b.id)) - Number(a.size_bytes || size(a.id));
      }
      return a.name.localeCompare(b.name);
    });

    return list;
  }

  function render() {
    setTableMode();
    updateDropVisibility();
    updateSelectionVisibility();

    const list = getVisibleItems();
    const table = $('#table');

    if (!list.length) {
      table.innerHTML = `
        <div class="state">
          <span class="material-symbols-rounded state-icon">folder_open</span>
          <b>Nothing here yet</b>
          <small>No matching files or folders.</small>
        </div>
      `;
    } else {
      table.innerHTML = list.map(item => {
        const itemSize = item.kind === 'folder' ? size(item.id) : item.size_bytes;
        const icon = iconForItem(item);
        const selectedClass = state.selected === item.id ? 'selected' : '';

        return `
          <div class="row ${selectedClass}" data-id="${item.id}" data-kind="${item.kind}" aria-selected="${state.selected === item.id ? 'true' : 'false'}">
            <div class="item">
              <div class="fileicon ${item.kind === 'folder' ? 'folder' : 'file'}"><span class="material-symbols-rounded">${icon}</span></div>
              <div>
                <b>${escapeHtml(item.name)}</b>
                <small>${item.kind} · ${human(itemSize)} · ${new Date(item.created_at).toLocaleString()}</small>
              </div>
            </div>
            <div class="row-actions">
              <button data-more="${item.id}" aria-label="More actions"><span class="material-symbols-rounded">more_vert</span></button>
              <button data-info="${item.id}" aria-label="Item details"><span class="material-symbols-rounded">info</span></button>
            </div>
          </div>
        `;
      }).join('');
    }

    document.querySelectorAll('.row').forEach(row => {
      row.onclick = event => {
        if (event.target.closest('button')) return;
        if (row.dataset.kind === 'folder' && isMobileViewport()) {
          openFolder(row.dataset.id);
          return;
        }
        state.selected = row.dataset.id;
        updateSelectionVisibility();
        render();
      };

      row.ondblclick = () => {
        if (row.dataset.kind === 'folder') openFolder(row.dataset.id);
      };
    });

    document.querySelectorAll('[data-info]').forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        const item = state.all.find(entry => entry.id === button.dataset.info);
        if (!item) return;
        toast(`${item.name} | ${human(item.size_bytes || size(item.id))} | ${new Date(item.created_at).toLocaleString()}`);
      };
    });

    document.querySelectorAll('[data-more]').forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        openMenu(button.dataset.more, button);
      };
    });

    const currentFolder = state.folders.find(folder => folder.id === state.current);
    $('#crumb').textContent = currentFolder ? currentFolder.name : 'Home';
    $('#listTitle').textContent = state.view === 'recent' ? 'Recent files' : currentFolder ? 'Folder contents' : 'My files';
    $('#crumbs').innerHTML = currentFolder ? '<button id="back" class="tool"><span class="material-symbols-rounded">arrow_back</span>Back</button>' : '';

    const backButton = $('#back');
    if (backButton) {
      backButton.onclick = () => {
        state.current = null;
        refresh();
      };
    }
  }

  async function refresh() {
    if (!isFileView()) {
      updateDropVisibility();
      return;
    }

    if (!state.all.length) {
      $('#table').innerHTML = '<div class="state loading"><span class="material-symbols-rounded state-icon">autorenew</span><b>Loading files…</b></div>';
    }

    try {
      const data = await api('/api/items?all=1');
      state.all = data.items || [];
      state.folders = state.all.filter(item => item.kind === 'folder');
      updateStats();
      render();
    } catch (error) {
      $('#table').innerHTML = `<div class="state"><span class="material-symbols-rounded state-icon">error</span><b>Could not load files</b><small>${escapeHtml(error.message)}</small></div>`;
    }
  }

  function openFolder(id) {
    $('#table').innerHTML = '<div class="state loading"><span class="material-symbols-rounded state-icon">autorenew</span><b>Opening folder…</b></div>';
    setTimeout(() => {
      state.current = id;
      state.selected = null;
      updateSelectionVisibility();
      refresh();
    }, 180);
  }

  function openMenu(id, anchor) {
    const entry = state.all.find(item => item.id === id);
    const isFolder = entry?.kind === 'folder';
    const menu = $('#menuBox');
    const rect = anchor.getBoundingClientRect();
    menu.innerHTML = [
      !isFolder ? '<button data-a="download"><span class="material-symbols-rounded">download</span>Download</button>' : '',
      '<button data-a="rename"><span class="material-symbols-rounded">drive_file_rename_outline</span>Rename</button>',
      '<button data-a="move"><span class="material-symbols-rounded">drive_file_move</span>Move</button>',
      '<button data-a="copy"><span class="material-symbols-rounded">content_copy</span>Copy</button>',
      '<button data-a="delete"><span class="material-symbols-rounded">delete</span>Delete</button>',
      '<button data-a="folder"><span class="material-symbols-rounded">create_new_folder</span>New Folder</button>',
    ].join('');
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.left = `${Math.max(8, rect.right - 175)}px`;
    menu.classList.remove('hide');

    menu.querySelectorAll('button').forEach(button => {
      button.onclick = async () => {
        menu.classList.add('hide');
        const action = button.dataset.a;
        if (action === 'download') return download(id);
        if (action === 'rename') return rename(id);
        if (action === 'delete') return removeItem(id);
        if (action === 'folder') return newFolder();
        return moveCopy(id, action);
      };
    });
  }

  async function download(id) {
    try {
      const response = await fetch(`/api/download?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: 'Bearer ' + getToken() },
      });

      if (!response.ok) {
        let payload = {};
        try { payload = await response.json(); } catch {}
        throw new Error(payload.error || 'Download failed');
      }

      const file = state.all.find(item => item.id === id);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file?.name || 'download';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast(error.message);
    }
  }

  function rename(id) {
    const item = state.all.find(entry => entry.id === id);
    if (!item) return;
    openDialog('Rename item', item.name, 'rename', id, 'Save');
  }

  function newFolder() {
    openDialog('New Folder', '', 'folder', null, 'Create');
  }

  async function moveCopy(id, type) {
    const item = state.all.find(entry => entry.id === id);
    if (!item) return;
    const destinations = state.folders.filter(folder => folder.id !== id);
    const choices = destinations
      .map((folder, index) => `${index + 1}. ${folderPath(folder.id)}`);
    const answer = prompt(
      `${type === 'copy' ? 'Copy' : 'Move'} "${item.name}" to:\n0. Home\n${choices.join('\n')}\n\nEnter destination number`
    );
    if (answer === null) return;

    const index = Number.parseInt(String(answer).trim(), 10);
    if (Number.isNaN(index) || index < 0 || index > choices.length) {
      toast('Invalid destination');
      return;
    }

    const selectedFolder = index === 0 ? null : destinations[index - 1];
    const body = { id, parent_id: selectedFolder ? selectedFolder.id : null };

    if (type === 'copy') body.action = 'copy';

    try {
      await api('/api/items', {
        method: type === 'copy' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast(type === 'copy' ? 'Copied' : 'Moved');
      refresh();
    } catch (error) {
      toast(error.message);
    }
  }

  function openDialog(title, value, kind, id, submitLabel) {
    state.pending = { kind, id };
    $('#dialogTitle').textContent = title;
    $('#dialogInput').value = value;
    $('#dialogSubmit').textContent = submitLabel;
    $('#dialogWrap').classList.remove('hide');
    $('#dialogInput').focus();
  }

  async function removeItem(id) {
    if (!confirm('Delete this item permanently?')) return;

    try {
      await api(`/api/items?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Deleted');
      state.selected = null;
      updateSelectionVisibility();
      refresh();
    } catch (error) {
      toast(error.message);
    }
  }

  function updateNavState() {
    document.querySelectorAll('.nav button').forEach(button => {
      button.classList.toggle('active', button.dataset.view === state.view);
    });
  }

  function setView(view) {
    state.view = view;
    state.current = null;
    state.selected = null;
    $('#side').classList.remove('open');
    updateSelectionVisibility();
    updateNavState();
    $('#title').textContent = view === 'recent' ? 'Recent files' : view[0].toUpperCase() + view.slice(1);
    $('#subtitle').textContent = view === 'security'
      ? 'Security settings and protection details.'
      : view === 'settings'
        ? 'Customize your Saad Drive workspace.'
        : 'Your folders and files, all in one place.';

    if (view === 'settings') {
      openSettings();
      return;
    }

    if (view === 'security') {
      openSecurity();
      return;
    }

    refresh();
  }

  function openSettings() {
    $('#table').classList.remove('grid');
    $('#table').innerHTML = `
      <div class="panel">
        <h3>Settings</h3>
        <p>Appearance</p>
        <button id="theme" class="tool">☀ / ☾ Light and dark mode</button>
        <p>Default view</p>
        <select id="defaultView" class="tool">
          <option value="list">List view</option>
          <option value="grid">Grid view</option>
        </select>
      </div>
    `;
    updateDropVisibility();

    $('#theme').onclick = () => {
      const isDark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = isDark ? 'dark' : '';
      localStorage.setItem('saadTheme', isDark ? 'dark' : 'light');
    };

    $('#defaultView').value = state.mode;
    $('#defaultView').onchange = event => {
      state.mode = event.target.value;
      localStorage.setItem('saadView', state.mode);
      toast('Saved');
    };
  }

  function openSecurity() {
    $('#table').classList.remove('grid');
    $('#table').innerHTML = `
      <div class="panel">
        <h3>Security</h3>
        <p>PIN is server-side SHA-256 protected.</p>
        <p>Sessions use JWT and Telegram credentials stay server-only.</p>
      </div>
    `;
    updateDropVisibility();
  }

  function uploadSingle(file, index, total) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      if (state.current) form.append('parent_id', state.current);

      const request = new XMLHttpRequest();
      request.open('POST', '/api/upload');
      request.setRequestHeader('Authorization', 'Bearer ' + getToken());

      request.upload.onprogress = event => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        $('#uploadText').textContent = total > 1
          ? `Uploading ${index + 1}/${total} · ${percent}%`
          : `Uploading ${percent}%`;
        $('#uploadBar').style.width = `${percent}%`;
      };

      request.onload = () => {
        let payload = {};
        try { payload = JSON.parse(request.responseText); } catch {}

        if (request.status >= 200 && request.status < 300) {
          resolve(payload);
        } else {
          const source = payload.source ? `${payload.source}: ` : '';
          const detail = payload.detail ? ` ${payload.detail}` : '';
          reject(new Error(`${source}${payload.error || 'Upload failed'}${detail}`.trim()));
        }
      };

      request.onerror = () => reject(new Error('Upload failed'));
      request.send(form);
    });
  }

  async function uploadFiles(files) {
    const queue = Array.from(files || []);
    if (!queue.length) return;

    const uploadButton = $('#upload');
    const drop = $('#drop');
    uploadButton.disabled = true;
    drop.classList.add('busy');
    $('#uploadState').classList.remove('hide');
    $('#uploadBar').style.width = '0%';

    let uploaded = 0;

    for (let index = 0; index < queue.length; index += 1) {
      try {
        await uploadSingle(queue[index], index, queue.length);
        uploaded += 1;
      } catch (error) {
        toast(`${queue[index].name}: ${error.message}`);
      }
    }

    $('#fileInput').value = '';
    $('#uploadState').classList.add('hide');
    uploadButton.disabled = false;
    drop.classList.remove('busy');

    if (uploaded) {
      toast(uploaded === queue.length ? 'Uploaded' : `Uploaded ${uploaded}/${queue.length}`);
      refresh();
    }
  }

  async function login(event) {
    if (event) event.preventDefault();

    const button = $('#unlock');
    button.disabled = true;
    button.textContent = 'Unlocking...';

    try {
      const data = await api('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: norm($('#pin').value) }),
      });
      setToken(data.token);
      $('#lock').classList.add('hide');
      $('#app').classList.remove('hide');
      toast('Welcome back to Saad Drive');
      refresh();
    } catch (error) {
      $('#error').textContent = error.message;
      button.disabled = false;
      button.textContent = 'Unlock workspace →';
    }
  }

  function bindEvents() {
    $('#login').onsubmit = login;
    $('#unlock').onclick = login;

    $('#cancel').onclick = () => {
      $('#dialogWrap').classList.add('hide');
      state.pending = null;
    };

    $('#dialog').onsubmit = async event => {
      event.preventDefault();
      const pending = state.pending;
      const value = $('#dialogInput').value.trim();
      if (!pending || !value) return;

      $('#dialogWrap').classList.add('hide');

      try {
        await api('/api/items', {
          method: pending.kind === 'rename' ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            pending.kind === 'rename'
              ? { id: pending.id, name: value }
              : { name: value, kind: 'folder', parent_id: state.current }
          ),
        });
        toast(pending.kind === 'rename' ? 'Renamed' : 'Folder created');
        refresh();
      } catch (error) {
        toast(error.message);
      }
    };

    $('#logout').onclick = () => {
      if (!confirm('Log out of Saad Drive?')) return;
      setToken('');
      location.reload();
    };

    $('#upload').onclick = () => $('#fileInput').click();
    $('#drop').onclick = () => $('#fileInput').click();
    $('#fileInput').onchange = event => uploadFiles(event.target.files);

    $('#search').oninput = render;
    $('#sort').onchange = render;

    $('#list').onclick = () => {
      state.mode = 'list';
      localStorage.setItem('saadView', state.mode);
      render();
    };

    $('#grid').onclick = () => {
      state.mode = 'grid';
      localStorage.setItem('saadView', state.mode);
      render();
    };

    $('#menu').onclick = () => $('#side').classList.toggle('open');
    $('#more').onclick = newFolder;
    $('#downloadSelected').onclick = () => {
      const selectedItem = state.all.find(item => item.id === state.selected);
      if (selectedItem?.kind === 'file') download(state.selected);
    };
    $('#renameSelected').onclick = () => state.selected && rename(state.selected);
    $('#deleteSelected').onclick = () => state.selected && removeItem(state.selected);
    $('#profile').onclick = () => $('#profileCard').classList.toggle('hide');

    document.querySelectorAll('.nav button').forEach(button => {
      button.onclick = () => setView(button.dataset.view);
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('#menuBox') && !event.target.closest('[data-more]')) {
        $('#menuBox').classList.add('hide');
      }
    });

    const drop = $('#drop');
    drop.addEventListener('dragover', event => {
      event.preventDefault();
      drop.classList.add('dragging');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
    drop.addEventListener('drop', event => {
      event.preventDefault();
      drop.classList.remove('dragging');
      uploadFiles(event.dataTransfer?.files || []);
    });
  }

  if (localStorage.getItem('saadTheme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  }

  bindEvents();
  setTableMode();
  updateSelectionVisibility();

  if (getToken()) {
    $('#lock').classList.add('hide');
    $('#app').classList.remove('hide');
    refresh();
  }
})();
