// StyleSnoop Background Service Worker / Event Page
// Coordinates tab-specific inspection toggles, badges, and lifecycle state cleanups.

const ext = typeof chrome !== 'undefined' && chrome.runtime ? chrome : browser;

// On installation, initialize defaults
ext.runtime.onInstalled.addListener((details) => {
  console.log("StyleSnoop extension installed successfully.");
  const defaults = {
    highlightColor: "#6366f1",   // Default indigo highlight
    highlightEnabled: true,
    inspectingTabs: []           // Tab IDs that have active inspection
  };
  // Only show onboarding tooltip on a brand-new install, not on updates
  if (details.reason === 'install') {
    defaults.onboardingShown = false;
  }
  ext.storage.local.set(defaults, () => {
    console.log("Storage settings initialized.");
  });
});


// Toggle inspection mode when the extension icon is clicked
ext.action.onClicked.addListener((tab) => {
  if (isSystemPage(tab.url)) {
    console.log("StyleSnoop: Cannot run on system page:", tab.url);
    return;
  }
  toggleInspectionForTab(tab.id);
});

// Sync inspection state and handle general messaging commands
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;
  console.log("BACKGROUND ONMESSAGE:", message, "from tabId:", tabId);

  if (message.type === "inspector-deactivated-by-user" && tabId) {
    setTabInspectionActive(tabId, false);
  } else if (message.action === "openHistoryPage") {
    ext.tabs.create({ url: ext.runtime.getURL('history.html') });
  } else if (message.action === "toggle-inspector" && tabId) {
    toggleInspectionForTab(tabId);
  } else if (message.action === "start-inspect-active-tab") {
    // Find active tab in the last focused window, or another inspectable active tab
    ext.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      let targetTab = tabs[0];
      // If the target tab is the history dashboard itself, look for other active windows/tabs
      if (targetTab && isSystemPage(targetTab.url)) {
        ext.tabs.query({ active: true }, (allActiveTabs) => {
          const firstInspectable = allActiveTabs.find(t => !isSystemPage(t.url));
          if (firstInspectable) {
            toggleInspectionForTab(firstInspectable.id);
            ext.tabs.update(firstInspectable.id, { active: true });
            // Optionally focus the window of that tab
            if (ext.windows) {
              ext.windows.update(firstInspectable.windowId, { focused: true });
            }
          }
        });
      } else if (targetTab) {
        toggleInspectionForTab(targetTab.id);
        ext.tabs.update(targetTab.id, { active: true });
      }
    });
  }
  
  return true;
});

// Clean up states when tabs are updated (reloaded / navigated) or closed
ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    // Reverts inspection state on page navigation or reload
    setTabInspectionActive(tabId, false);
  }
});

ext.tabs.onRemoved.addListener((tabId) => {
  setTabInspectionActive(tabId, false);
});

// Toggle State Helper
function toggleInspectionForTab(tabId) {
  console.log("BACKGROUND toggleInspectionForTab:", tabId);
  ext.tabs.get(tabId, (tab) => {
    if (ext.runtime.lastError || !tab) {
      console.log("BACKGROUND: Tab no longer exists:", tabId);
      return;
    }
    ext.storage.local.get(["inspectingTabs", "highlightColor", "highlightEnabled"], (settings) => {
      let inspectingTabs = settings.inspectingTabs || [];
      const isActive = inspectingTabs.includes(tabId);
      
      if (isActive) {
        // Deactivate
        inspectingTabs = inspectingTabs.filter(id => id !== tabId);
        ext.storage.local.set({ inspectingTabs }, () => {
          updateBadge(tabId, false);
          ext.tabs.sendMessage(tabId, { action: "stop-inspecting" }).catch(() => {});
        });
      } else {
        // Activate
        inspectingTabs.push(tabId);
        ext.storage.local.set({ inspectingTabs }, () => {
          updateBadge(tabId, true);
          
          // Ping tab script to verify if loaded, inject if not (recovers from fresh extension load)
          ext.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
            const config = {
              action: "start-inspecting",
              highlightColor: settings.highlightColor || "#6366f1",
              highlightEnabled: settings.highlightEnabled !== undefined ? settings.highlightEnabled : true
            };

            if (ext.runtime.lastError || !response) {
              // Script not loaded, inject content.js dynamically
              ext.scripting.executeScript({
                target: { tabId },
                files: ["content.js"]
              }, () => {
                if (ext.runtime.lastError) {
                  console.error("StyleSnoop: Content script injection failed", ext.runtime.lastError.message);
                  return;
                }
                // Send message now that it's injected
                ext.tabs.sendMessage(tabId, config).catch(() => {});
              });
            } else {
              // Send start message
              ext.tabs.sendMessage(tabId, config).catch(() => {});
            }
          });
        });
      }
    });
  });
}

// Force-Set State Helper (e.g. for closing/navigating cleanups)
function setTabInspectionActive(tabId, active) {
  ext.storage.local.get(["inspectingTabs"], (settings) => {
    let inspectingTabs = settings.inspectingTabs || [];
    const isCurrentlyActive = inspectingTabs.includes(tabId);

    if (active && !isCurrentlyActive) {
      inspectingTabs.push(tabId);
      ext.storage.local.set({ inspectingTabs }, () => {
        updateBadge(tabId, true);
      });
    } else if (!active && isCurrentlyActive) {
      inspectingTabs = inspectingTabs.filter(id => id !== tabId);
      ext.storage.local.set({ inspectingTabs }, () => {
        updateBadge(tabId, false);
        ext.tabs.sendMessage(tabId, { action: "stop-inspecting" }).catch(() => {});
      });
    }
  });
}

// Update Extension Icon Badge
function updateBadge(tabId, active) {
  try {
    if (active) {
      ext.action.setBadgeText({ text: "●", tabId }).catch(() => {});
      ext.action.setBadgeBackgroundColor({ color: "#10B981", tabId }).catch(() => {}); // Green
    } else {
      ext.action.setBadgeText({ text: "", tabId }).catch(() => {}); // Clears badge
    }
  } catch (_) {}
}

// Check system URL exclusions
function isSystemPage(url) {
  return !url || 
         url.startsWith("chrome://") || 
         url.startsWith("chrome-extension://") || 
         url.startsWith("about:") || 
         url.startsWith("moz-extension://") ||
         url.startsWith("https://chrome.google.com/webstore") ||
         url.startsWith("https://addons.mozilla.org");
}
