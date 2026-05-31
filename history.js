// history.js — StyleSnoop Dashboard Controller

const ext = (typeof browser !== 'undefined') ? browser : chrome;

// ─── State variables ───
let historyData = [];
let searchQuery = '';
let siteFilter = 'All Sites';
let typeFilter = 'All Types';
let sortFilter = 'Newest First';
let activeTab = 'all'; // 'all'
let currentLayout = 'grid'; // always 'grid'
let contextItemId = null;

// ─── Element refs ───
const searchInput = document.getElementById('search-input');
const siteFilterOptions = document.getElementById('site-filter-options');
const siteFilterVal = document.getElementById('site-filter-val');
const exportAllBtn = document.getElementById('export-all-btn');
const gridContainer = document.getElementById('grid-container');
const contextMenu = document.getElementById('context-menu');
const ctxFavBtn = document.getElementById('ctx-fav-btn');
const ctxFavLabel = document.getElementById('ctx-fav-label');
const menuInspectBtn = document.getElementById('menu-inspect');
const menuHistory = document.getElementById('menu-history');
const menuSettings = document.getElementById('menu-settings');

// Views
const historyView = document.getElementById('history-view');
const settingsView = document.getElementById('settings-view');

// Sidebar and Theme
const sidebar = document.getElementById('sidebar');
const sidebarCollapse = document.getElementById('sidebar-collapse');
const themeToggle = document.getElementById('theme-toggle');

// Settings Elements
const settingsTwVersion = document.getElementById('settings-tw-version');
const settingsHighlightColor = document.getElementById('settings-highlight-color');
const settingsColorVal = document.getElementById('settings-color-val');
const settingsHighlightToggle = document.getElementById('settings-highlight-toggle');

// ─── Load history & UI state ───
async function initDashboard() {
  // Load saved sidebar state
  ext.storage.local.get(['sidebarCollapsed', 'dashboardTheme'], (res) => {
    if (res.sidebarCollapsed) {
      sidebar.classList.add('collapsed');
    }
    const isDark = res.dashboardTheme === 'dark';
    document.body.classList.toggle('ss-dark', isDark);
    updateThemeToggleUI(isDark);
  });

  // Load actual history list
  try {
    const result = await ext.storage.local.get(['inspectionHistory']);
    historyData = result.inspectionHistory || [];
    renderDashboard();
  } catch (e) {
    historyData = [];
    renderDashboard();
  }

  // Load Settings Page values
  loadSettingsPageValues();
}

function loadSettingsPageValues() {
  ext.storage.local.get(['selectedTailwindVersion', 'highlightColor', 'highlightEnabled'], (res) => {
    const twVer = res.selectedTailwindVersion || 'v4';
    const hlColor = res.highlightColor || '#6366f1';
    const hlEnabled = res.highlightEnabled !== undefined ? res.highlightEnabled : true;
    
    if (settingsTwVersion) settingsTwVersion.value = twVer;
    if (settingsHighlightColor) settingsHighlightColor.value = hlColor;
    if (settingsColorVal) settingsColorVal.textContent = hlColor.toUpperCase();
    if (settingsHighlightToggle) settingsHighlightToggle.checked = hlEnabled;
  });
}

