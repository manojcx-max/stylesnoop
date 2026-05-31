# StyleSnoop 🕵️‍♂️

**StyleSnoop** is a lightweight, high-performance browser extension built using **Manifest V3** that allows you to inspect and copy the CSS styles of any element on a web page. 

It is designed with a **strict Zero DOM Injection** principle—the extension never modifies or injects any elements (like tooltip overlays, absolute divs, or third-party wrappers) into the page's DOM. This guarantees that your target webpage's layout remains 100% untouched and avoids side-effects on reactive frameworks (like React, Vue, Svelte) or page styles.

---

## 🎨 Features
- **Zero DOM Injection**: Style inspection is tracked and rendered entirely inside the extension's popup dashboard, using only a safe temporary CSS `outline` style to highlight target page elements (which is reverted on mouseout or deactivation).
- **Interactive Box Model / Spacing Visualizer**: Displays a clean, visual representation of the hovered element's dimensions, margins, and paddings.
- **Categorized Detail Panels**: Styles are divided into logical groups: Typography, Colors & Visuals, and Layout & Box properties.
- **Quick Copying**:
  - Click any property row to copy its exact CSS declaration (e.g. `font-size: 16px;`).
  - Click the **Copy** button in any section header to copy the entire block of styles as neat CSS.
  - Click the selector badge at the top to copy the element's Tag, ID, and Class Selector.
- **Dynamic Filter & Search**: Search through CSS property names or values in real-time.
- **Customizable Highlight Settings**: Disable the outline highlight altogether or choose a custom color (Indigo, Emerald, Rose, Yellow, Cyan) to suit the design theme of the page you are inspecting.
- **Chrome & Firefox Cross-Browser MV3 Compatible**: Single unified file base supporting both browser architectures.

---

## 📁 File Structure
```
StyleSnoop/
├── manifest.json            # Manifest V3 cross-browser configuration
├── content.js               # Page interaction, element selection & style extraction
├── background.js            # Initializer and extension storage setup
├── README.md                # This manual
├── popup/
│   ├── popup.html           # Structure of the dashboard UI
│   ├── popup.css            # Custom CSS with premium dark navy & glassmorphism theme
│   └── popup.js             # Logic for managing tab events, messaging, and rendering
└── icons/
    ├── icon16.png           # 16x16 pixel extension icon
    ├── icon48.png           # 48x48 pixel extension icon
    └── icon128.png          # 128x128 pixel extension icon
```

---

## 🚀 Installation & Local Development

### 1. Google Chrome (and Chromium browsers)
1. Open Google Chrome and type `chrome://extensions/` in the address bar.
2. In the top-right corner, toggle the **Developer mode** switch to **ON**.
3. In the top-left corner, click the **Load unpacked** button.
4. Select the `StyleSnoop` root directory from your file system.
5. The extension is now loaded! Pin the StyleSnoop icon to your toolbar.

### 2. Mozilla Firefox
1. Open Mozilla Firefox and type `about:debugging` in the address bar.
2. In the sidebar on the left, click **This Firefox**.
3. Under the *Temporary Extensions* section, click the **Load Temporary Add-on...** button.
4. Select the `manifest.json` file inside the `StyleSnoop` root directory.
5. The extension is now loaded! Locate the icon in your toolbar.

---

## 🎮 How to Use StyleSnoop

1. **Activate**: Click the StyleSnoop action icon in your browser toolbar. A green `"ON"` badge will appear on the icon to show that inspection mode is active for that tab.
2. **Inspect**: Hover over elements on the web page to see computed CSS properties in the floating panel.
3. **Lock Focus**: Left-click on any element to lock the panel's focus. Once locked, the panel outline freezes, and buttons become interactive.
4. **Copy Styles**:
   - Hover inside the locked panel and click **Copy Tailwind** to copy the element mapped to standard Tailwind CSS JSX classes.
   - Or, open the Settings Page (Right-click icon -> select **Options**) to inspect detailed computed typography/spacing box models, search properties, and copy raw CSS blocks.
5. **Unlock / Resume**: Click **Unlock 🔓** inside the panel, or click anywhere on the page outside the panel to resume scanning.
6. **Deactivate**: 
   - Click the StyleSnoop toolbar icon again (the badge will disappear).
   - Or, simply press the **Escape** key on your keyboard to instantly close the inspector panel and deactivate inspection.

---

## 🛠️ Architecture Decisions

### Multi-Browser Service Worker vs Event Script Setup
Manifest V3 handle background processes differently across engines:
- **Chrome** expects `"background": { "service_worker": "background.js" }` and fails if `"scripts"` is supplied.
- **Firefox** expects `"background": { "scripts": ["background.js"] }` and ignores `"service_worker"`.

By including both definitions side-by-side in `manifest.json`, the extension loads cleanly in both environments without triggering compiler errors, maintaining a clean single-codebase layout.

### Dynamic Script Injection Safeguard
To ensure maximum user comfort, StyleSnoop content scripts run automatically on page load. However, if you install the extension and immediately try inspecting an already-open tab without refreshing it first, StyleSnoop will detect the missing connection and **programmatically inject the content script** as a fallback, ensuring instant functionality.