// ─── Rendering ───
function renderDashboard() {
  // Clear container
  gridContainer.innerHTML = '';
  
  // Filter items
  let filtered = historyData.filter(item => {
    // Search query
    const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        item.tag.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Site filter
    const matchSite = siteFilter === 'All Sites' || item.site === siteFilter;
    
    // Type filter
    let matchType = true;
    if (typeFilter !== 'All Types') {
      matchType = item.badge === typeFilter;
    }
    
    return matchSearch && matchSite && matchType;
  });
  
  // Sort items
  if (sortFilter === 'Newest First') {
    filtered.sort((a, b) => b.id - a.id);
  } else if (sortFilter === 'Oldest First') {
    filtered.sort((a, b) => a.id - b.id);
  } else if (sortFilter === 'Alphabetical') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }
  
  // Populate site filter dropdown options
  const uniqueSites = ['All Sites'];
  historyData.forEach(item => {
    if (item.site && !uniqueSites.includes(item.site)) {
      uniqueSites.push(item.site);
    }
  });
  
  const savedSiteVal = siteFilter;
  siteFilterOptions.innerHTML = uniqueSites.map(site => `
    <div class="dropdown-option ${site === siteFilter ? 'option--selected' : ''}" data-value="${site}">${site}</div>
  `).join('');
  if (uniqueSites.includes(savedSiteVal)) {
    siteFilter = savedSiteVal;
    siteFilterVal.textContent = savedSiteVal;
  } else {
    siteFilter = 'All Sites';
    siteFilterVal.textContent = 'All Sites';
  }
  
  if (filtered.length === 0) {
    const isGlobalEmpty = historyData.length === 0;
    gridContainer.innerHTML = `
      <div style="grid-column: 1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 80px 20px; text-align:center; width: 100%;">
        <div style="width:64px; height:64px; border-radius:16px; background:var(--bg-hover); display:flex; align-items:center; justify-content:center; margin-bottom:20px; border: 1px solid var(--border);">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            ${isGlobalEmpty
              ? '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>'
              : '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
            }
          </svg>
        </div>
        <h3 style="font-size:16px; font-weight:600; color:var(--text-1); margin-bottom:8px;">${isGlobalEmpty ? 'No history yet' : 'No items match'}</h3>
        <p style="font-size:13px; color:var(--text-3); line-height:1.6; max-width:240px;">${isGlobalEmpty ? 'Start inspecting elements on any website and they will appear here.' : 'Try adjusting your search or filter settings.'}</p>
      </div>
    `;
    document.getElementById('no-more-footer').style.display = 'none';
    return;
  }
  
  document.getElementById('no-more-footer').style.display = 'flex';
  
  // Render cards
  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card-item';
    card.dataset.id = item.id;
    
    const favClass = item.favorited ? ' favorite-btn--active' : '';
    const previewHtml = getPreviewHtml(item);
    
    card.innerHTML = `
      <div class="thumb-container">
        ${previewHtml}
      </div>
      <div class="card-details">
        <div class="card-row-top">
          <div class="card-title" title="${item.name}">${item.name}</div>
          <button class="favorite-btn${favClass}" data-id="${item.id}" title="Toggle favorite">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="${item.favorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </button>
        </div>
        <div class="card-badge-row">
          <span class="card-badge card-badge--${(item.badge || 'card').toLowerCase()}">${item.badge || 'CARD'}</span>
        </div>
        <code class="card-selector" title="${item.tag}">${item.tag}</code>
        <div class="card-row-bottom">
          <div class="card-meta">${item.time} &bull; ${item.site}</div>
          <button class="card-action-btn" data-id="${item.id}" title="Options">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    
    // Attach event listeners
    card.addEventListener('click', (e) => {
      if (e.target.closest('.favorite-btn') || e.target.closest('.card-action-btn')) return;
      openDetailsModal(item);
    });
    
    card.querySelector('.favorite-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(item.id);
    });
    
    card.querySelector('.card-action-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openContextMenu(e, item.id);
    });
    
    gridContainer.appendChild(card);
  });
}

function getPreviewHtml(item) {
  const elType = item.elType || 'card';
  const elText = (item.elText || '').slice(0, 40);
  const elBg = item.elBg || '#FFFFFF';
  const elColor = item.elColor || '#111827';
  const isBgTransparent = elBg === 'transparent' || elBg === 'rgba(0, 0, 0, 0)';

  if (elType === 'btn') {
    return `
      <div class="thumb-preview" style="background:var(--bg-main); padding:12px;">
        <button style="background:${isBgTransparent ? '#111827' : elBg}; color:${elColor || '#ffffff'}; border:none; border-radius:6px; font-size:10px; font-weight:700; padding:8px 16px; cursor:default; font-family:inherit; white-space:nowrap; max-width:120px; overflow:hidden; text-overflow:ellipsis; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">${elText || 'Start building'}</button>
      </div>
    `;
  }

  if (elType === 'heading') {
    return `
      <div class="thumb-preview" style="background:var(--bg-card); flex-direction:column; align-items:flex-start; justify-content:center; padding:12px; gap:4px;">
        <span style="font-size:12px; font-weight:800; color:var(--text-1); line-height:1.2; display:block; text-align:left; overflow:hidden; max-height:28px; letter-spacing:-0.2px;">${elText || 'Build faster.'}</span>
        <span style="font-size:7px; color:var(--text-3); display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3;text-align:left;">The complete toolkit for building products people love.</span>
      </div>
    `;
  }

  if (elType === 'input') {
    return `
      <div class="thumb-preview" style="padding:12px; background:var(--bg-main);">
        <div style="width:100%; border:1.5px solid var(--border); border-radius:6px; background:var(--bg-card); padding:6px 10px; display:flex; align-items:center; gap:6px; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span style="font-size:8px; color:var(--text-3); font-weight:500;">${elText || 'Search components...'}</span>
        </div>
      </div>
    `;
  }

  if (elType === 'navbar') {
    return `
      <div class="thumb-preview" style="padding:10px; background:var(--bg-card); flex-direction:column; align-items:flex-start; justify-content:center; gap:6px;">
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:6px 8px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
          <span style="font-size:7.5px; font-weight:800; color:var(--text-1); display:flex; align-items:center; gap:3px;"><div style="width:5px; height:5px; background:#2563EB; border-radius:50%;"></div>Logo</span>
          <div style="display:flex; gap:5px; font-size:6px; color:var(--text-3); font-weight:600;">
            <span>Home</span><span>About</span>
          </div>
        </div>
      </div>
    `;
  }

  if (elType === 'image') {
    return `
      <div class="thumb-preview" style="padding:8px; background:var(--bg-main);">
        <div style="width:100%; height:100%; border-radius:8px; background:var(--bg-hover); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; flex-direction:column; gap:4px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
      </div>
    `;
  }

  return `
    <div class="thumb-preview" style="background:var(--bg-card); padding:12px;">
      <div style="width:100%; height:100%; border:1.5px solid var(--border); border-radius:8px; background:var(--bg-card); padding:8px; display:flex; align-items:center; gap:8px; box-shadow:0 1px 3px rgba(0,0,0,0.01);">
        <div style="width:24px; height:24px; border-radius:6px; background:#EEF2FF; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <div style="display:flex; flex-direction:column; gap:2px; min-width:0; text-align:left;">
          <span style="font-size:8px; font-weight:700; color:var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Performance</span>
          <span style="font-size:6px; color:var(--text-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Blazing fast performance.</span>
        </div>
      </div>
    </div>
  `;
}

// ─── Toggles & Filters Wiring ───
function wireDashboardEvents() {
  // Search
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderDashboard();
  });
  
  // Collapse sidebar
  if (sidebarCollapse) {
    sidebarCollapse.addEventListener('click', () => {
      const isCollapsed = sidebar.classList.toggle('collapsed');
      ext.storage.local.set({ sidebarCollapsed: isCollapsed });
    });
  }

  // Theme Toggle
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('ss-dark');
      ext.storage.local.set({ dashboardTheme: isDark ? 'dark' : 'light' });
      updateThemeToggleUI(isDark);
    });
  }

  // Inspect Button
  menuInspectBtn.addEventListener('click', () => {
    ext.runtime.sendMessage({ action: 'start-inspect-active-tab' });
    window.close();
  });

  // Tab Navigation between views
  menuHistory.addEventListener('click', () => {
    menuHistory.classList.add('menu-btn--active');
    menuSettings.classList.remove('menu-btn--active');
    historyView.classList.remove('ss-hidden');
    settingsView.classList.add('ss-hidden');
  });

  menuSettings.addEventListener('click', () => {
    menuSettings.classList.add('menu-btn--active');
    menuHistory.classList.remove('menu-btn--active');
    settingsView.classList.remove('ss-hidden');
    historyView.classList.add('ss-hidden');
  });

  // Settings inputs
  if (settingsTwVersion) {
    settingsTwVersion.addEventListener('change', (e) => {
      ext.storage.local.set({ selectedTailwindVersion: e.target.value });
    });
  }
  if (settingsHighlightColor) {
    settingsHighlightColor.addEventListener('input', (e) => {
      const val = e.target.value;
      if (settingsColorVal) settingsColorVal.textContent = val.toUpperCase();
      ext.storage.local.set({ highlightColor: val });
    });
  }
  if (settingsHighlightToggle) {
    settingsHighlightToggle.addEventListener('change', (e) => {
      ext.storage.local.set({ highlightEnabled: e.target.checked });
    });
  }
  
  // Hotkey / to focus search
  document.addEventListener('keydown', (e) => {
    // Cmd+K or Ctrl+K to search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === 'Escape') {
      closeContextMenu();
    }
  });
  
  // Custom Dropdowns
  function setupDropdown(wrapId, valId, optionsId, filterKey) {
    const wrap = document.getElementById(wrapId);
    const valEl = document.getElementById(valId);
    const optionsEl = document.getElementById(optionsId);
    
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOption = e.target.closest('.dropdown-option');
      if (isOption) {
        const val = isOption.dataset.value;
        if (filterKey === 'site') siteFilter = val;
        if (filterKey === 'type') typeFilter = val;
        if (filterKey === 'sort') sortFilter = val;
        
        valEl.textContent = val;
        
        optionsEl.querySelectorAll('.dropdown-option').forEach(opt => {
          opt.classList.toggle('option--selected', opt.dataset.value === val);
        });
        
        wrap.classList.remove('open');
        renderDashboard();
      } else {
        // close others
        document.querySelectorAll('.custom-dropdown.open').forEach(d => {
          if (d !== wrap) d.classList.remove('open');
        });
        wrap.classList.toggle('open');
      }
    });
  }

  setupDropdown('site-filter-wrap', 'site-filter-val', 'site-filter-options', 'site');
  setupDropdown('type-filter-wrap', 'type-filter-val', 'type-filter-options', 'type');
  setupDropdown('sort-filter-wrap', 'sort-filter-val', 'sort-filter-options', 'sort');
  
  // Export
  exportAllBtn.addEventListener('click', () => {
    exportHistoryJson();
  });
  
  // Outside context menu & dropdown clicks
  document.addEventListener('click', () => {
    closeContextMenu();
    document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
  });
}

function updateThemeToggleUI(isDark) {
  if (!themeToggle) return;
  const sunIcon = themeToggle.querySelector('.sun-icon');
  const moonIcon = themeToggle.querySelector('.moon-icon');
  if (isDark) {
    sunIcon.classList.add('ss-hidden');
    moonIcon.classList.remove('ss-hidden');
  } else {
    sunIcon.classList.remove('ss-hidden');
    moonIcon.classList.add('ss-hidden');
  }
}

// ─── Actions & Modifications ───
async function saveHistoryState() {
  try {
    await ext.storage.local.set({ inspectionHistory: historyData });
  } catch (_) {}
}

function toggleFavorite(id) {
  const item = historyData.find(h => h.id === id);
  if (item) {
    item.favorited = !item.favorited;
    saveHistoryState().then(renderDashboard);
  }
}

function deleteItem(id) {
  historyData = historyData.filter(h => h.id !== id);
  saveHistoryState().then(renderDashboard);
}

function exportHistoryJson() {
  try {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(historyData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "stylesnoop_history.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  } catch (_) {}
}

// ─── Context menu ───
function openContextMenu(e, id) {
  contextItemId = id;
  const item = historyData.find(h => h.id === id);
  if (!item) return;
  
  ctxFavLabel.textContent = item.favorited ? 'Unfavorite' : 'Favorite';
  
  contextMenu.classList.remove('ss-hidden');
  
  // Position near cursor
  let top = e.clientY + 4;
  let left = e.clientX - 160;
  
  if (left < 10) left = 10;
  if (top + 160 > window.innerHeight) top = e.clientY - 160;
  
  contextMenu.style.top = `${top}px`;
  contextMenu.style.left = `${left}px`;
  
  e.currentTarget.classList.add('active');
}

// Context menu action wiring
document.querySelectorAll('.ctx-item').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const action = btn.dataset.action;
    const item = historyData.find(h => h.id === contextItemId);
    
    if (!item) {
      closeContextMenu();
      return;
    }
    
    if (action === 'favorite') {
      toggleFavorite(contextItemId);
    } else if (action === 'delete') {
      deleteItem(contextItemId);
    } else if (action === 'copy-tailwind') {
      const code = item.codeReactTSX || `<div className="${item.classes || ''}">${item.name}</div>`;
      copyToClipboard(code);
    } else if (action === 'copy-html') {
      const code = item.codeHTML || `<div class="${item.classes || ''}">${item.name}</div>`;
      copyToClipboard(code);
    }
    
    closeContextMenu();
  });
});

function closeContextMenu() {
  contextMenu.classList.add('ss-hidden');
  document.querySelectorAll('.card-action-btn.active').forEach(b => b.classList.remove('active'));
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    console.log('Copied to clipboard!');
  }).catch(err => {
    console.error('Could not copy:', err);
  });
}

// ─── Details Modal ───
let selectedModalItem = null;
let activeModalLang = 'React (TSX)';

const detailsModal = document.getElementById('details-modal');
const modalBadge = document.getElementById('modal-badge');
const modalTitle = document.getElementById('modal-title');
const modalClose = document.getElementById('modal-close');
const modalTag = document.getElementById('modal-tag');
const modalSite = document.getElementById('modal-site');
const modalTime = document.getElementById('modal-time');
const modalCodeInner = document.getElementById('modal-code-inner');
const modalCopyBtn = document.getElementById('modal-copy-btn');
const modalCopyBtnText = document.getElementById('modal-copy-btn-text');

function openDetailsModal(item) {
  selectedModalItem = item;
  detailsModal.classList.remove('modal-hidden');
  
  modalBadge.textContent = item.badge || 'CARD';
  modalBadge.className = `modal-badge modal-badge--${(item.badge || 'card').toLowerCase()}`;
  modalTitle.textContent = item.name;
  modalTag.textContent = item.tag;
  modalSite.textContent = item.site;
  modalTime.textContent = item.time;
  
  updateModalCode();
}

function updateModalCode() {
  if (!selectedModalItem) return;
  let code = '';
  if (activeModalLang === 'React (TSX)') code = selectedModalItem.codeReactTSX;
  else if (activeModalLang === 'React (JSX)') code = selectedModalItem.codeReactJSX;
  else if (activeModalLang === 'Vue 3') code = selectedModalItem.codeVue;
  else if (activeModalLang === 'HTML') code = selectedModalItem.codeHTML;
  
  // fallback if code wasn't saved (legacy items)
  if (!code) {
    const cls = selectedModalItem.classes || '';
    if (activeModalLang === 'HTML') {
      code = `<div class="${cls}">\n  ${selectedModalItem.name}\n</div>`;
    } else if (activeModalLang === 'Vue 3') {
      code = `<template>\n  <div class="${cls}">\n    ${selectedModalItem.name}\n  </div>\n</template>`;
    } else {
      code = `import React from 'react';\n\nexport default function Component() {\n  return (\n    <div className="${cls}">\n      ${selectedModalItem.name}\n    </div>\n  );\n}`;
    }
  }
  
  modalCodeInner.textContent = code;
}

modalClose.addEventListener('click', () => {
  detailsModal.classList.add('modal-hidden');
  selectedModalItem = null;
});

// Click backdrop to close
detailsModal.addEventListener('click', (e) => {
  if (e.target === detailsModal) {
    detailsModal.classList.add('modal-hidden');
    selectedModalItem = null;
  }
});

// Tab switching
document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('modal-tab--active'));
    tab.classList.add('modal-tab--active');
    activeModalLang = tab.dataset.lang;
    updateModalCode();
  });
});

// Copy Code
modalCopyBtn.addEventListener('click', () => {
  const code = modalCodeInner.textContent;
  copyToClipboard(code);
  const origText = modalCopyBtnText.textContent;
  modalCopyBtnText.textContent = '✓ Copied!';
  modalCopyBtn.classList.add('modal-copied');
  setTimeout(() => {
    modalCopyBtnText.textContent = origText;
    modalCopyBtn.classList.remove('modal-copied');
  }, 1800);
});

// ─── Live Storage Synchronization ───
try {
  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.inspectionHistory) {
      const newVal = changes.inspectionHistory.newValue || [];
      if (JSON.stringify(newVal) !== JSON.stringify(historyData)) {
        historyData = newVal;
        renderDashboard();
      }
    }
  });
} catch (_) {}

// ─── Initialize ───
initDashboard();
wireDashboardEvents();
