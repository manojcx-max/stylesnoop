// ═══════════════════════════════════════════════════════════════
// STYLESNOOP CONTENT SCRIPT v2 — Premium Inspector Panel
// Shadow DOM only · Zero page DOM modification
// Chrome & Firefox (Manifest V3) compatible
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';
  if (window.__ssV2) return;
  window.__ssV2 = true;

  const baseExt = typeof browser !== 'undefined' ? browser : chrome;

  let active = false;
  let activeTab = 'tailwind';
  let activeView = 'inspector';
  let selectedFramework = 'React (TSX)';
  let selectedTailwindVersion = 'v3';
  let selectedEl = null;
  let hoveredEl = null;
  let currentCode = '';
  let inspecting = false;
  let highlightColor = '#2563eb';
  let highlightEnabled = true;

  let activePseudoRules = [];
  let detectedFonts = new Set();

  function cachePseudoRules() {
    activePseudoRules = [];
    try {
      const sheets = document.styleSheets;
      for (let i = 0; i < sheets.length; i++) {
        try {
          const sheet = sheets[i];
          const cssRules = sheet.cssRules || sheet.rules;
          if (!cssRules) continue;
          for (let j = 0; j < cssRules.length; j++) {
            const rule = cssRules[j];
            if (rule.type === 1 && rule.selectorText) {
              const selector = rule.selectorText;
              if (selector.includes(':hover') || selector.includes(':focus') || selector.includes(':active') || selector.includes(':disabled')) {
                activePseudoRules.push(rule);
              }
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  function extractInteractiveClassesFast(el) {
    if (!el || !el.matches || activePseudoRules.length === 0) return [];
    const classes = [];
    activePseudoRules.forEach(rule => {
      const selector = rule.selectorText;
      const parts = selector.split(',');
      parts.forEach(sPart => {
        const cleaned = sPart.trim().replace(/::?[a-zA-Z-]+/g, '');
        try {
          if (cleaned && el.matches(cleaned)) {
            let prefix = 'hover:';
            if (sPart.includes(':focus')) prefix = 'focus:';
            else if (sPart.includes(':active')) prefix = 'active:';
            else if (sPart.includes(':disabled')) prefix = 'disabled:';

            const style = rule.style;
            if (style.backgroundColor || style.background) {
              const bg = style.backgroundColor || style.background;
              if (!bg.includes('gradient')) {
                const bgClass = colorToTailwind(bg, 'bg');
                if (bgClass) classes.push(`${prefix}${bgClass}`);
              }
            }
            if (style.color) {
              const textClass = colorToTailwind(style.color, 'text');
              if (textClass) classes.push(`${prefix}${textClass}`);
            }
            if (style.borderColor) {
              const borderClass = colorToTailwind(style.borderColor, 'border');
              if (borderClass) classes.push(`${prefix}${borderClass}`);
            }
            if (style.opacity) {
              const op = parseFloat(style.opacity);
              if (!isNaN(op)) {
                const opacityPercent = Math.round(op * 100);
                classes.push(`${prefix}opacity-${opacityPercent}`);
              }
            }
            if (style.boxShadow && style.boxShadow !== 'none') {
              const cleanShadow = style.boxShadow.replace(/\s+/g, '_');
              classes.push(`${prefix}shadow-[${cleanShadow}]`);
            }
          }
        } catch (_) {}
      });
    });
    return classes;
  }

  function checkSimilarity(el1, el2) {
    if (!el1 || !el2 || el1.nodeType !== 1 || el2.nodeType !== 1) return false;
    if (el1.tagName !== el2.tagName) return false;
    const c1 = (el1.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    const c2 = (el2.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    if (c1.length === 0 && c2.length === 0) return true;
    const intersection = c1.filter(cls => c2.includes(cls));
    const union = Array.from(new Set([...c1, ...c2]));
    const similarity = intersection.length / union.length;
    return similarity >= 0.75;
  }

  function cleanSvgInner(svgString) {
    if (!svgString) return '';
    return svgString
      .replace(/<metadata>[\s\S]*?<\/metadata>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+id="[^"]*"/gi, '')
      .replace(/\s+data-[a-zA-Z0-9-]+="[^"]*"/gi, '')
      .replace(/\s+xml:space="[^"]*"/gi, '');
  }

  function generateFontImports() {
    if (detectedFonts.size === 0) return '';
    const imports = [];
    const fontFamilies = Array.from(detectedFonts);
    try {
      const sheets = document.styleSheets;
      for (let i = 0; i < sheets.length; i++) {
        try {
          const sheet = sheets[i];
          if (sheet.href && sheet.href.includes('fonts.googleapis.com')) {
            imports.push(`@import url('${sheet.href}');`);
            continue;
          }
          const cssRules = sheet.cssRules || sheet.rules;
          if (!cssRules) continue;
          for (let j = 0; j < cssRules.length; j++) {
            const rule = cssRules[j];
            if (rule.type === 4 && rule.href && rule.href.includes('fonts.googleapis.com')) {
              imports.push(`@import url('${rule.href}');`);
            } else if (rule.type === 3 && rule.href && rule.href.includes('fonts.googleapis.com')) {
              imports.push(`@import url('${rule.href}');`);
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    fontFamilies.forEach(font => {
      const alreadyHas = imports.some(imp => imp.toLowerCase().includes(font.toLowerCase().replace(/\s+/g, '+')));
      if (!alreadyHas) {
        const formatted = font.replace(/\s+/g, '+');
        imports.push(`@import url('https://fonts.googleapis.com/css2?family=${formatted}:wght@300;400;500;600;700&display=swap');`);
      }
    });

    if (imports.length === 0) return '';
    return `/* ─── CUSTOM FONT IMPORTS ─── */\n${imports.join('\n')}\n\n`;
  }

  function isAllInline(node) {
    if (!node || !node.childNodes) return false;
    const inlineTags = new Set(['span', 'strong', 'em', 'b', 'i', 'a', 'code', 'sub', 'sup', 'small', 'ins', 'del', 'mark']);
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType === 3) continue;
      if (child.nodeType === 1) {
        const ctag = child.tagName.toLowerCase();
        if (!inlineTags.has(ctag)) return false;
        if (!isAllInline(child)) return false;
      } else {
        return false;
      }
    }
    return true;
  }

  function compileInline(node, framework) {
    const isReact = framework.startsWith('React');
    const attrCls = isReact ? 'className' : 'class';
    let result = '';
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType === 3) {
        result += child.textContent;
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        const styles = extractStyles(child);
        const twCls = stylesToTailwind(styles, child).join(' ');
        const classAttr = twCls ? ` ${attrCls}="${twCls}"` : '';
        
        let gradientStyleAttr = '';
        const _gradInfo = styles.backgroundImage ? parseGradientToTailwind(styles.backgroundImage) : null;
        if (_gradInfo && _gradInfo.inlineStyle) {
          let _styleVal = '';
          if (isReact) {
            if (styles.backgroundClip && styles.backgroundClip.includes('text')) {
              _styleVal = `{{backgroundImage: ${JSON.stringify(_gradInfo.inlineStyle)}, WebkitBackgroundClip: 'text', backgroundClip: 'text'}}`;
            } else {
              _styleVal = `{{backgroundImage: ${JSON.stringify(_gradInfo.inlineStyle)}}}`;
            }
          } else {
            if (styles.backgroundClip && styles.backgroundClip.includes('text')) {
              _styleVal = `"background-image: ${_gradInfo.inlineStyle.replace(/"/g, "'")}; -webkit-background-clip: text; background-clip: text;"`;
            } else {
              _styleVal = `"background-image: ${_gradInfo.inlineStyle.replace(/"/g, "'")}"`;
            }
          }
          gradientStyleAttr = ` style=${_styleVal}`;
        }
        
        const inner = compileInline(child, framework);
        result += `<${tag}${classAttr}${gradientStyleAttr}>${inner}</${tag}>`;
      }
    }
    return result;
  }

  try {
    ext.storage.local.get(['selectedTailwindVersion', 'highlightColor', 'highlightEnabled'], (res) => {
      if (res.selectedTailwindVersion) selectedTailwindVersion = res.selectedTailwindVersion;
      if (res.highlightColor) highlightColor = res.highlightColor;
      if (res.highlightEnabled !== undefined) highlightEnabled = res.highlightEnabled;
      updateOverlayStyles();
    });
  } catch (_) {}

  function isContextActive() {
    try {
      if (!baseExt || !baseExt.runtime || !baseExt.runtime.id) return false;
      baseExt.runtime.getURL(''); // Will throw if context is invalidated
      return true;
    } catch (err) {
      console.error("isContextActive caught error:", err);
      return false;
    }
  }

  function showReloadWarning() {
    try {
      if (!shadowRoot) return;
      let warn = shadowRoot.getElementById('ss-reload-warn');
      if (!warn) {
        warn = document.createElement('div');
        warn.id = 'ss-reload-warn';
        warn.style.cssText = 'background:#FEF2F2; color:#B91C1C; padding:10px 16px; font-size:11.5px; font-weight:600; text-align:center; border-bottom:1px solid #FCA5A5; display:flex; align-items:center; justify-content:center; gap:8px; z-index:999999;';
        warn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Extension updated. Please refresh the page.
        `;
        const panel = shadowRoot.getElementById('ss-panel');
        if (panel) panel.prepend(warn);
      }
    } catch (_) {}
  }

  function safeStorageGet(keys, callback) {
    try {
      if (!isContextActive()) {
        showReloadWarning();
        return;
      }
      baseExt.storage.local.get(keys, (res) => {
        try {
          if (baseExt.runtime.lastError) {
            showReloadWarning();
            return;
          }
          callback(res);
        } catch (_) {
          showReloadWarning();
        }
      });
    } catch (_) {
      showReloadWarning();
    }
  }

  function safeStorageSet(data, callback) {
    try {
      if (!isContextActive()) {
        showReloadWarning();
        return;
      }
      baseExt.storage.local.set(data, () => {
        try {
          if (baseExt.runtime.lastError) {
            showReloadWarning();
            return;
          }
          if (callback) callback();
        } catch (_) {
          showReloadWarning();
        }
      });
    } catch (_) {
      showReloadWarning();
    }
  }

  const ext = {
    ...baseExt,
    runtime: Object.create(baseExt.runtime || null, {
      id: { get() { return baseExt.runtime?.id; } },
      lastError: { get() { return baseExt.runtime?.lastError; } },
      sendMessage: {
        value: (...args) => {
          try {
            if (isContextActive()) return baseExt.runtime.sendMessage.apply(baseExt.runtime, args);
          } catch(e) {
            console.error("ext.runtime.sendMessage error:", e);
          }
        }
      },
      getURL: {
        value: (...args) => {
          try {
            if (isContextActive()) return baseExt.runtime.getURL.apply(baseExt.runtime, args);
          } catch(e) {
            console.error("ext.runtime.getURL error:", e);
            return '';
          }
        }
      }
    }),
    storage: Object.create(baseExt.storage || null, {
      local: {
        value: Object.create(baseExt.storage?.local || null, {
          get: { value: (keys, callback) => safeStorageGet(keys, callback) },
          set: { value: (data, callback) => safeStorageSet(data, callback) }
        })
      }
    })
  };

  // Initialize selectedFramework from extension storage
  try {
    ext.storage.local.get(['selectedFramework', 'selectedTailwindVersion'], (res) => {
      if (res && res.selectedFramework) {
        selectedFramework = res.selectedFramework;
      }
      if (res && res.selectedTailwindVersion) {
        selectedTailwindVersion = res.selectedTailwindVersion;
      }
    });
  } catch (_) {}


  // Shadow DOM
  let shadowHost = null;
  let shadowRoot = null;
  let panelEl    = null;
  let tooltipEl  = null;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panelRight = 0;
  let panelTop   = 0;
  // WeakMap for saved outlines
  const savedOutlines = new WeakMap();

  // ═══════════════════════════════════════════════════════════════
  // TAILWIND v3 FULL COLOR PALETTE — HSL nearest-neighbor matcher
  // Covers all 22 color families × 11 shades + white/black/transparent
  // ═══════════════════════════════════════════════════════════════

  // Helper: hex → [r, g, b]
  function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
  }

  // Helper: [r,g,b] → [h°, s%, l%]
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h * 360, s * 100, l * 100];
  }

  // Full Tailwind v3 palette — each entry: hex per shade 50…950
  const _PALETTE_DEF = {
    slate:   ['#f8fafc','#f1f5f9','#e2e8f0','#cbd5e1','#94a3b8','#64748b','#475569','#334155','#1e293b','#0f172a','#020617'],
    gray:    ['#f9fafb','#f3f4f6','#e5e7eb','#d1d5db','#9ca3af','#6b7280','#4b5563','#374151','#1f2937','#111827','#030712'],
    zinc:    ['#fafafa','#f4f4f5','#e4e4e7','#d4d4d8','#a1a1aa','#71717a','#52525b','#3f3f46','#27272a','#18181b','#09090b'],
    neutral: ['#fafafa','#f5f5f5','#e5e5e5','#d4d4d4','#a3a3a3','#737373','#525252','#404040','#262626','#171717','#0a0a0a'],
    stone:   ['#fafaf9','#f5f5f4','#e7e5e4','#d6d3d1','#a8a29e','#78716c','#57534e','#44403c','#292524','#1c1917','#0c0a09'],
    red:     ['#fef2f2','#fee2e2','#fecaca','#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#991b1b','#7f1d1d','#450a0a'],
    orange:  ['#fff7ed','#ffedd5','#fed7aa','#fdba74','#fb923c','#f97316','#ea580c','#c2410c','#9a3412','#7c2d12','#431407'],
    amber:   ['#fffbeb','#fef3c7','#fde68a','#fcd34d','#fbbf24','#f59e0b','#d97706','#b45309','#92400e','#78350f','#451a03'],
    yellow:  ['#fefce8','#fef9c3','#fef08a','#fde047','#facc15','#eab308','#ca8a04','#a16207','#854d0e','#713f12','#422006'],
    lime:    ['#f7fee7','#ecfccb','#d9f99d','#bef264','#a3e635','#84cc16','#65a30d','#4d7c0f','#3f6212','#365314','#1a2e05'],
    green:   ['#f0fdf4','#dcfce7','#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a','#15803d','#166534','#14532d','#052e16'],
    emerald: ['#ecfdf5','#d1fae5','#a7f3d0','#6ee7b7','#34d399','#10b981','#059669','#047857','#065f46','#064e3b','#022c22'],
    teal:    ['#f0fdfa','#ccfbf1','#99f6e4','#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e','#115e59','#134e4a','#042f2e'],
    cyan:    ['#ecfeff','#cffafe','#a5f3fc','#67e8f9','#22d3ee','#06b6d4','#0891b2','#0e7490','#155e75','#164e63','#083344'],
    sky:     ['#f0f9ff','#e0f2fe','#bae6fd','#7dd3fc','#38bdf8','#0ea5e9','#0284c7','#0369a1','#075985','#0c4a6e','#082f49'],
    blue:    ['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a','#172554'],
    indigo:  ['#eef2ff','#e0e7ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1','#4f46e5','#4338ca','#3730a3','#312e81','#1e1b4b'],
    violet:  ['#f5f3ff','#ede9fe','#ddd6fe','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed','#6d28d9','#5b21b6','#4c1d95','#2e1065'],
    purple:  ['#faf5ff','#f3e8ff','#e9d5ff','#d8b4fe','#c084fc','#a855f7','#9333ea','#7e22ce','#6b21a8','#581c87','#3b0764'],
    fuchsia: ['#fdf4ff','#fae8ff','#f5d0fe','#f0abfc','#e879f9','#d946ef','#c026d3','#a21caf','#86198f','#701a75','#4a044e'],
    pink:    ['#fdf2f8','#fce7f3','#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777','#be185d','#9d174d','#831843','#500724'],
    rose:    ['#fff1f2','#ffe4e6','#fecdd3','#fda4af','#fb7185','#f43f5e','#e11d48','#be123c','#9f1239','#881337','#4c0519'],
  };
  const _SHADES = [50,100,200,300,400,500,600,700,800,900,950];

  // Pre-compute palette with HSL for fast matching
  const _TW_PALETTE = [];
  for (const [name, hexes] of Object.entries(_PALETTE_DEF)) {
    hexes.forEach((hex, i) => {
      const [r,g,b] = hexToRgb(hex);
      const [h,s,l] = rgbToHsl(r,g,b);
      _TW_PALETTE.push({ tw: `${name}-${_SHADES[i]}`, r, g, b, h, s, l });
    });
  }
  // Include white/black as named entries
  _TW_PALETTE.push({ tw:'white',       r:255, g:255, b:255, h:0, s:0,  l:100 });
  _TW_PALETTE.push({ tw:'black',       r:0,   g:0,   b:0,   h:0, s:0,  l:0   });

  function rgbToHex(r, g, b) {
    const toHex = (c) => {
      const hex = Math.max(0, Math.min(255, c)).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function nearestColor(cssColor) {
    if (!cssColor) return null;
    if (cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') return 'transparent';

    const m = cssColor.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    const r = +m[1], g = +m[2], b = +m[3];
    const a = m[4] !== undefined ? +m[4] : 1;
    if (a === 0) return 'transparent';

    if (r === 255 && g === 255 && b === 255) return 'white';
    if (r === 0   && g === 0   && b === 0)   return 'black';

    const [h, s, l] = rgbToHsl(r, g, b);
    let best = null, bestScore = Infinity;

    for (const c of _TW_PALETTE) {
      let dh = Math.abs(h - c.h);
      if (dh > 180) dh = 360 - dh;
      const ds = Math.abs(s - c.s);
      const dl = Math.abs(l - c.l);

      const avgSat = (s + c.s) / 2;
      const hueInfluence = avgSat / 100;

      const score = dl * 2.5 + ds * 1.2 + (dh / 180) * 100 * hueInfluence * 0.8;

      if (score < bestScore) { bestScore = score; best = c.tw; }
    }
    return best;
  }

  function colorToTailwind(cssColor, prefix) {
    if (!cssColor) return '';
    const m = cssColor.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return '';
    const r = +m[1], g = +m[2], b = +m[3];
    const a = m[4] !== undefined ? +m[4] : 1;
    if (a === 0) return `${prefix}-transparent`;

    const colorToken = nearestColor(cssColor);
    if (!colorToken) return '';
    if (colorToken === 'transparent') return `${prefix}-transparent`;

    // Calculate Euclidean distance to the matched Tailwind color.
    // If it's too high, fallback to Tailwind arbitrary hex value to preserve exact colors.
    let bestRgbDist = 0;
    const match = _TW_PALETTE.find(x => x.tw === colorToken);
    if (match) {
      bestRgbDist = Math.sqrt((r - match.r)**2 + (g - match.g)**2 + (b - match.b)**2);
    }

    let baseClass = '';
    if (bestRgbDist > 16 && colorToken !== 'white' && colorToken !== 'black') {
      // Use exact arbitrary hex value
      const hex = rgbToHex(r, g, b);
      baseClass = `${prefix}-[${hex}]`;
    } else {
      baseClass = `${prefix}-${colorToken}`;
    }

    if (a < 1) {
      const alphaPercent = Math.round(a * 100);
      const opScale = [5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100];
      let bestOp = 100, bestDiff = Infinity;
      for (const op of opScale) {
        const diff = Math.abs(alphaPercent - op);
        if (diff < bestDiff) { bestDiff = diff; bestOp = op; }
      }
      if (bestOp < 100) {
        if (selectedTailwindVersion === 'v4') {
          return `${baseClass}/${bestOp}`;
        } else {
          return `${baseClass} ${prefix}-opacity-${bestOp}`;
        }
      }
    }
    return baseClass;
  }

  let selectedElHoverClasses = [];
  let selectedElDefaultStyles = null;

  function captureHoverStyles() {
    if (!selectedEl || !selectedElDefaultStyles) return;
    try {
      const sHover = extractStyles(selectedEl);
      const defaultClasses = stylesToTailwind(selectedElDefaultStyles);
      const hoverClasses = stylesToTailwind(sHover);
      
      const newClasses = hoverClasses.filter(c => !defaultClasses.includes(c));
      let updated = false;
      newClasses.forEach(c => {
        const hoverCls = `hover:${c}`;
        if (!selectedElHoverClasses.includes(hoverCls)) {
          selectedElHoverClasses.push(hoverCls);
          updated = true;
        }
      });
      
      if (updated) {
        populate(selectedEl);
      }
    } catch(e) {}
  }

  // ─── SPACING SCALE ────────────────────────────────────────────
  // Full Tailwind v3 spacing: [px value, tw token]
  const _SP_SCALE = [
    [0,'0'],[1,'px'],[2,'0.5'],[4,'1'],[6,'1.5'],[8,'2'],
    [10,'2.5'],[12,'3'],[14,'3.5'],[16,'4'],[20,'5'],[24,'6'],
    [28,'7'],[32,'8'],[36,'9'],[40,'10'],[44,'11'],[48,'12'],
    [56,'14'],[64,'16'],[80,'20'],[96,'24'],[112,'28'],[128,'32'],
    [144,'36'],[160,'40'],[176,'44'],[192,'48'],[208,'52'],
    [224,'56'],[240,'60'],[256,'64'],[288,'72'],[320,'80'],[384,'96'],
  ];

  // Nearest-neighbor spacing: returns tw token or null
  function nearestSpacing(cssVal) {
    if (!cssVal || cssVal === 'auto') return null;
    if (cssVal === '0px' || cssVal === '0') return '0';
    if (cssVal === '1px') return 'px';
    const px = parseFloat(cssVal);
    if (isNaN(px) || px < 0) return null;
    let best = null, bestDiff = Infinity;
    for (const [spPx, token] of _SP_SCALE) {
      const diff = Math.abs(px - spPx);
      if (diff < bestDiff) { bestDiff = diff; best = token; }
    }
    // Increase tolerance to match spacing values cleanly (up to 4px deviation or 30% difference)
    return bestDiff <= Math.max(4, px * 0.30) ? best : null;
  }

  function resolveSpacingVal(val, sidePrefix, prefix) {
    if (!val || val === 'auto' || val === '0px' || val === '0') return null;
    const px = parseFloat(val);
    if (isNaN(px) || px <= 0) return null;
    const token = nearestSpacing(val);
    if (token) {
      let tokenPx = parseFloat(token) * 4;
      if (token === 'px') tokenPx = 1;
      else if (token === '0.5') tokenPx = 2;
      else if (token === '1.5') tokenPx = 6;
      else if (token === '2.5') tokenPx = 10;
      else if (token === '3.5') tokenPx = 14;
      
      if (Math.abs(px - tokenPx) <= 1) {
        return `${prefix}${sidePrefix}-${token}`;
      }
    }
    return `${prefix}${sidePrefix}-[${val}]`;
  }

  // Helper to map 4 sides of spacing (padding or margin) cleanly
  function mapSidesToTailwind(topPx, rightPx, bottomPx, leftPx, prefix) {
    const tVal = parseFloat(topPx) || 0;
    const rVal = parseFloat(rightPx) || 0;
    const bVal = parseFloat(bottomPx) || 0;
    const lVal = parseFloat(leftPx) || 0;

    const verticalMatch = Math.abs(tVal - bVal) <= 1;
    const horizontalMatch = Math.abs(rVal - lVal) <= 1;
    const allMatch = verticalMatch && horizontalMatch && Math.abs(tVal - rVal) <= 1;

    const classes = [];

    if (allMatch && tVal > 0) {
      const cls = resolveSpacingVal(topPx, '', prefix);
      if (cls) classes.push(cls);
    } else {
      if (verticalMatch && tVal > 0) {
        const cls = resolveSpacingVal(topPx, 'y', prefix);
        if (cls) classes.push(cls);
      } else {
        const clsT = resolveSpacingVal(topPx, 't', prefix);
        if (clsT) classes.push(clsT);
        const clsB = resolveSpacingVal(bottomPx, 'b', prefix);
        if (clsB) classes.push(clsB);
      }

      if (horizontalMatch && rVal > 0) {
        const cls = resolveSpacingVal(rightPx, 'x', prefix);
        if (cls) classes.push(cls);
      } else {
        const clsL = resolveSpacingVal(leftPx, 'l', prefix);
        if (clsL) classes.push(clsL);
        const clsR = resolveSpacingVal(rightPx, 'r', prefix);
        if (clsR) classes.push(clsR);
      }
    }
    return classes;
  }

  // ─── FONT SIZE SCALE ──────────────────────────────────────────
  // Exact Tailwind v3 font-size values (user spec)
  const _FS_SCALE = [
    [12,'text-xs'],[14,'text-sm'],[16,'text-base'],[18,'text-lg'],
    [20,'text-xl'],[24,'text-2xl'],[30,'text-3xl'],[36,'text-4xl'],
    [48,'text-5xl'],[60,'text-6xl'],[72,'text-7xl'],[96,'text-8xl'],[128,'text-9xl'],
  ];

  function nearestFontSize(cssVal) {
    if (!cssVal) return null;
    const px = parseFloat(cssVal);
    if (isNaN(px)) return null;
    let best = null, bestDiff = Infinity;
    for (const [fpx, cls] of _FS_SCALE) {
      const diff = Math.abs(px - fpx);
      if (diff < bestDiff) { bestDiff = diff; best = cls; }
    }
    // Generous tolerance: within 2px or 15%
    return bestDiff <= Math.max(2, px * 0.15) ? best : null;
  }

  // ─── BORDER RADIUS SCALE ─────────────────────────────────────
  // Exact Tailwind v3 border-radius values (user spec)
  const _BR_SCALE = [
    [0,null],[2,'rounded-sm'],[4,'rounded'],[6,'rounded-md'],
    [8,'rounded-lg'],[12,'rounded-xl'],[16,'rounded-2xl'],[24,'rounded-3xl'],
  ];

  function nearestRadius(cssVal) {
    if (!cssVal || cssVal === '0px' || cssVal === '0') return null;
    if (parseFloat(cssVal) >= 9999 || cssVal === '50%' || cssVal === '100%') return 'rounded-full';
    const px = parseFloat(cssVal);
    if (isNaN(px)) return null;
    let best = null, bestDiff = Infinity;
    for (const [rpx, cls] of _BR_SCALE) {
      const diff = Math.abs(px - rpx);
      if (diff < bestDiff) { bestDiff = diff; best = cls; }
    }
    return best;
  }

  // ─── FONT WEIGHT ─────────────────────────────────────────────
  const FW = {
    '100':'font-thin','200':'font-extralight','300':'font-light',
    '400':'font-normal','500':'font-medium','600':'font-semibold',
    '700':'font-bold','800':'font-extrabold','900':'font-black',
  };

  // ═══════════════════════════════════════════════════════════════
  // STYLE EXTRACTION & TAILWIND CONVERSION
  // ═══════════════════════════════════════════════════════════════

  function extractStyles(el) {
    const cs = window.getComputedStyle(el);
    return {
      fontFamily: cs.fontFamily, fontSize: cs.fontSize,
      fontWeight: cs.fontWeight, lineHeight: cs.lineHeight,
      color: cs.color, backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
      marginTop: cs.marginTop, marginRight: cs.marginRight,
      marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
      borderRadius: cs.borderRadius,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      borderWidth: cs.borderWidth, borderColor: cs.borderColor,
      borderStyle: cs.borderStyle, border: cs.border,
      borderTopWidth: cs.borderTopWidth, borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth, borderLeftWidth: cs.borderLeftWidth,
      borderTopColor: cs.borderTopColor, borderRightColor: cs.borderRightColor,
      borderBottomColor: cs.borderBottomColor, borderLeftColor: cs.borderLeftColor,
      borderTopStyle: cs.borderTopStyle, borderRightStyle: cs.borderRightStyle,
      borderBottomStyle: cs.borderBottomStyle, borderLeftStyle: cs.borderLeftStyle,
      width: cs.width, height: cs.height,
      display: cs.display, flexDirection: cs.flexDirection,
      alignItems: cs.alignItems, justifyContent: cs.justifyContent,
      gap: cs.gap, boxShadow: cs.boxShadow, opacity: cs.opacity,
      position: cs.position, overflow: cs.overflow,
      textAlign: cs.textAlign, cursor: cs.cursor,
      textDecoration: cs.textDecoration, textTransform: cs.textTransform,
      letterSpacing: cs.letterSpacing,
      transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration,
      zIndex: cs.zIndex,
      top: cs.top, right: cs.right, bottom: cs.bottom, left: cs.left,
      gridTemplateColumns: cs.gridTemplateColumns,
      gridTemplateRows: cs.gridTemplateRows,
      gridColumn: cs.gridColumn,
      gridColumnStart: cs.gridColumnStart,
      gridColumnEnd: cs.gridColumnEnd,
      visibility: cs.visibility,
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      aspectRatio: cs.aspectRatio,
      backgroundClip: (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') ? 'text' : (cs.backgroundClip || cs.webkitBackgroundClip),
      minHeight: cs.minHeight,
      maxHeight: cs.maxHeight,
      minWidth: cs.minWidth,
      maxWidth: cs.maxWidth,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      flexWrap: cs.flexWrap,
      flexShrink: cs.flexShrink,
      flexGrow: cs.flexGrow,
    };
  }

  function getPseudoStyles(el, type) {
    if (!el || !el.ownerDocument) return null;
    const windowObj = el.ownerDocument.defaultView || window;
    const cs = windowObj.getComputedStyle(el, type);
    if (!cs) return null;
    const content = cs.content;
    if (!content || content === 'none' || content === 'normal' || content === '') return null;
    const cleanContent = content.trim().replace(/^['"]|['"]$/g, '');
    return {
      content: cleanContent,
      fontFamily: cs.fontFamily, fontSize: cs.fontSize,
      fontWeight: cs.fontWeight, lineHeight: cs.lineHeight,
      color: cs.color, backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
      marginTop: cs.marginTop, marginRight: cs.marginRight,
      marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
      borderRadius: cs.borderRadius,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      borderWidth: cs.borderWidth, borderColor: cs.borderColor,
      borderStyle: cs.borderStyle, border: cs.border,
      borderTopWidth: cs.borderTopWidth, borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth, borderLeftWidth: cs.borderLeftWidth,
      borderTopColor: cs.borderTopColor, borderRightColor: cs.borderRightColor,
      borderBottomColor: cs.borderBottomColor, borderLeftColor: cs.borderLeftColor,
      borderTopStyle: cs.borderTopStyle, borderRightStyle: cs.borderRightStyle,
      borderBottomStyle: cs.borderBottomStyle, borderLeftStyle: cs.borderLeftStyle,
      width: cs.width, height: cs.height,
      display: cs.display || 'inline-block',
      flexDirection: cs.flexDirection,
      alignItems: cs.alignItems, justifyContent: cs.justifyContent,
      gap: cs.gap, boxShadow: cs.boxShadow, opacity: cs.opacity,
      position: cs.position || 'absolute',
      overflow: cs.overflow,
      textAlign: cs.textAlign, cursor: cs.cursor,
      textDecoration: cs.textDecoration, textTransform: cs.textTransform,
      letterSpacing: cs.letterSpacing,
      transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration,
      zIndex: cs.zIndex,
      top: cs.top, right: cs.right, bottom: cs.bottom, left: cs.left,
      gridTemplateColumns: cs.gridTemplateColumns,
      gridTemplateRows: cs.gridTemplateRows,
      gridColumn: cs.gridColumn,
      gridColumnStart: cs.gridColumnStart,
      gridColumnEnd: cs.gridColumnEnd,
      visibility: cs.visibility,
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      aspectRatio: cs.aspectRatio,
      backgroundClip: (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') ? 'text' : (cs.backgroundClip || cs.webkitBackgroundClip),
    };
  }

  // ─── GRADIENT PARSER ─────────────────────────────────────────
  // Parse a CSS linear-gradient into Tailwind bg-gradient-* classes.
  // Returns { classes: [], inlineStyle: string } where classes is a
  // Tailwind array (may be empty) and inlineStyle is the raw CSS value
  // to use as a style prop fallback.
  function parseGradientToTailwind(bgImage) {
    if (!bgImage || bgImage === 'none') return null;
    const isLinear = bgImage.startsWith('linear-gradient');
    const isRadial = bgImage.startsWith('radial-gradient');
    if (!isLinear && !isRadial) return null;

    // Always provide the raw CSS as inline fallback
    const result = { classes: [], inlineStyle: bgImage };

    if (isLinear) {
      // Try to extract direction + color stops
      const inner = bgImage.replace(/^linear-gradient\(/, '').replace(/\)$/, '');
      const parts = splitGradientParts(inner);
      if (parts.length < 2) return result;

      // Detect direction token
      const dirMap = {
        'to right':         'bg-gradient-to-r',
        'to left':          'bg-gradient-to-l',
        'to bottom':        'bg-gradient-to-b',
        'to top':           'bg-gradient-to-t',
        'to bottom right':  'bg-gradient-to-br',
        'to bottom left':   'bg-gradient-to-bl',
        'to top right':     'bg-gradient-to-tr',
        'to top left':      'bg-gradient-to-tl',
      };

      let dirClass = 'bg-gradient-to-r'; // default
      let colorParts = parts;

      const firstPart = parts[0].trim().toLowerCase();
      const matchedDir = Object.keys(dirMap).find(d => firstPart === d || firstPart.startsWith(d));
      if (matchedDir) {
        dirClass = dirMap[matchedDir];
        colorParts = parts.slice(1);
      } else if (/^\d/.test(firstPart) || firstPart.endsWith('deg') || firstPart.endsWith('turn') || firstPart.endsWith('rad')) {
        // Angle — keep as inline, but still emit gradient direction as closest approximation
        const deg = parseFloat(firstPart);
        if (!isNaN(deg)) {
          if      (deg < 23)  dirClass = 'bg-gradient-to-t';
          else if (deg < 68)  dirClass = 'bg-gradient-to-tr';
          else if (deg < 113) dirClass = 'bg-gradient-to-r';
          else if (deg < 158) dirClass = 'bg-gradient-to-br';
          else if (deg < 203) dirClass = 'bg-gradient-to-b';
          else if (deg < 248) dirClass = 'bg-gradient-to-bl';
          else if (deg < 293) dirClass = 'bg-gradient-to-l';
          else if (deg < 338) dirClass = 'bg-gradient-to-tl';
          else                dirClass = 'bg-gradient-to-t';
        }
        colorParts = parts.slice(1);
      }

      result.classes.push(dirClass);

      // Extract color stops (strip percentage markers, resolve rgba/rgb)
      const stops = colorParts.map(p => p.trim().replace(/\s+[\d.]+%$/, '').trim());
      const stopPrefixes = ['from', 'via', 'to'];
      stops.slice(0, 3).forEach((stop, i) => {
        const tw = colorToTailwind(stop, stopPrefixes[i]);
        if (tw) result.classes.push(tw);
      });
    }

    // For radial gradients just provide inline style, no meaningful Tailwind mapping
    return result;
  }

  // Split gradient parts respecting nested parentheses (for rgba() inside stops)
  function splitGradientParts(str) {
    const parts = [];
    let depth = 0, current = '';
    for (const ch of str) {
      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
      else { current += ch; }
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  function stylesToTailwind(s, el) {
    if (el && !el.isConnected) {
      const existing = (el.getAttribute('class') || '')
        .split(/\s+/)
        .filter(c => c && !c.startsWith('ss-') && !c.includes('__stylesnoop'));
      if (existing.length > 0) return existing;
    }
    const cls = [];
    const disp = s.display;
    let activeDisp = disp;
    // Smart override: if container has mixed child types (an SVG icon + text),
    // force it to flex row layout to keep icons and text from wrapping vertically.
    const hasSvgChild = el && Array.from(el.children || []).some(c => c.tagName.toLowerCase() === 'svg');
    const hasTextContent = el && el.textContent && el.textContent.trim().length > 0;
    const isNavOrBtnLike = el && (el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'LI');
    if (isNavOrBtnLike && hasSvgChild && hasTextContent && disp !== 'flex' && disp !== 'inline-flex') {
      activeDisp = 'flex';
    }

    if (activeDisp === 'flex') cls.push('flex');
    else if (activeDisp === 'inline-flex') cls.push('inline-flex');
    else if (activeDisp === 'grid') {
      cls.push('grid');
      const cols = s.gridTemplateColumns;
      if (cols && cols !== 'none') {
        const parts = cols.trim().split(/\s+/);
        if (parts.length > 1 && parts.length <= 12) {
          cls.push(`grid-cols-${parts.length}`);
        } else if (cols.includes('repeat')) {
          const m = cols.match(/repeat\((\d+)/);
          if (m && m[1]) {
            cls.push(`grid-cols-${m[1]}`);
          }
        }
      }
    }
    else if (activeDisp === 'block') cls.push('block');
    else if (activeDisp === 'inline-block') cls.push('inline-block');
    else if (activeDisp === 'inline') cls.push('inline');
    else if (activeDisp === 'none') cls.push('hidden');

    if (activeDisp === 'flex' || activeDisp === 'inline-flex') {
      const fd = s.flexDirection;
      if (fd === 'column') cls.push('flex-col');
      else if (fd === 'row-reverse') cls.push('flex-row-reverse');
      else if (fd === 'column-reverse') cls.push('flex-col-reverse');
      // If we forced flex, make sure it is flex-row (the default)
      else if (isNavOrBtnLike && hasSvgChild && hasTextContent && disp !== 'flex') {
        // default is row
      }

      const ai = s.alignItems;
      if (ai === 'flex-start' || ai === 'start') cls.push('items-start');
      else if (ai === 'center' || (isNavOrBtnLike && hasSvgChild && hasTextContent)) cls.push('items-center');
      else if (ai === 'flex-end' || ai === 'end') cls.push('items-end');
      else if (ai === 'baseline') cls.push('items-baseline');
      else if (el && el.tagName === 'BUTTON') cls.push('items-center');

      const jc = s.justifyContent;
      if (jc === 'flex-start' || jc === 'start') cls.push('justify-start');
      else if (jc === 'center') cls.push('justify-center');
      else if (jc === 'flex-end' || jc === 'end') cls.push('justify-end');
      else if (jc === 'space-between') cls.push('justify-between');
      else if (jc === 'space-around') cls.push('justify-around');
      else if (jc === 'space-evenly') cls.push('justify-evenly');

      const gapToken = nearestSpacing(s.gap);
      if (gapToken && gapToken !== '0') {
        const px = parseFloat(s.gap);
        let tokenPx = parseFloat(gapToken) * 4;
        if (gapToken === 'px') tokenPx = 1;
        else if (gapToken === '0.5') tokenPx = 2;
        else if (gapToken === '1.5') tokenPx = 6;
        else if (gapToken === '2.5') tokenPx = 10;
        else if (gapToken === '3.5') tokenPx = 14;
        
        if (Math.abs(px - tokenPx) <= 1) {
          cls.push(`gap-${gapToken}`);
        } else {
          cls.push(`gap-[${s.gap}]`);
        }
      } else if (s.gap && s.gap !== 'normal' && s.gap !== '0px' && s.gap !== '0') {
        cls.push(`gap-[${s.gap}]`);
      }
      // NOTE: No phantom gap default — only emit gap when actually specified
    }

    // Position
    const pos = s.position;
    if (pos === 'relative') cls.push('relative');
    else if (pos === 'absolute') cls.push('absolute');
    else if (pos === 'fixed') cls.push('fixed');
    else if (pos === 'sticky') cls.push('sticky');
 
    if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') {
      const topT = nearestSpacing(s.top),    rightT = nearestSpacing(s.right);
      const bottomT = nearestSpacing(s.bottom), leftT = nearestSpacing(s.left);
      
      const wTokenLocal = nearestSpacing(s.width);
      const hTokenLocal = nearestSpacing(s.height);
      let shouldSkipHeightLocal = false;
      if (el && el.tagName) {
        const tagLow = el.tagName.toLowerCase();
        const containerTags = new Set(['div', 'ul', 'ol', 'li', 'nav', 'aside', 'header', 'footer', 'main', 'section', 'form', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a']);
        // For positioned elements, we DO want to include height
        shouldSkipHeightLocal = containerTags.has(tagLow) && pos !== 'absolute' && pos !== 'fixed';
      }

      const leftVal = s.left && s.left !== 'auto' ? parseFloat(s.left) : Infinity;
      const rightVal = s.right && s.right !== 'auto' ? parseFloat(s.right) : Infinity;
      const topVal = s.top && s.top !== 'auto' ? parseFloat(s.top) : Infinity;
      const bottomVal = s.bottom && s.bottom !== 'auto' ? parseFloat(s.bottom) : Infinity;

      // Map horizontal positioning: use right if it is closer to the right edge
      if (rightVal !== Infinity && (rightVal < leftVal || leftVal === Infinity)) {
        if (s.right === '0px') cls.push('right-0');
        else if (rightT) cls.push(`right-${rightT}`);
        else if (s.right !== 'auto') cls.push(`right-[${s.right}]`);
      } else if (leftVal !== Infinity) {
        if (s.left === '0px') cls.push('left-0');
        else if (leftT) cls.push(`left-${leftT}`);
        else if (s.left !== 'auto') cls.push(`left-[${s.left}]`);
      }

      // Map vertical positioning: use bottom if it is closer to the bottom edge
      if (bottomVal !== Infinity && (bottomVal < topVal || topVal === Infinity)) {
        if (s.bottom === '0px') cls.push('bottom-0');
        else if (bottomT) cls.push(`bottom-${bottomT}`);
        else if (s.bottom !== 'auto') cls.push(`bottom-[${s.bottom}]`);
      } else if (topVal !== Infinity) {
        if (s.top === '0px') cls.push('top-0');
        else if (topT) cls.push(`top-${topT}`);
        else if (s.top !== 'auto') cls.push(`top-[${s.top}]`);
      }
    }

    // Background — handle gradient first, fall back to solid color
    const gradientInfo = s.backgroundImage ? parseGradientToTailwind(s.backgroundImage) : null;
    if (gradientInfo && gradientInfo.classes.length > 0) {
      // Gradient: emit Tailwind gradient classes (inline style handled at JSX emit level)
      gradientInfo.classes.forEach(c => cls.push(c));
    } else {
      // Solid background color — HSL nearest match
      const bgClass = colorToTailwind(s.backgroundColor, 'bg');
      if (bgClass) cls.push(bgClass);
    }

    // Text color — HSL nearest match
    // If bg-clip text is active, ensure text-transparent is emitted regardless of color match
    if (s.backgroundClip && s.backgroundClip.includes('text')) {
      cls.push('text-transparent');
    } else {
      const textClass = colorToTailwind(s.color, 'text');
      if (textClass) cls.push(textClass);
    }

    // Font size — nearest Tailwind scale value
    const fsC = nearestFontSize(s.fontSize);
    if (fsC) cls.push(fsC);

    // Font weight
    const fwC = FW[s.fontWeight];
    if (fwC && fwC !== 'font-normal') cls.push(fwC);

    // Line height
    const hasOnlySvg = el && el.children && el.children.length === 1 && el.children[0].tagName.toLowerCase() === 'svg' && !(el.textContent || '').trim();
    if (s.lineHeight && s.lineHeight !== 'normal' && !hasOnlySvg) {
      const lh = parseFloat(s.lineHeight);
      if (!isNaN(lh)) {
        if (lh <= 1)      cls.push('leading-none');
        else if (lh <= 1.25) cls.push('leading-tight');
        else if (lh <= 1.375) cls.push('leading-snug');
        else if (lh <= 1.5)  cls.push('leading-normal');
        else if (lh <= 1.625) cls.push('leading-relaxed');
        else if (lh >= 2)    cls.push('leading-loose');
      }
    }

    // Text align
    if (s.textAlign === 'center') cls.push('text-center');
    else if (s.textAlign === 'right' || s.textAlign === 'end') cls.push('text-right');
    else if (s.textAlign === 'justify') cls.push('text-justify');

    // Text transform
    if (s.textTransform === 'uppercase') cls.push('uppercase');
    else if (s.textTransform === 'lowercase') cls.push('lowercase');
    else if (s.textTransform === 'capitalize') cls.push('capitalize');

    // Text decoration
    if (s.textDecoration) {
      if (s.textDecoration.includes('underline')) cls.push('underline');
      else if (s.textDecoration.includes('line-through')) cls.push('line-through');
      else if (s.textDecoration.includes('none')) cls.push('no-underline');
    }

    // Sizing (width / height)
    const wToken = nearestSpacing(s.width);
    let shouldSkipWidth = false;
    let isWFull = false;

    if (el && el.parentElement && el.nodeType === 1) {
      try {
        const parentStyle = window.getComputedStyle(el.parentElement);
        const parentPadding = parseFloat(parentStyle.paddingLeft || 0) + parseFloat(parentStyle.paddingRight || 0);
        const parentContentW = el.parentElement.clientWidth - parentPadding;
        const elW = el.offsetWidth;
        if (parentContentW > 0 && elW > 0 && Math.abs(parentContentW - elW) <= 16) {
          isWFull = true;
        }
      } catch (_) {}
    }

    if (el && el.tagName) {
      const tagLow = el.tagName.toLowerCase();
      const inlineTextTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'li', 'button']);
      const isAbsoluteOrFixed = s.position === 'absolute' || s.position === 'fixed';
      const isCustomElement = tagLow.includes('-');
      const hasContentText = el.textContent && el.textContent.trim().length > 0;
      
      const hasExplicitWidth = (el.style && el.style.width) || (s.width && s.width !== 'auto');
      shouldSkipWidth = (inlineTextTags.has(tagLow) || (isCustomElement && (s.display === 'inline' || s.display === 'inline-block')) || hasContentText) && !isAbsoluteOrFixed && !hasExplicitWidth && !isWFull;
      
      const numericWidth = parseFloat(s.width);
      if (!isNaN(numericWidth) && numericWidth > 600 && !isAbsoluteOrFixed) {
        cls.push('w-full');
        cls.push('max-w-7xl');
        cls.push('mx-auto');
        shouldSkipWidth = true;
      }
    }

    if (isWFull && !shouldSkipWidth) {
      cls.push('w-full');
    } else if (wToken && wToken !== '0' && !shouldSkipWidth) {
      cls.push(`w-${wToken}`);
    } else if (s.width === '100%') {
      cls.push('w-full');
    } else if (s.width === '100vw') {
      cls.push('w-screen');
    } else if (s.width === 'min-content') {
      cls.push('w-min');
    } else if (s.width === 'max-content') {
      cls.push('w-max');
    } else if (s.width === 'fit-content') {
      cls.push('w-fit');
    } else if (s.width && s.width !== 'auto' && !shouldSkipWidth) {
      cls.push(`w-[${s.width}]`);
    }

    const hToken = nearestSpacing(s.height);
    let shouldSkipHeight = false;
    if (el && el.tagName) {
      const tagLow = el.tagName.toLowerCase();
      const containerTags = new Set(['div', 'ul', 'ol', 'li', 'nav', 'aside', 'header', 'footer', 'main', 'section', 'form', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a']);
      const isAbsoluteOrFixedOrRelative = s.position === 'absolute' || s.position === 'fixed' || s.position === 'relative';
      const isCustomElement = tagLow.includes('-');
      shouldSkipHeight = (containerTags.has(tagLow) || isCustomElement) && !isAbsoluteOrFixedOrRelative;
    }
    if (hToken && hToken !== '0' && !shouldSkipHeight) cls.push(`h-${hToken}`);
    else if (s.height === '100%') cls.push('h-full');
    else if (s.height === '100vh') cls.push('h-screen');
    else if (s.height === 'min-content') cls.push('h-min');
    else if (s.height === 'max-content') cls.push('h-max');
    else if (s.height === 'fit-content') cls.push('h-fit');
    else if (s.height && s.height !== 'auto' && !shouldSkipHeight) {
      cls.push(`h-[${s.height}]`);
    }


    // Letter spacing
    if (s.letterSpacing && s.letterSpacing !== 'normal') {
      const ls = parseFloat(s.letterSpacing);
      if (!isNaN(ls)) {
        if (ls <= -0.05)      cls.push('tracking-tighter');
        else if (ls <= -0.025) cls.push('tracking-tight');
        else if (ls <= 0)      cls.push('tracking-normal');
        else if (ls <= 0.025)  cls.push('tracking-wide');
        else if (ls <= 0.05)   cls.push('tracking-wider');
        else                   cls.push('tracking-widest');
      }
    }

    // Padding — fuzzy compound mapping
    const paddingClasses = mapSidesToTailwind(s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, 'p');
    paddingClasses.forEach(c => cls.push(c));

    // Margin — fuzzy compound mapping
    const marginClasses = mapSidesToTailwind(s.marginTop, s.marginRight, s.marginBottom, s.marginLeft, 'm');
    marginClasses.forEach(c => cls.push(c));

    // Border radius — nearest Tailwind rounded-* value
    // Use the most uniform radius value (borderRadius > individual corners)
    const brRaw = s.borderRadius && s.borderRadius !== '0px'
      ? s.borderRadius.split(' ')[0]  // take first value if compound
      : s.borderTopLeftRadius;
    const brC = nearestRadius(brRaw);
    if (brC) cls.push(brC);

    // Border
    const sides = [
      { name: 't', width: s.borderTopWidth, color: s.borderTopColor, style: s.borderTopStyle },
      { name: 'r', width: s.borderRightWidth, color: s.borderRightColor, style: s.borderRightStyle },
      { name: 'b', width: s.borderBottomWidth, color: s.borderBottomColor, style: s.borderBottomStyle },
      { name: 'l', width: s.borderLeftWidth, color: s.borderLeftColor, style: s.borderLeftStyle }
    ];

    const uniformWidth = s.borderTopWidth === s.borderRightWidth && s.borderRightWidth === s.borderBottomWidth && s.borderBottomWidth === s.borderLeftWidth;
    const uniformColor = s.borderTopColor === s.borderRightColor && s.borderRightColor === s.borderBottomColor && s.borderBottomColor === s.borderLeftColor;
    const uniformStyle = s.borderTopStyle === s.borderRightStyle && s.borderRightStyle === s.borderBottomStyle && s.borderBottomStyle === s.borderLeftStyle;

    if (uniformWidth && uniformColor && uniformStyle) {
      if (s.borderTopWidth && s.borderTopWidth !== '0px') {
        const bw = parseFloat(s.borderTopWidth);
        if (bw === 1)      cls.push('border');
        else if (bw === 2) cls.push('border-2');
        else if (bw === 4) cls.push('border-4');
        else if (bw === 8) cls.push('border-8');
        else if (bw > 0)   cls.push(`border-[${s.borderTopWidth}]`);
        const borderClass = colorToTailwind(s.borderTopColor, 'border');
        if (borderClass) cls.push(borderClass);
        if (s.borderTopStyle === 'dashed') cls.push('border-dashed');
        if (s.borderTopStyle === 'dotted') cls.push('border-dotted');
      }
    } else {
      sides.forEach(side => {
        if (side.width && side.width !== '0px') {
          const bw = parseFloat(side.width);
          const prefix = `border-${side.name}`;
          if (bw === 1)      cls.push(prefix);
          else if (bw === 2) cls.push(`${prefix}-2`);
          else if (bw === 4) cls.push(`${prefix}-4`);
          else if (bw === 8) cls.push(`${prefix}-8`);
          else if (bw > 0)   cls.push(`${prefix}-[${side.width}]`);
          const borderClass = colorToTailwind(side.color, 'border');
          if (borderClass) cls.push(borderClass);
          if (side.style === 'dashed') cls.push('border-dashed');
          if (side.style === 'dotted') cls.push('border-dotted');
        }
      });
    }

    // Box shadow — classify by spread/opacity keywords
    const sh = s.boxShadow;
    if (sh && sh !== 'none') {
      // Parse first numeric group to estimate shadow scale
      const nums = sh.match(/[\d.]+(?:px)?/g) || [];
      const spread = nums[2] ? parseFloat(nums[2]) : 0;
      const blur   = nums[1] ? parseFloat(nums[1]) : 0;
      if (blur <= 2 && spread <= 1)       cls.push('shadow-sm');
      else if (blur <= 6  && spread <= 3) cls.push('shadow');
      else if (blur <= 15 && spread <= 6) cls.push('shadow-md');
      else if (blur <= 25)                cls.push('shadow-lg');
      else if (blur <= 50)                cls.push('shadow-xl');
      else if (blur > 50 || spread > 0)   cls.push('shadow-2xl');
      else {
        const cleanShadow = sh.replace(/\s+/g, '_');
        cls.push(`shadow-[${cleanShadow}]`);
      }
    }

    // Grid Column Span mapping
    if (s.gridColumn && s.gridColumn !== 'auto') {
      const gc = s.gridColumn;
      if (gc.includes('1 / -1')) {
        cls.push('col-span-full');
      } else {
        const m = gc.match(/span\s+(\d+)/);
        if (m && m[1]) {
          cls.push(`col-span-${m[1]}`);
        } else {
          const parts = gc.split('/').map(p => parseInt(p.trim(), 10));
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            const span = parts[1] - parts[0];
            if (span > 0 && span <= 12) {
              cls.push(`col-span-${span}`);
            }
          }
        }
      }
    } else if (s.gridColumnStart && s.gridColumnEnd) {
      const start = parseInt(s.gridColumnStart, 10);
      const end = parseInt(s.gridColumnEnd, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const span = end - start;
        if (span > 0 && span <= 12) {
          cls.push(`col-span-${span}`);
        }
      } else if (s.gridColumnEnd === '-1' || s.gridColumnEnd === 'span -1') {
        cls.push('col-span-full');
      }
    }

    // Visibility
    if (s.visibility === 'hidden') {
      cls.push('invisible');
    }

    // Overflow
    if (s.overflow === 'hidden') cls.push('overflow-hidden');
    else if (s.overflow === 'auto') cls.push('overflow-auto');
    else if (s.overflow === 'scroll') cls.push('overflow-scroll');
    // Overflow X / Y (only when asymmetric)
    if (s.overflowX && s.overflowY && s.overflowX !== s.overflowY) {
      if (s.overflowX === 'hidden') cls.push('overflow-x-hidden');
      else if (s.overflowX === 'auto') cls.push('overflow-x-auto');
      else if (s.overflowX === 'scroll') cls.push('overflow-x-scroll');
      if (s.overflowY === 'hidden') cls.push('overflow-y-hidden');
      else if (s.overflowY === 'auto') cls.push('overflow-y-auto');
      else if (s.overflowY === 'scroll') cls.push('overflow-y-scroll');
    }

    // Min / Max sizing
    if (s.minHeight && s.minHeight !== '0px' && s.minHeight !== 'auto') {
      if (s.minHeight === '100vh') cls.push('min-h-screen');
      else if (s.minHeight === '100%') cls.push('min-h-full');
      else {
        const mhT = nearestSpacing(s.minHeight);
        if (mhT) cls.push(`min-h-${mhT}`);
        else cls.push(`min-h-[${s.minHeight}]`);
      }
    }
    if (s.maxWidth && s.maxWidth !== 'none') {
      if (s.maxWidth === '100%') cls.push('max-w-full');
      else if (s.maxWidth === '100vw') cls.push('max-w-screen');
      else {
        const mwPx = parseFloat(s.maxWidth);
        const _MWS = [[320,'max-w-xs'],[384,'max-w-sm'],[448,'max-w-md'],[512,'max-w-lg'],
          [576,'max-w-xl'],[672,'max-w-2xl'],[768,'max-w-3xl'],[896,'max-w-4xl'],
          [1024,'max-w-5xl'],[1152,'max-w-6xl'],[1280,'max-w-7xl']];
        let mwBest = null, mwDiff = Infinity;
        for (const [px, cls2] of _MWS) {
          const d = Math.abs(mwPx - px);
          if (d < mwDiff) { mwDiff = d; mwBest = cls2; }
        }
        if (mwBest && mwDiff <= 16) cls.push(mwBest);
        else if (!isNaN(mwPx)) cls.push(`max-w-[${s.maxWidth}]`);
      }
    }

    // Flex wrap / grow / shrink
    if (s.flexWrap === 'wrap') cls.push('flex-wrap');
    else if (s.flexWrap === 'wrap-reverse') cls.push('flex-wrap-reverse');
    else if (s.flexWrap === 'nowrap' && s.display === 'flex') cls.push('flex-nowrap');
    if (s.flexGrow === '1') cls.push('grow');
    if (s.flexShrink === '0') cls.push('shrink-0');
    else if (s.flexShrink === '1' && s.display !== 'flex') cls.push('shrink'); // only if explicitly set

    // Backdrop Filter (blur)
    if (s.backdropFilter && s.backdropFilter.includes('blur(')) {
      const match = s.backdropFilter.match(/blur\(([^)]+)\)/);
      if (match && match[1]) {
        cls.push(`backdrop-blur-[${match[1]}]`);
      }
    }

    // Aspect Ratio
    if (s.aspectRatio && s.aspectRatio !== 'auto') {
      if (s.aspectRatio === '1 / 1' || s.aspectRatio === '1') cls.push('aspect-square');
      else if (s.aspectRatio === '16 / 9') cls.push('aspect-video');
      else {
        cls.push(`aspect-[${s.aspectRatio.replace(/\s+/g, '')}]`);
      }
    }

    // Background Clip (Text Gradient clipping support)
    if (s.backgroundClip && s.backgroundClip.includes('text')) {
      cls.push('bg-clip-text');
    }

    // Cursor
    if (s.cursor === 'pointer')     cls.push('cursor-pointer');
    else if (s.cursor === 'default') cls.push('cursor-default');
    else if (s.cursor === 'not-allowed') cls.push('cursor-not-allowed');

    // Opacity
    if (s.opacity && s.opacity !== '1') {
      const op = parseFloat(s.opacity);
      if      (op <= 0)    cls.push('opacity-0');
      else if (op <= 0.05) cls.push('opacity-5');
      else if (op <= 0.1)  cls.push('opacity-10');
      else if (op <= 0.20) cls.push('opacity-20');
      else if (op <= 0.25) cls.push('opacity-25');
      else if (op <= 0.30) cls.push('opacity-30');
      else if (op <= 0.40) cls.push('opacity-40');
      else if (op <= 0.50) cls.push('opacity-50');
      else if (op <= 0.60) cls.push('opacity-60');
      else if (op <= 0.70) cls.push('opacity-70');
      else if (op <= 0.75) cls.push('opacity-75');
      else if (op <= 0.80) cls.push('opacity-80');
      else if (op <= 0.90) cls.push('opacity-90');
      else                 cls.push('opacity-95');
    }

    // ── Transition ─────────────────────────────────────────────────
    // Map transitionProperty → semantic Tailwind utility,
    // then transitionDuration → duration-* token.
    if (s.transitionProperty && s.transitionProperty !== 'none') {
      const tp = s.transitionProperty.toLowerCase();
      let twTr = '';
      if (tp === 'all') {
        twTr = 'transition-all';
      } else if (/\bopacity\b/.test(tp) && !/(color|transform|shadow)/.test(tp)) {
        twTr = 'transition-opacity';
      } else if (/\btransform\b/.test(tp) && !/(color|opacity|shadow)/.test(tp)) {
        twTr = 'transition-transform';
      } else if (/box-shadow/.test(tp) && !/(color|opacity|transform)/.test(tp)) {
        twTr = 'transition-shadow';
      } else if (/(color|background-color|border-color|fill|stroke)/.test(tp) && !/(opacity|transform|shadow)/.test(tp)) {
        twTr = 'transition-colors';
      } else {
        twTr = 'transition';
      }
      cls.push(twTr);

      // Duration: parse first value (may be comma-separated for multiple properties)
      if (s.transitionDuration) {
        const rawDur = s.transitionDuration.split(',')[0].trim();
        let ms = 0;
        if (rawDur.endsWith('ms'))  ms = parseFloat(rawDur);
        else if (rawDur.endsWith('s')) ms = parseFloat(rawDur) * 1000;
        if (ms > 0) {
          const _DUR = [75, 100, 150, 200, 300, 500, 700, 1000];
          let bestDur = 150, bestDiff = Infinity;
          for (const d of _DUR) {
            const diff = Math.abs(ms - d);
            if (diff < bestDiff) { bestDiff = diff; bestDur = d; }
          }
          // Only emit if it's a non-default duration (150ms is Tailwind default, still emit for clarity)
          cls.push(`duration-${bestDur}`);
        }
      }
    }

    // ── Z-index ────────────────────────────────────────────────────
    // Skip 'auto' (computed default for non-positioned elements).
    // Map integer values to nearest Tailwind z-* token.
    // ── Z-index ────────────────────────────────────────────────────
    if (s.zIndex && s.zIndex !== 'auto') {
      const z = parseInt(s.zIndex, 10);
      if (!isNaN(z) && z >= 0) {
        const _Z = [0, 10, 20, 30, 40, 50];
        let bestZ = null, bestZDiff = Infinity;
        for (const zv of _Z) {
          const diff = Math.abs(z - zv);
          if (diff < bestZDiff) { bestZDiff = diff; bestZ = zv; }
        }
        // Use exact arbitrary value when > 4 away from a scale value (avoids z-10 for z=1)
        if (bestZDiff <= 4) {
          cls.push(`z-${bestZ}`);
        } else if (z > 0) {
          cls.push(`z-[${z}]`);
        }
      } else if (!isNaN(z) && z < 0) {
        cls.push(`-z-[${Math.abs(z)}]`);
      }
    }
    if (s.fontFamily) {
      const firstFont = s.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (firstFont && !['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica', 'arial'].includes(firstFont.toLowerCase())) {
        detectedFonts.add(firstFont);
      }
    }

    const interactiveCls = extractInteractiveClassesFast(el);
    if (interactiveCls.length > 0) {
      cls.push(...interactiveCls);
    }

    return cls;
  }

  // ═══════════════════════════════════════════════════════════════
  // ELEMENT METADATA
  // ═══════════════════════════════════════════════════════════════

  function getSelector(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = (typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).slice(0, 2).map(c => `.${c}`).join('')
      : '';
    return `${tag}${id}${cls}`;
  }

  function getLabel(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'a' || /\b(btn|button)\b/i.test(el.className)) return 'BUTTON';
    if (tag === 'img' || tag === 'svg' || tag === 'picture' || tag === 'video') return 'IMAGE';
    if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'span' || tag === 'strong' || tag === 'em') return 'TEXT';
    if (tag === 'section' || tag === 'main' || tag === 'header' || tag === 'footer' || tag === 'article' || tag === 'nav') return 'SECTION';
    return 'CARD';
  }

  function getPreviewText(el) {
    const t = el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : '';
    return t.length > 36 ? t.slice(0, 33) + '…' : t;
  }

  function labelClass(label) {
    if (['COMPONENT','SECTION'].includes(label)) return 'ss-badge--purple';
    if (['BUTTON','LINK','NAV'].includes(label)) return 'ss-badge--blue';
    if (['HEADING','TEXT'].includes(label)) return 'ss-badge--gray';
    if (['MEDIA','INPUT'].includes(label)) return 'ss-badge--orange';
    return 'ss-badge--purple';
  }

  // ═══════════════════════════════════════════════════════════════
  // JSX / COMPONENT GENERATOR
  // ═══════════════════════════════════════════════════════════════

  function elToJSX(el, indent, framework, depth, isInsideButton = false) {
    if (!el || indent > depth) return '';
    const pad = '  '.repeat(indent);
    const tag = el.tagName.toLowerCase();
    const isReact = framework.startsWith('React');
    const isVue   = framework === 'Vue 3';
    const attrCls = isReact ? 'className' : 'class';
    
    // Save original display style and override it if this is a descendant element
    // so that collapsed accordion/tab content is outputted as visible elements
    let originalDisplay = null;
    if (indent > 0 && el.style) {
      originalDisplay = el.style.display;
      if (window.getComputedStyle(el).display === 'none') {
        el.style.display = 'block';
      }
    }

    // ── SVG: emit Tailwind size + color classes, never inline styles ──
    if (tag === 'svg') {
      const cs  = window.getComputedStyle(el);
      const wTk = nearestSpacing(cs.width)  || '6';
      const hTk = nearestSpacing(cs.height) || '6';
      const textClass = colorToTailwind(cs.color, 'text');
      const svgCls = [
        `w-${wTk}`, `h-${hTk}`,
        textClass,
      ].filter(Boolean).join(' ');
      
      const viewBoxAttr = el.getAttribute('viewBox') ? ` viewBox="${el.getAttribute('viewBox')}"` : ' viewBox="0 0 24 24"';
      const fillAttr = el.getAttribute('fill') ? ` fill="${el.getAttribute('fill')}"` : ' fill="none"';
      const strokeAttr = el.getAttribute('stroke') ? ` stroke="${el.getAttribute('stroke')}"` : ' stroke="currentColor"';
      // Pass through stroke-width (important for icon sizing/style fidelity)
      const strokeWidthRaw = el.getAttribute('stroke-width');
      const strokeWidthAttr = strokeWidthRaw ? ` stroke-width="${strokeWidthRaw}"` : ' stroke-width="2"';
      const strokeLinecapRaw = el.getAttribute('stroke-linecap');
      const strokeLinecapAttr = strokeLinecapRaw ? ` stroke-linecap="${strokeLinecapRaw}"` : '';
      const strokeLinejoinRaw = el.getAttribute('stroke-linejoin');
      const strokeLinejoinAttr = strokeLinejoinRaw ? ` stroke-linejoin="${strokeLinejoinRaw}"` : '';
      
      const innerContent = el.innerHTML || '';
      const cleanedInner = cleanSvgInner(innerContent);
      return `${pad}<svg ${attrCls}="${svgCls}"${fillAttr}${strokeAttr}${strokeWidthAttr}${strokeLinecapAttr}${strokeLinejoinAttr}${viewBoxAttr}>\n${pad}  ${cleanedInner.trim().replace(/\n/g, '\n' + pad + '  ')}\n${pad}</svg>`;
    }

    // ── Image: only className, src, alt — no inline styles ──
    if (tag === 'img') {
      const styles = extractStyles(el);
      const computedW = parseFloat(styles.width);
      const computedH = parseFloat(styles.height);
      let src = el.getAttribute('src') || '/placeholder.jpg';
      
      // Filter out ad/analytics tracker pixels
      const isTracker = (computedW <= 1 && computedH <= 1) ||
                        src.includes('adsrvr.org') ||
                        src.includes('doubleclick.net') ||
                        src.includes('adnxs.com') ||
                        src.includes('bidr.io') ||
                        src.includes('analytics') ||
                        src.includes('telemetry') ||
                        src.includes('track') ||
                        src.includes('pixel');
      if (isTracker) return '';

      if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('//')) {
        try {
          src = new URL(src, window.location.href).href;
        } catch(_) {}
      }
      const alt = el.getAttribute('alt') || '';
      let twCls = stylesToTailwind(styles, el).join(' ');
      if (el === selectedEl && selectedElHoverClasses.length > 0) {
        twCls = [twCls, ...selectedElHoverClasses].join(' ');
      }
      const wTk = nearestSpacing(styles.width);
      const hTk = nearestSpacing(styles.height);
      const sizeCls = [wTk ? `w-${wTk}` : '', hTk ? `h-${hTk}` : ''].filter(Boolean).join(' ');
      const combined = [twCls, sizeCls].filter(Boolean).join(' ');
      return `${pad}<img src="${src}" alt="${alt}" ${attrCls}="${combined}" />`;
    }

    // ── Input: only className, type, placeholder — no inline styles ──
    if (tag === 'input') {
      const styles = extractStyles(el);
      let twCls  = stylesToTailwind(styles, el).join(' ');
      if (el === selectedEl && selectedElHoverClasses.length > 0) {
        twCls = [twCls, ...selectedElHoverClasses].join(' ');
      }
      const t   = el.getAttribute('type') || 'text';
      const ph  = el.getAttribute('placeholder') || '';
      const nm  = el.getAttribute('name') || '';
      const nameAttr = nm ? ` name="${nm}"` : '';
      return `${pad}<input type="${t}"${nameAttr} placeholder="${ph}" ${attrCls}="${twCls}" />`;
    }

    // ── All other elements ──
    if (tag === 'br') {
      return `${pad}<br />`;
    }

    if (tag === 'slot') {
      const host = el.getRootNode() ? el.getRootNode().host : null;
      const slotChildren = [];
      let nodes = [];
      if (host && el.assignedNodes) {
        nodes = el.assignedNodes({ flatten: true });
      }
      if (!nodes || nodes.length === 0) {
        nodes = Array.from(el.childNodes || []);
      }
      for (const child of nodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const txt = child.textContent.trim();
          if (txt) slotChildren.push(`${pad}${txt}`);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const c = elToJSX(child, indent, framework, depth, isInsideButton || tag === 'button');
          if (c) slotChildren.push(c);
        }
      }
      return slotChildren.join('\n');
    }

    const styles = extractStyles(el);
    let twCls  = stylesToTailwind(styles, el).join(' ');
    if (el === selectedEl && selectedElHoverClasses.length > 0) {
      twCls = [twCls, ...selectedElHoverClasses].join(' ');
    }

    // Gradient inline style fallback
    let gradientStyleAttr = '';
    const _gradInfo = styles.backgroundImage ? parseGradientToTailwind(styles.backgroundImage) : null;
    if (_gradInfo && _gradInfo.inlineStyle) {
      let _styleVal = '';
      if (isReact) {
        if (styles.backgroundClip && styles.backgroundClip.includes('text')) {
          _styleVal = `{{backgroundImage: ${JSON.stringify(_gradInfo.inlineStyle)}, WebkitBackgroundClip: 'text', backgroundClip: 'text'}}`;
        } else {
          _styleVal = `{{backgroundImage: ${JSON.stringify(_gradInfo.inlineStyle)}}}`;
        }
      } else {
        if (styles.backgroundClip && styles.backgroundClip.includes('text')) {
          _styleVal = `"background-image: ${_gradInfo.inlineStyle.replace(/"/g, "'")}; -webkit-background-clip: text; background-clip: text;"`;
        } else {
          _styleVal = `"background-image: ${_gradInfo.inlineStyle.replace(/"/g, "'")}"`;
        }
      }
      gradientStyleAttr = ` style=${_styleVal}`;
    }

    let jsxTag = tag;
    if (tag.includes('-')) {
      const disp = styles.display;
      jsxTag = (disp === 'inline' || disp === 'inline-block' || disp === 'inline-flex') ? 'span' : 'div';
    }
    if (isInsideButton && (jsxTag === 'div' || jsxTag === 'p' || jsxTag === 'section' || jsxTag === 'h1' || jsxTag === 'h2' || jsxTag === 'h3' || jsxTag === 'h4' || jsxTag === 'h5' || jsxTag === 'h6' || jsxTag === 'hgroup')) {
      jsxTag = 'span';
    }

    const beforeStyles = getPseudoStyles(el, '::before');
    const afterStyles = getPseudoStyles(el, '::after');
    const hasPseudo = !!(beforeStyles || afterStyles);

    const children = [];

    if (beforeStyles) {
      const mockPseudoEl = {
        tagName: 'span',
        nodeType: 1,
        childNodes: [],
        children: [],
        textContent: '',
        getAttribute: () => null,
        isConnected: false
      };
      const pseudoCls = stylesToTailwind(beforeStyles, mockPseudoEl).join(' ');
      const pseudoClassAttr = pseudoCls ? ` ${attrCls}="${pseudoCls}"` : '';
      const text = beforeStyles.content || '';
      children.push(`${pad}  <span${pseudoClassAttr}>${text}</span>`);
    }

    const nodesToTraverse = [];
    if (el.shadowRoot && el.shadowRoot.childNodes) {
      nodesToTraverse.push(...Array.from(el.shadowRoot.childNodes));
    } else {
      nodesToTraverse.push(...Array.from(el.childNodes || []));
    }

    for (let i = 0; i < nodesToTraverse.length; i++) {
      const child = nodesToTraverse[i];
      if (child.nodeType === Node.TEXT_NODE) {
        const txt = child.textContent.trim();
        if (txt) children.push(`${pad}  ${txt}`);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const ctag = child.tagName.toLowerCase();
        if (ctag === 'style' || ctag === 'script') continue;

        let run = [child];
        while (i + 1 < nodesToTraverse.length) {
          const nextChild = nodesToTraverse[i + 1];
          if (nextChild.nodeType === Node.ELEMENT_NODE && checkSimilarity(child, nextChild)) {
            run.push(nextChild);
            i++;
          } else {
            break;
          }
        }

        if (run.length >= 3) {
          const templateJSX = elToJSX(run[0], indent + 2, framework, depth, isInsideButton || tag === 'button');
          const cleanedTemplate = templateJSX.trim();
          const padLoop = '  '.repeat(indent + 1);
          
          let loopExpression = '';
          if (framework.startsWith('React')) {
            loopExpression = `${padLoop}{[1, 2, 3].map((item) => (\n  ${cleanedTemplate.replace(/^/gm, '  ')}\n${padLoop}))}`;
          } else if (framework === 'Vue 3') {
            loopExpression = `${padLoop}<template v-for="item in 3" :key="item">\n${templateJSX}\n${padLoop}</template>`;
          } else {
            loopExpression = `${padLoop}<!-- Repeating list items -->\n${run.map(item => elToJSX(item, indent + 1, framework, depth, isInsideButton || tag === 'button')).join('\n')}`;
          }
          children.push(loopExpression);
        } else {
          run.forEach(item => {
            const c = elToJSX(item, indent + 1, framework, depth, isInsideButton || tag === 'button');
            if (c) children.push(c);
          });
        }
      }
    }

    if (afterStyles) {
      const mockPseudoEl = {
        tagName: 'span',
        nodeType: 1,
        childNodes: [],
        children: [],
        textContent: '',
        getAttribute: () => null,
        isConnected: false
      };
      const pseudoCls = stylesToTailwind(afterStyles, mockPseudoEl).join(' ');
      const pseudoClassAttr = pseudoCls ? ` ${attrCls}="${pseudoCls}"` : '';
      const text = afterStyles.content || '';
      children.push(`${pad}  <span${pseudoClassAttr}>${text}</span>`);
    }

    const _classAttr = twCls ? ` ${attrCls}="${twCls}"` : '';

    // Automatically generate helpful semantic section comments for major layouts & components
    let sectionComment = '';
    const componentLabel = getLabel(el);
    const componentName = getComponentName(el).replace('Component', '');
    const isRootLevel = (indent === 2 && framework.startsWith('React')) || (indent === 1 && framework === 'Vue 3') || (indent === 0 && framework === 'HTML');
    const isSignificant = ['SECTION', 'BUTTON', 'MEDIA', 'CARD'].includes(componentLabel) || tag.includes('-') || isRootLevel;
    
    if (isSignificant) {
      const isReactOrVue = framework.startsWith('React') || framework === 'Vue 3';
      const selectorText = getSelector(el);
      const details = [];
      if (el.id) details.push(`id: #${el.id}`);
      if (tag.includes('-')) details.push(`WebComponent: <${tag}>`);
      
      const detailsStr = details.length > 0 ? ` (${details.join(', ')})` : '';
      const commentText = `─── ${componentLabel}: ${componentName}${detailsStr} [Tag: <${tag}>, Path: ${selectorText}] ───`;
      
      sectionComment = isReactOrVue 
        ? `${pad}{/* ${commentText} */}\n` 
        : `${pad}<!-- ${commentText} -->\n`;
    }
    let resultVal = '';
    if (!hasPseudo && isAllInline(el) && children.length > 0) {
      const inlineContent = compileInline(el, framework).trim();
      resultVal = `${sectionComment}${pad}<${jsxTag}${_classAttr}${gradientStyleAttr}>${inlineContent}</${jsxTag}>`;
    } else if (children.length === 0) {
      const voids = new Set(['area','base','br','col','embed','hr','link','meta','param','source','track','wbr']);
      if (voids.has(tag)) resultVal = `${sectionComment}${pad}<${jsxTag}${_classAttr}${gradientStyleAttr} />`;
      else resultVal = `${sectionComment}${pad}<${jsxTag}${_classAttr}${gradientStyleAttr}></${jsxTag}>`;
    } else if (children.length === 1 && !children[0].includes('\n') && !children[0].trim().startsWith('<')) {
      resultVal = `${sectionComment}${pad}<${jsxTag}${_classAttr}${gradientStyleAttr}>${children[0].trim()}</${jsxTag}>`;
    } else {
      resultVal = `${sectionComment}${pad}<${jsxTag}${_classAttr}${gradientStyleAttr}>\n${children.join('\n')}\n${pad}</${jsxTag}>`;
    }

    if (originalDisplay !== null) {
      el.style.display = originalDisplay;
    }
    return resultVal;
  }

  function toPascalCase(str) {
    if (!str) return '';
    return str
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .trim()
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }

  function getComponentName(el) {
    if (!el) return 'Component';

    // 1. Try data-component, aria-label, or id attributes
    const attrName = el.getAttribute('data-component') || el.getAttribute('aria-label') || el.id;
    if (attrName) {
      const clean = toPascalCase(attrName);
      if (clean) return clean + 'Component';
    }

    // 2. Check classes for UI terms
    const classStr = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    const classList = classStr.split(/\s+/);
    const uiKeywords = [
      { key: 'card', name: 'Card' },
      { key: 'btn', name: 'Button' },
      { key: 'button', name: 'Button' },
      { key: 'input', name: 'Input' },
      { key: 'form', name: 'Form' },
      { key: 'modal', name: 'Modal' },
      { key: 'dialog', name: 'Modal' },
      { key: 'badge', name: 'Badge' },
      { key: 'tag', name: 'Badge' },
      { key: 'hero', name: 'Hero' },
      { key: 'avatar', name: 'Avatar' },
      { key: 'sidebar', name: 'Sidebar' },
      { key: 'footer', name: 'Footer' },
      { key: 'header', name: 'Header' },
      { key: 'navbar', name: 'Navbar' },
      { key: 'nav', name: 'Nav' },
      { key: 'menu', name: 'Menu' },
      { key: 'alert', name: 'Alert' },
      { key: 'banner', name: 'Alert' },
      { key: 'tabs', name: 'Tabs' },
      { key: 'tab', name: 'Tab' },
      { key: 'table', name: 'Table' },
      { key: 'dropdown', name: 'Dropdown' },
      { key: 'accordion', name: 'Accordion' },
      { key: 'tooltip', name: 'Tooltip' },
      { key: 'grid', name: 'Grid' }
    ];

    for (const item of uiKeywords) {
      if (classList.some(cls => cls.includes(item.key))) {
        return item.name + 'Component';
      }
    }

    // 3. Check text content of headings/buttons/links or inside element
    const lbl = getLabel(el);
    let text = '';
    if (['HEADING', 'BUTTON', 'LINK'].includes(lbl)) {
      text = el.textContent ? el.textContent.trim() : '';
    } else {
      const h = el.querySelector('h1, h2, h3, h4, h5, h6');
      if (h) text = h.textContent.trim();
    }
    
    if (text && text.length < 25 && /^[a-zA-Z0-9\s\-_]+$/.test(text)) {
      const clean = toPascalCase(text);
      if (clean && clean.length > 2) {
        return clean + 'Component';
      }
    }

    // 4. Fallback mappings
    const map = {
      BUTTON: 'Button',
      LINK: 'Link',
      INPUT: 'Input',
      MEDIA: 'Media',
      NAV: 'Nav',
      HEADING: 'Heading',
      TEXT: 'Text',
      LIST: 'List',
      SECTION: 'Section',
      HEADER: 'Header',
      FOOTER: 'Footer',
      COMPONENT: 'Card',
      ELEMENT: 'Block'
    };

    let base = map[lbl] || 'My';
    if (lbl === 'ELEMENT') {
      const tag = el.tagName.toLowerCase();
      if (tag === 'div') base = 'Card';
      else if (tag === 'span' || tag === 'p') base = 'Text';
      else if (tag === 'img') base = 'Image';
      else if (tag === 'svg') base = 'Icon';
      else base = toPascalCase(tag);
    }
    
    return base + 'Component';
  }

  function generateComponent(el, framework) {
    detectedFonts = new Set();
    cachePseudoRules();
    const name = getComponentName(el);
    const styles = extractStyles(el);
    
    // Check if the component requires a dark/themed background to be readable.
    // Usually light text color (l > 70) and a transparent or dark background.
    let wrapInThemedBackground = false;
    let computedBg = 'bg-neutral-900';
    
    if (styles.color) {
      const m = styles.color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const [,,l] = rgbToHsl(+m[1], +m[2], +m[3]);
        // If text is very light, we check if the background is transparent or dark
        if (l > 70) {
          const bgStyle = styles.backgroundColor;
          if (!bgStyle || bgStyle === 'transparent' || bgStyle === 'rgba(0, 0, 0, 0)') {
            wrapInThemedBackground = true;
            // Capture the inherited non-transparent page background color if possible
            const inheritedBg = getInheritedBackgroundColor(el);
            if (inheritedBg && inheritedBg !== 'transparent') {
              const bgClass = colorToTailwind(inheritedBg, 'bg');
              if (bgClass) computedBg = bgClass;
            }
          }
        }
      }
    }

    const fontImports = generateFontImports();

    switch (framework) {
      case 'React (TSX)': {
        let inner = elToJSX(el, 2, framework, 30);
        if (wrapInThemedBackground) {
          inner = `    <div className="${computedBg} p-6 rounded-lg">\n${inner.replace(/^/gm, '  ')}\n    </div>`;
        }
        return `${fontImports}import React from 'react';\n\nconst ${name}: React.FC = () => {\n  return (\n${inner}\n  );\n};\n\nexport default ${name};`;
      }
      case 'React (JSX)': {
        let inner = elToJSX(el, 2, framework, 30);
        if (wrapInThemedBackground) {
          inner = `    <div className="${computedBg} p-6 rounded-lg">\n${inner.replace(/^/gm, '  ')}\n    </div>`;
        }
        return `${fontImports}import React from 'react';\n\nexport default function ${name}() {\n  return (\n${inner}\n  );\n}`;
      }
      case 'Vue 3': {
        let inner = elToJSX(el, 1, framework, 30);
        if (wrapInThemedBackground) {
          inner = `  <div class="${computedBg} p-6 rounded-lg">\n${inner.replace(/^/gm, '  ')}\n  </div>`;
        }
        return `${fontImports}<template>\n${inner}\n</template>\n\n<script setup lang="ts">\n// ${name} component logic\n</script>`;
      }
      default: { // HTML
        let inner = elToJSX(el, 0, 'HTML', 30);
        if (wrapInThemedBackground) {
          inner = `<div class="${computedBg} p-6 rounded-lg">\n${inner.replace(/^/gm, '  ')}\n</div>`;
        }
        return `${fontImports}${inner}`;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SYNTAX HIGHLIGHTER
  // ═══════════════════════════════════════════════════════════════

  function highlight(code) {
    // 1. Escape HTML entities
    let h = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // A. Match comments and replace with placeholder
    const comments = [];
    h = h.replace(/(\{\/\*.*?\*\/\})/gs, (m) => {
      comments.push(m);
      return `__COMMENT_${comments.length - 1}__`;
    });

    // B. Match JSX expressions (style={{...}} or standard expression attributes)
    const exprs = [];
    h = h.replace(/=\{\{([\s\S]*?)\}\}/g, (m, val) => {
      exprs.push({ type: 'double', val });
      return `=__EXPR_${exprs.length - 1}__`;
    });
    h = h.replace(/=\{([\s\S]*?)\}/g, (m, val) => {
      exprs.push({ type: 'single', val });
      return `=__EXPR_${exprs.length - 1}__`;
    });
    h = h.replace(/&gt;\{([\s\S]*?)\}&lt;/g, (m, val) => {
      exprs.push({ type: 'content', val });
      return `&gt;__EXPR_${exprs.length - 1}__&lt;`;
    });

    // C. Match strings and replace with placeholder
    const strings = [];
    h = h.replace(/(["'])([\s\S]*?)\1/g, (m, q, val) => {
      strings.push({ q, val });
      return `__STR_${strings.length - 1}__`;
    });

    // D. Match tags
    h = h.replace(/(&lt;\/?)([\w-]+)/g, (m, slash, name) => {
      const cls = /^[A-Z]/.test(name) ? 'hl-component' : 'hl-tag';
      return `${slash}[TAG:${cls}:${name}]`;
    });

    // E. Match attributes
    h = h.replace(/\s([\w-]+)=/g, (m, attr) => {
      return ` [ATTR:${attr}]=`;
    });

    // F. Match JS keywords
    h = h.replace(/\b(export|default|function|return|const|let|var|import|from|type|interface)\b/g, '[KW:$1]');

    // G. Match closing punctuation
    h = h.replace(/(\/?&gt;)/g, '[PUNCT:$1]');

    // Restore placeholders

    // 1. Restore tags
    h = h.replace(/\[TAG:(hl-component|hl-tag):([\w-]+)\]/g, '<span class="$1">$2</span>');

    // 2. Restore attributes
    h = h.replace(/\[ATTR:([\w-]+)\]/g, '<span class="hl-attr">$1</span>');

    // 3. Restore keywords
    h = h.replace(/\[KW:([\w-]+)\]/g, '<span class="hl-kw">$1</span>');

    // 4. Restore punctuation
    h = h.replace(/\[PUNCT:([^\]]+)\]/g, '<span class="hl-punct">$1</span>');

    // 5. Restore expressions
    h = h.replace(/__EXPR_(\d+)__/g, (m, idx) => {
      const { type, val } = exprs[parseInt(idx)];
      if (type === 'double') return `{{<span class="hl-expr">${highlight(val)}</span>}}`;
      if (type === 'single') return `{<span class="hl-expr">${highlight(val)}</span>}`;
      return `{<span class="hl-expr">${highlight(val)}</span>}`;
    });

    // 6. Restore strings
    h = h.replace(/__STR_(\d+)__/g, (m, idx) => {
      const { q, val } = strings[parseInt(idx)];
      return `${q}<span class="hl-str">${val}</span>${q}`;
    });

    // 7. Restore comments
    h = h.replace(/__COMMENT_(\d+)__/g, (m, idx) => {
      const val = comments[parseInt(idx)];
      return `<span class="hl-comment">${val}</span>`;
    });

    return h;
  }

  // ═══════════════════════════════════════════════════════════════
  // PANEL CSS
  // ═══════════════════════════════════════════════════════════════

  function panelCSS() {
    const fontUrlRegular = ext.runtime.getURL('fonts/Geist-Regular.woff2');
    const fontUrlMedium = ext.runtime.getURL('fonts/Geist-Medium.woff2');
    const fontUrlSemiBold = ext.runtime.getURL('fonts/Geist-SemiBold.woff2');
    const fontUrlMono = ext.runtime.getURL('fonts/GeistMono-Regular.woff2');
    return `
@font-face {
  font-family: 'Geist';
  src: url('${fontUrlRegular}') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Geist';
  src: url('${fontUrlMedium}') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Geist';
  src: url('${fontUrlSemiBold}') format('woff2');
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Geist Mono';
  src: url('${fontUrlMono}') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:host{all:initial}

/* ── Panel shell ── */
.ss-panel{
  position:fixed; top:20px; bottom:20px; right:20px;
  width:400px; max-width:calc(100vw - 40px);
  height:calc(100vh - 40px);
  background:#FFFFFF; border-radius:16px;
  border: 1px solid rgba(0,0,0,0.05);
  box-shadow:0 12px 40px rgba(0,0,0,0.08);
  font-family:'Geist',system-ui,-apple-system,sans-serif;
  font-size:13px; color:#111827; z-index:2147483647;
  pointer-events:all; display:flex; flex-direction:column;
  -webkit-font-smoothing:antialiased; overflow:hidden;
  transition:opacity .18s, transform .18s, width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.ss-panel.ss-entering{opacity:0;transform:translateY(10px) scale(.98)}
.ss-hidden{display:none!important}
.ss-fade-in{animation:ssFadeIn 0.3s ease forwards}
@keyframes ssFadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ssFadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
#ss-inspector-view:not(.ss-hidden), #ss-history-view:not(.ss-hidden) {
  animation: ssFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── Shadow DOM Overlays ── */
.ss-hover-overlay {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px solid #2563EB;
  z-index: 10000;
  transition: all 0.05s ease-out;
}
.ss-select-overlay {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px solid #2563EB;
  z-index: 10001;
}

/* ── Custom Framework Dropdown ── */
.ss-dropdown {
  position: relative;
  display: inline-block;
  font-family: inherit;
}
.ss-dropdown-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #FFFFFF;
  border: 1.5px solid #E2E8F0;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 10.5px;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  height: 30px;
  min-width: 120px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}
.ss-dropdown-trigger:hover {
  border-color: #CBD5E1;
  background: #F8FAFC;
}
.ss-dropdown-trigger:focus {
  outline: none;
  border-color: #2563EB;
  box-shadow: 0 0 0 2px rgba(37,99,235,0.06);
}
.ss-dropdown-arrow {
  color: #64748B;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.ss-dropdown.ss-open .ss-dropdown-arrow {
  transform: rotate(180deg);
  color: #2563EB;
}
.ss-dropdown-options {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.08);
  padding: 5px;
  z-index: 1000;
  min-width: 130px;
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
  pointer-events: none;
  transform-origin: top right;
  transition: opacity 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ss-dropdown.ss-open .ss-dropdown-options {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
.ss-dropdown-option {
  padding: 6px 10px;
  font-size: 10.5px;
  font-weight: 500;
  color: #475569;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: all 0.15s ease;
}
.ss-dropdown-option:hover {
  background: #F1F5F9;
  color: #0F172A;
  padding-left: 12px;
}
.ss-dropdown-option.ss-selected {
  background: #EFF6FF;
  color: #2563EB;
  font-weight: 600;
}
.ss-dropdown-option.ss-selected::after {
  content: '';
  display: inline-block;
  width: 4px;
  height: 4px;
  background-color: #2563EB;
  border-radius: 50%;
  margin-left: 8px;
}


/* ── History Pane Empty State ── */
.ss-hist-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  text-align: center;
  flex: 1;
}
.ss-hist-empty-illustration {
  margin-bottom: 16px;
}
.ss-hist-empty h3 {
  font-size: 15px;
  font-weight: 700;
  color: #0F172A;
  margin-bottom: 6px;
  letter-spacing: -0.2px;
}
.ss-hist-empty p {
  font-size: 12.5px;
  color: #64748B;
  line-height: 1.5;
  max-width: 220px;
  margin-bottom: 24px;
}
.ss-empty-illustration svg {
  display: block;
}


/* ── Scrollable body ── */
.ss-body{overflow-y:auto;overflow-x:hidden;flex:1;scrollbar-width:thin;scrollbar-color:#E5E7EB transparent}
.ss-body::-webkit-scrollbar{width:4px}
.ss-body::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:4px}

/* ── Header ── */
.ss-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:0 24px; height:72px; background:#fff;
  border-bottom:1px solid rgba(0,0,0,0.05); cursor:grab; flex-shrink:0;
}
.ss-header:active{cursor:grabbing}
.ss-logo-area{display:flex;align-items:center;gap:10px}
.ss-title{font-size:14px;font-weight:600;color:#0f172a;letter-spacing:-0.2px}
.ss-header-actions{display:flex;align-items:center;gap:10px}
.ss-theme-btn, .ss-close-btn{
  display:flex;align-items:center;justify-content:center;
  width:28px;height:28px;border:none;background:transparent;
  color:#64748b;cursor:pointer;border-radius:6px;
  transition:background .12s,color .12s;
}
.ss-theme-btn:hover, .ss-close-btn:hover{background:#f1f5f9;color:#0f172a}
#ss-header-inspect-btn{width:auto;min-width:28px;padding:4px 9px 4px 7px;font-size:11.5px;font-weight:600;letter-spacing:0.01em;white-space:nowrap;gap:4px;}

/* ── Inspect banner ── */
.ss-inspect-banner {
  display:flex;align-items:center;justify-content:space-between;
  padding:0 16px; height:44px; background:#F5F7FF;
  border-bottom:1px solid rgba(0,0,0,0.04);
  cursor:grab; flex-shrink:0;
}
.ss-inspect-banner:active{cursor:grabbing}
.ss-inspect-label{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#2563eb;letter-spacing:.02em}
.ss-esc-hint{font-size:11px;color:#64748b;font-weight:500}

/* ── Selected element section ── */
.ss-selected-section{padding:16px 20px 20px 20px;background:#fff;flex-shrink:0}
.ss-selected-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.ss-section-label{font-size:9px;font-weight:700;color:#64748b;letter-spacing:.05em}
.ss-sel-actions{display:flex;gap:6px}
.ss-icon-btn{
  display:flex;align-items:center;justify-content:center;
  width:24px;height:24px;border:none;
  background:transparent;color:#64748b;cursor:pointer;border-radius:6px;
  transition:all .12s;
}
.ss-icon-btn:hover{color:#2563eb;background:#f1f5f9}

/* ── Element preview card ── */
.ss-el-preview-card {
  display:flex; flex-direction:column; gap:12px;
  background:#ffffff; border:1.5px solid #e4ebf7;
  border-radius:12px; padding:12px 14px;
}
.ss-card-top {
  display:flex; gap:14px; align-items:center; width:100%;
}
.ss-card-bottom {
  display:flex; justify-content:flex-start; width:100%;
}
.ss-preview-thumb {
  width:100%;height:120px;
  border-radius:8px;border:1.5px dashed #E2E8F0;
  background:#F8FAFC;overflow:hidden;
  display:flex;align-items:center;justify-content:center;position:relative;
  transition:all 0.2s ease;
}

/* Custom iOS-style Switch Toggle */
.ss-switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 20px;
  margin-right: 4px;
}
.ss-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.ss-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: #E2E8F0;
  transition: .2s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 20px;
}
.ss-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: .2s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.ss-switch input:checked + .ss-slider {
  background-color: #3B82F6;
}
.ss-switch input:focus + .ss-slider {
  box-shadow: 0 0 1px #3B82F6;
}
.ss-switch input:checked + .ss-slider:before {
  transform: translateX(18px);
}

.ss-thumb-placeholder{display:flex;flex-direction:column;align-items:center;gap:4px;color:#d1d5db}
.ss-clone-wrap{transform-origin:top left;pointer-events:none;position:absolute;top:50%;left:50%}
.ss-el-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.ss-el-name{font-size:12.5px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}
.ss-el-desc{font-size:11px;color:#64748b;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ss-el-tag-badge{
  font-family:'Geist Mono',monospace;font-size:10px;font-weight:600;
  color:#2563eb;background:#eff6ff;border:1px solid #dbeafe;
  padding:2px 6px;border-radius:5px;display:inline-block;
}
.ss-badge {
  display: inline-block;
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 5px;
  text-transform: uppercase;
}
.ss-badge--purple { background: #F3E8FF; color: #7E22CE; border: 1px solid #E9D5FF; }
.ss-badge--blue { background: #DBEAFE; color: #1D4ED8; border: 1px solid #BFDBFE; }
.ss-badge--gray { background: #F3F4F6; color: #4B5563; border: 1px solid #E5E7EB; }
.ss-badge--orange { background: #FFEDD5; color: #C2410C; border: 1px solid #FED7AA; }


/* ── Tabs ── */
.ss-tabs{display:flex;gap:20px;padding:0 16px;border-bottom:1px solid #e2e8f0;background:#fff}
.ss-tab{
  font-family:inherit;font-size:10px;font-weight:700;
  color:#64748b;padding:10px 0;border:none;background:transparent;cursor:pointer;
  border-bottom:2px solid transparent;margin-bottom:-1px;
  transition:color .12s,border-color .12s;text-transform:uppercase;white-space:nowrap;
}
.ss-tab:hover{color:#0f172a}
.ss-tab.ss-tab--active{color:#2563eb;border-bottom-color:#2563eb}

/* ── Tab panes ── */
.ss-tab-pane{padding:12px 16px 0;width:100%;max-width:100%;box-sizing:border-box;}

/* ── Framework row ── */
.ss-framework-row{display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px;width:100%;box-sizing:border-box}
.ss-ready-pill{
  display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;
  color:#059669;background:#ecfdf5;padding:3px 8px;border-radius:9999px;
}
.ss-select{
  font-family:inherit;font-size:12px;font-weight:600;
  color:#1e293b;background:#ffffff;border:1.5px solid #e2e8f0;border-radius:6px;
  padding:4px 26px 4px 10px;cursor:pointer;appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236B7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 8px center;transition:border-color .12s;
}
.ss-select:focus{outline:none;border-color:#2563eb}

/* ── Code block ── */
.ss-code-block{position:relative;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:12px;width:100%;max-width:100%;box-sizing:border-box}
.ss-code{
  display:block;padding:14px;overflow:auto;max-height:260px;
  font-family:'Geist Mono',monospace;
  font-size:10.5px;line-height:1.6;color:#0f172a;white-space:pre;margin:0;
  scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent;
  width:100%;max-width:100%;box-sizing:border-box;
}
.ss-code::-webkit-scrollbar{height:4px;width:4px}
.ss-code::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}
.ss-code-copy-btn{
  position:absolute;top:8px;right:8px;display:flex;align-items:center;justify-content:center;
  width:26px;height:26px;background:#fff;border:1px solid #e2e8f0;
  border-radius:6px;color:#64748b;cursor:pointer;transition:all .12s;z-index:1;
}
.ss-code-copy-btn:hover{background:#f1f5f9;color:#0f172a}
.ss-code-copy-btn.ss-copied{color:#10b981;border-color:#10b981}

/* Syntax colors */
.hl-kw{color:#a90d91;font-weight:600}
.hl-tag{color:#1a7e3e}
.hl-component{color:#1a7e3e;font-weight:600}
.hl-attr{color:#b31d28}
.hl-str{color:#032f62}
.hl-punct{color:#64748b}
.hl-comment{color:#6a737d;font-style:italic}
.hl-expr{color:#e36209}

/* ── Classes grid ── */
.ss-cls-grid{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:14px}
.ss-cls-pill{font-family:'Geist Mono',monospace;font-size:10px;padding:3.5px 7px;background:#EFF6FF;color:#1D4ED8;border-radius:5px;border:1px solid #DBEAFE}

/* ── Styles table ── */
.ss-styles-tbl{padding-bottom:14px}
.ss-style-row{display:flex;padding:5px 0;font-size:11px;border-bottom:1px solid #f1f5f9}
.ss-style-prop{color:#64748b;width:110px;flex-shrink:0}
.ss-style-val{color:#0f172a;word-break:break-all}

/* ── Actions footer ── */
.ss-actions{padding:16px;border-top:1px solid #e2e8f0;background:#f8fafc}
.ss-btn-primary{
  display:flex;width:100%;align-items:center;justify-content:center;gap:8px;
  background:#2563eb;color:#fff;border:none;padding:8px 10px;border-radius:8px;
  font-weight:600;font-size:11.5px;cursor:pointer;transition:background .12s;
}
.ss-btn-primary:hover{background:#1d4ed8}
.ss-btn-primary.ss-copied{background:#10b981}

.ss-sec-btns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px}
.ss-btn-sec{
  display:flex;align-items:center;justify-content:center;gap:6px;
  background:#fff;border:1px solid #e2e8f0;padding:6px 8px;border-radius:6px;
  color:#475569;font-size:10.5px;font-weight:500;cursor:pointer;
}
.ss-btn-sec:hover{background:#f1f5f9;color:#0f172a}

.ss-footer-row{display:flex;justify-content:space-between;align-items:center;margin-top:12px;color:#94a3b8;font-size:9.5px}
.ss-footer-left, .ss-footer-right{display:flex;align-items:center;gap:5px;cursor:pointer}
.ss-footer-right:hover{color:#64748b}

.ss-tooltip{
  position:fixed;padding:6px 10px;background:#0f172a;color:#fff;
  font-size:11px;border-radius:4px;z-index:2147483648;pointer-events:none;
}

/* ─── History View ─── */
.ss-history-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #F8FAFC;
}

.ss-history-tabs {
  display: flex;
  padding: 0 16px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  background: #fff;
}

.ss-hist-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  color: #94a3b8;
  padding: 8px 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.13s, border-color 0.13s;
  margin-right: 20px;
}
.ss-hist-tab:hover { color: #475569; }
.ss-hist-tab.ss-hist-tab--active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 600;
}
.ss-hist-tab--locked {
  cursor: default;
  opacity: 0.55;
}

.ss-history-filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  background: #fff;
}

.ss-hist-select-wrap {
  position: relative;
}

.ss-hist-filter-select {
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  color: #475569;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 5px 28px 5px 10px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236B7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  transition: border-color 0.13s;
}
.ss-hist-filter-select:focus { outline: none; border-color: #2563eb; }

.ss-hist-filter-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.13s;
}
.ss-hist-filter-icon-btn:hover { border-color: #2563eb; color: #2563eb; background: #eff6ff; }

.ss-history-list {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #e2e8f0 transparent;
}
.ss-history-list::-webkit-scrollbar { width: 4px; }
.ss-history-list::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }

.ss-hist-section-label {
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 4px 2px 8px;
  text-align: left;
}

.ss-hist-menu-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.1s ease;
}
.ss-hist-menu-btn:hover { background: #F3F4F6; color: #475569; }
.ss-hist-menu-btn.active { background: #eff6ff; color: #2563eb; }

.ss-hist-fav-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.1s ease;
}
.ss-hist-fav-btn:hover { background: #FFFBEB; }
.ss-hist-fav-btn svg { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.ss-hist-fav-btn:active svg { transform: scale(0.85); }

.ss-hist-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.ss-history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.12s;
  background: #fff;
  position: relative;
}
.ss-history-item:hover {
  border-color: #C7D7FD;
  box-shadow: 0 1px 6px rgba(37,99,235,.08);
}
.ss-history-item.ss-history-item--selected {
  border-color: #2563eb;
  border-width: 1.5px;
  box-shadow: 0 0 0 3px rgba(37,99,235,.08);
}

.ss-hist-thumb {
  flex-shrink: 0;
  width: 88px;
  height: 66px;
  border-radius: 7px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F9FAFB;
}
.ss-hist-thumb--card { background: #fff; }
.ss-hist-thumb-card-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  height: 100%;
  width: 100%;
}
.ss-hist-thumb--heading {
  background: #fff;
  align-items: flex-start;
  justify-content: flex-start;
  flex-direction: column;
}
.ss-hist-thumb--btn { background: #F9FAFB; }
.ss-hist-thumb--feature { background: #F0FDF4; }
.ss-hist-thumb--pricing {
  background: #fff;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 0;
  border: 1.5px solid #e2e8f0;
}

.ss-hist-thumb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
}
.ss-hist-thumb-icon--purple { background: #F3E8FF; }
.ss-hist-thumb-icon--blue   { background: #DBEAFE; }
.ss-hist-thumb-icon--teal   { background: #CCFBF1; border-radius: 10px; }
.ss-hist-thumb-icon--green  { background: #DCFCE7; }

.ss-hist-item-info {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.ss-hist-item-name {
  font-size: 11.5px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ss-hist-item-tag {
  font-size: 10px;
  color: #64748b;
  font-family: 'Geist Mono', monospace;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ss-hist-item-time {
  font-size: 10px;
  color: #94a3b8;
}

.ss-hist-menu-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.12s, color 0.12s;
  align-self: flex-start;
}
.ss-hist-menu-btn:hover { background: #F3F4F6; color: #475569; }
.ss-hist-menu-btn.active { background: #eff6ff; color: #2563eb; }

.ss-hist-view-all-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 11px 16px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  transition: all 0.13s;
  margin-top: 4px;
  margin-bottom: 12px;
}
.ss-hist-view-all-btn:hover {
  border-color: #2563eb;
  color: #2563eb;
  background: #eff6ff;
}

/* ── Go Pro card ── */
.ss-go-pro-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0 12px 14px;
  padding: 14px 12px 14px 14px;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 14px;
  cursor: pointer;
  transition: border-color 0.13s, box-shadow 0.13s;
}
.ss-go-pro-card:hover {
  border-color: #F59E0B;
  box-shadow: 0 2px 10px rgba(245,158,11,.14);
}

.ss-go-pro-left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.ss-go-pro-crown {
  font-size: 22px;
  flex-shrink: 0;
  line-height: 1;
  margin-top: 1px;
}

.ss-go-pro-text { flex: 1; text-align: left; }
.ss-go-pro-title {
  font-size: 14px;
  font-weight: 700;
  color: #2563eb;
  margin-bottom: 4px;
}
.ss-go-pro-sub {
  font-size: 11.5px;
  color: #64748b;
  line-height: 1.45;
}

.ss-go-pro-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  background: #FEF3C7;
  color: #92400E;
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.13s, transform 0.13s;
}
.ss-go-pro-card:hover .ss-go-pro-arrow {
  background: #FCD34D;
  transform: translateX(2px);
}

/* Collections Pane */
.ss-collections-pane {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.ss-collections-pane-icon {
  width: 48px; height: 48px;
  background: #F3F4F6;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  color: #94a3b8;
}
.ss-collections-pane h3 { font-size: 14px; font-weight: 600; color: #475569; }
.ss-collections-pane p  { font-size: 12px; color: #94a3b8; line-height: 1.5; }
.ss-collections-upgrade-btn {
  margin-top: 6px;
  padding: 9px 20px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.13s;
}
.ss-collections-upgrade-btn:hover { background: #1d4ed8; }

/* Context Menu */
.ss-hist-context-menu {
  position: absolute;
  z-index: 99999;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.04);
  padding: 4px;
  min-width: 150px;
  text-align: left;
}
.ss-hist-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 7px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.ss-hist-ctx-item:hover { background: #F9FAFB; }
.ss-hist-ctx-item--danger { color: #DC2626; }
.ss-hist-ctx-item--danger:hover { background: #FEF2F2; }
.ss-hist-ctx-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 3px 0;
}

/* ── Dark Mode ── */
.ss-panel.ss-dark {
  background: #0A0A0A;
  color: #FAFAFA;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-header {
  background: #0A0A0A;
  border-bottom-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-title {
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-theme-btn:hover, .ss-panel.ss-dark .ss-close-btn:hover {
  background: #1C1C1C;
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-inspect-banner {
  background: #141414;
}
.ss-panel.ss-dark .ss-inspect-label {
  color: #60A5FA;
}
.ss-panel.ss-dark .ss-esc-hint {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-selected-section {
  background: #0A0A0A;
}
.ss-panel.ss-dark .ss-el-preview-card {
  background: #141414;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-el-name {
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-el-desc {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-tabs {
  background: #0A0A0A;
  border-bottom-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-tab {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-tab.ss-tab--active {
  color: #3B82F6;
  border-bottom-color: #3B82F6;
}
.ss-panel.ss-dark .ss-code-block {
  background: #141414;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-code {
  color: #E5E5E5;
}

.ss-panel.ss-dark .ss-style-row {
  border-bottom-color: #262626;
}
.ss-panel.ss-dark .ss-style-prop {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-style-val {
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-empty-box-top {
  background: #0A0A0A;
  border-color: #262626;
}
.ss-panel.ss-dark .ss-empty-title {
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-empty-desc {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-empty-bottom-title {
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-empty-bottom-desc {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-empty-footer {
  background: #0A0A0A;
  border-top-color: #262626;
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-hist-empty h3 {
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-hist-empty p {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-history-view {
  background: #0A0A0A;
}
.ss-panel.ss-dark .ss-history-tabs {
  background: #0A0A0A;
  border-bottom-color: #262626;
}
.ss-panel.ss-dark .ss-hist-tab {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-hist-tab.ss-hist-tab--active {
  color: #3B82F6;
  border-bottom-color: #3B82F6;
}
.ss-panel.ss-dark .ss-history-filter-row {
  background: #0A0A0A;
  border-bottom-color: #262626;
}
.ss-panel.ss-dark .ss-hist-filter-select {
  color: #E5E5E5;
  background-color: #141414;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-hist-filter-icon-btn {
  color: #A3A3A3;
  background: #141414;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-hist-filter-icon-btn:hover {
  background: #1C1C1C;
  color: #FFFFFF;
  border-color: #404040;
}
.ss-panel.ss-dark .ss-history-list {
  background: #0A0A0A;
}
.ss-panel.ss-dark .ss-hist-section-label {
  color: #737373;
}
.ss-panel.ss-dark .ss-history-item {
  background: #141414;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-history-item:hover {
  background: #1C1C1C;
  border-color: #404040;
}
.ss-panel.ss-dark .ss-history-item.ss-history-item--selected {
  background: #141414;
  border-color: #3B82F6;
}
.ss-panel.ss-dark .ss-hist-item-name {
  color: #FFFFFF;
}
.ss-panel.ss-dark .ss-hist-item-tag {
  color: #737373;
}
.ss-panel.ss-dark .ss-hist-view-all-btn {
  background: #141414;
  border-color: #2D2D2D;
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-hist-view-all-btn:hover {
  border-color: #3B82F6;
  color: #3B82F6;
  background: #1C1C1C;
}
.ss-panel.ss-dark .ss-hist-thumb {
  background: #0A0A0A;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-hist-thumb--card {
  background: #0A0A0A;
}
.ss-panel.ss-dark .ss-hist-thumb--btn {
  background: #1C1C1C;
}
.ss-panel.ss-dark .ss-hist-thumb-icon--purple { background: rgba(168, 85, 247, 0.15); }
.ss-panel.ss-dark .ss-hist-thumb-icon--blue   { background: rgba(59, 130, 246, 0.15); }
.ss-panel.ss-dark .ss-hist-thumb-icon--teal   { background: rgba(20, 184, 166, 0.15); }
.ss-panel.ss-dark .ss-hist-thumb-icon--green  { background: rgba(34, 197, 94, 0.15); }
.ss-panel.ss-dark .ss-hist-thumb span {
  color: #FAFAFA !important;
}
.ss-panel.ss-dark .ss-hist-thumb div {
  background-color: #141414 !important;
  border-color: #2D2D2D !important;
}

/* Actions footer */
.ss-panel.ss-dark .ss-body {
  scrollbar-color: #3F3F46 transparent;
}
.ss-panel.ss-dark .ss-body::-webkit-scrollbar-thumb {
  background: #3F3F46;
}
.ss-panel.ss-dark .ss-history-list {
  scrollbar-color: #3F3F46 transparent;
}
.ss-panel.ss-dark .ss-history-list::-webkit-scrollbar-thumb {
  background: #3F3F46;
}
.ss-panel.ss-dark .ss-code {
  scrollbar-color: #3F3F46 transparent;
}
.ss-panel.ss-dark .ss-code::-webkit-scrollbar-thumb {
  background: #3F3F46;
}
.ss-panel.ss-dark .ss-preview-thumb {
  background: #141414;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-slider {
  background-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-switch input:checked + .ss-slider {
  background-color: #3B82F6;
}

.ss-panel.ss-dark #ss-preview-text-card {
  color: #FAFAFA !important;
}
.ss-panel.ss-dark .ss-text-divider {
  background: #2D2D2D !important;
}
.ss-panel.ss-dark #ss-text-preview-display {
  color: #FAFAFA !important;
}
.ss-panel.ss-dark #ss-text-spec-font,
.ss-panel.ss-dark #ss-text-spec-size,
.ss-panel.ss-dark #ss-text-spec-weight,
.ss-panel.ss-dark #ss-text-spec-color {
  color: #FAFAFA !important;
}


.ss-panel.ss-dark .ss-actions {
  background: #141414;
  border-top-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-btn-sec {
  background: #1C1C1C;
  border-color: #2D2D2D;
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-btn-sec:hover {
  background: #282828;
  color: #FFFFFF;
  border-color: #404040;
}
.ss-panel.ss-dark .ss-footer-row {
  color: #737373;
}
.ss-panel.ss-dark .ss-footer-right:hover {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-ready-pill {
  color: #34D399;
  background: #064E3B;
}

/* Custom dropdown in dark mode */
.ss-panel.ss-dark .ss-dropdown-trigger {
  background: #141414;
  border-color: #2D2D2D;
  color: #E5E5E5;
}
.ss-panel.ss-dark .ss-dropdown-trigger:hover {
  background: #1C1C1C;
  border-color: #404040;
}
.ss-panel.ss-dark .ss-dropdown-trigger:focus {
  border-color: #3B82F6;
}
.ss-panel.ss-dark .ss-dropdown-arrow {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-dropdown.ss-open .ss-dropdown-arrow {
  color: #3B82F6;
}
.ss-panel.ss-dark .ss-dropdown-options {
  background: #141414;
  border-color: #2D2D2D;
}
.ss-panel.ss-dark .ss-dropdown-option {
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-dropdown-option:hover {
  background: #1C1C1C;
  color: #FAFAFA;
}
.ss-panel.ss-dark .ss-dropdown-option.ss-selected {
  background: #1E3A8A;
  color: #3B82F6;
}
.ss-panel.ss-dark .ss-dropdown-option.ss-selected::after {
  background-color: #3B82F6;
}

/* Copy code buttons and pills */
.ss-panel.ss-dark .ss-code-copy-btn {
  background: #1C1C1C;
  border-color: #2D2D2D;
  color: #A3A3A3;
}
.ss-panel.ss-dark .ss-code-copy-btn:hover {
  background: #282828;
  color: #FAFAFA;
  border-color: #404040;
}
.ss-panel.ss-dark .ss-cls-pill {
  background: #141414;
  color: #60A5FA;
  border-color: #2D2D2D;
}


/* Breadcrumbs and Tailwind version switcher */
.ss-breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  color: #64748b;
  margin-top: 6px;
}
.ss-breadcrumb-item {
  cursor: pointer;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #dbeafe;
  padding: 1px 5px;
  border-radius: 4px;
  transition: all 0.1s ease;
  white-space: nowrap;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  vertical-align: middle;
}
.ss-breadcrumb-item:hover {
  background: #dbeafe;
  color: #1d4ed8;
}
.ss-breadcrumb-item--active {
  background: #f1f5f9;
  color: #475569;
  border-color: #e2e8f0;
  cursor: default;
}
.ss-breadcrumb-item--active:hover {
  background: #f1f5f9;
  color: #475569;
}
.ss-breadcrumb-separator {
  color: #cbd5e1;
  font-size: 11px;
}

.ss-tw-version-toggle {
  display: inline-flex;
  background: #f1f5f9;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}
.ss-tw-ver-btn {
  font-family: inherit;
  font-size: 9.5px;
  font-weight: 700;
  color: #64748b;
  border: none;
  background: transparent;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.ss-tw-ver-btn.ss-active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

/* Dark mode overrides */
.ss-panel.ss-dark .ss-breadcrumb-item {
  color: #60a5fa;
  background: #1e3a8a;
  border-color: #1e40af;
}
.ss-panel.ss-dark .ss-breadcrumb-item:hover {
  background: #1e40af;
  color: #93c5fd;
}
.ss-panel.ss-dark .ss-breadcrumb-item--active {
  background: #141414;
  color: #a3a3a3;
  border-color: #2d2d2d;
}
.ss-panel.ss-dark .ss-breadcrumb-separator {
  color: #404040;
}
.ss-panel.ss-dark .ss-tw-version-toggle {
  background: #141414;
  border-color: #2d2d2d;
}
.ss-panel.ss-dark .ss-tw-ver-btn {
  color: #a3a3a3;
}
.ss-panel.ss-dark .ss-tw-ver-btn.ss-active {
  background: #1c1c1c;
  color: #fafafa;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

/* Syntax highlighting overrides in dark mode */
.ss-panel.ss-dark .hl-kw { color: #C678DD; }
.ss-panel.ss-dark .hl-tag { color: #E06C75; }
.ss-panel.ss-dark .hl-component { color: #E06C75; }
.ss-panel.ss-dark .hl-attr { color: #D19A66; }
.ss-panel.ss-dark .hl-str { color: #98C379; }
.ss-panel.ss-dark .hl-punct { color: #ABB2BF; }
.ss-panel.ss-dark .hl-comment { color: #5C6370; }
.ss-panel.ss-dark .hl-expr { color: #61AFEF; }
.ss-panel.ss-dark .ss-beta-badge {
  color: #60a5fa !important;
  background: #1e3a8a !important;
  border-color: #1e40af !important;
}
`;
  }


  function panelHTML() {
    return `
<style>${panelCSS()}</style>

<!-- Hover tooltip -->
<div id="ss-tooltip" class="ss-tooltip ss-hidden"></div>

<!-- Hover & Select Overlays -->
<div id="ss-hover-overlay" class="ss-hover-overlay ss-hidden"></div>
<div id="ss-select-overlay" class="ss-select-overlay ss-hidden"></div>

<div id="ss-panel" class="ss-panel ss-hidden">

  <!-- ── Top Header Bar ── -->
  <div class="ss-header" id="ss-header">
    <div class="ss-logo-area" style="display:flex; align-items:center; gap:6px;">
      <img src="${ext.runtime.getURL('icons/icon 128x128.png')}" class="ss-logo-icon" width="26" height="26" style="border-radius:6px; flex-shrink: 0;" alt="StyleSnoop Logo">
      <span class="ss-title">StyleSnoop</span>
      <span class="ss-beta-badge" style="font-size: 8px; font-weight: 700; color: #3b82f6; background: #eff6ff; border: 1px solid #dbeafe; padding: 1.5px 5px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1;">Beta</span>
    </div>
    <div class="ss-header-actions">
      <!-- Back to Inspect View button (only visible in History view) -->
      <button class="ss-theme-btn ss-hidden" id="ss-header-inspect-btn" title="Back to inspector">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Inspector
      </button>
      
      <!-- Open History button (only visible in Inspect view) -->
      <button class="ss-theme-btn" id="ss-header-history-btn" title="View history">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </button>

      <!-- Custom Inspect Toggle -->
      <label class="ss-switch" title="Toggle inspector">
        <input type="checkbox" id="ss-inspect-toggle" checked>
        <span class="ss-slider"></span>
      </label>

      <button class="ss-theme-btn" id="ss-theme-toggle" title="Toggle theme">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      </button>
      <button class="ss-close-btn" id="ss-close" title="Close panel">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events:none;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  <!-- VIEW 1: INSPECTOR VIEW -->
  <div id="ss-inspector-view" style="display:flex; flex-direction:column; width:100%; flex:1; min-height:0;">
    <!-- ── Inspect Banner (full-width strip) ── -->
    <div class="ss-inspect-banner" id="ss-topbar">
      <div class="ss-inspect-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
        </svg>
        INSPECT MODE
      </div>
      <span class="ss-esc-hint">Press ESC to exit</span>
    </div>
    <!-- ── Inspector Active State ── -->
    <div id="ss-inspector-active-state" style="display:flex; flex-direction:column; flex:1; min-height:0;">
      <!-- ── Scrollable body ── -->
      <div class="ss-body">

        <!-- SELECTED ELEMENT -->
        <div class="ss-selected-section">
          <div class="ss-selected-header">
            <span class="ss-section-label">SELECTED ELEMENT</span>
            <div class="ss-sel-actions">
              <button class="ss-icon-btn" id="ss-fav-btn" title="Add to favorites" disabled style="color: #94a3b8; opacity: 0.35; pointer-events: none; transition: color 0.15s ease;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
              <button class="ss-icon-btn" id="ss-scroll-btn" title="Scroll to element" disabled style="opacity: 0.35; pointer-events: none;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/></svg>
              </button>
              <button class="ss-icon-btn" id="ss-copy-sel" title="Copy CSS Selector Path (e.g. div > h1)" disabled style="opacity: 0.35; pointer-events: none;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="ss-el-preview-card">
            <!-- 1. General View Card -->
            <div id="ss-preview-general-card" style="display:flex; flex-direction:column; gap:12px;">
              <div class="ss-preview-thumb" id="ss-thumb">
                <div class="ss-thumb-placeholder" id="ss-thumb-ph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.8" stroke-dasharray="3 3">
                    <rect x="3" y="3" width="18" height="18" rx="4" />
                  </svg>
                </div>
              </div>
              <div class="ss-el-info">
                <div class="ss-el-name" id="ss-el-name">Click any element</div>
                <div class="ss-el-desc" id="ss-el-desc">← Hover and click to inspect</div>
              </div>
              <div class="ss-card-bottom" style="display:flex; flex-direction:row; align-items:center; gap:8px;">
                <span class="ss-el-tag-badge" id="ss-el-tag">—</span>
                <span class="ss-badge" id="ss-el-badge" style="font-size:9.5px; font-weight:700; padding:2px 6px; border-radius:5px;">—</span>
              </div>
              <div class="ss-breadcrumbs" id="ss-el-breadcrumbs" style="width:100%; margin-top:4px;"></div>
            </div>

            <!-- 2. Custom Typography Details Card -->
            <div id="ss-preview-text-card" class="ss-hidden" style="display:flex; flex-direction:row; gap:16px; align-items:stretch; width:100%;">
              <!-- Left Column: Element text preview & classes -->
              <div style="flex:1; min-width:0; display:flex; flex-direction:column; justify-content:space-between; gap:12px; text-align:left;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="ss-badge ss-badge--blue" style="display:inline-flex; align-items:center; gap:4px; font-size:9.5px; font-weight:700; padding:3px 6px; border-radius:5px;">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                    TEXT
                  </span>
                </div>
                <div id="ss-text-preview-display" style="font-size:18px; font-weight:700; color:#111827; line-height:1.25; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical;">Click any text element</div>
                <div id="ss-text-selector-display" style="font-family:'Geist Mono',monospace; font-size:10px; color:#64748b; word-break:break-all;">—</div>
              </div>

              <!-- Divider Line -->
              <div style="width:1px; background:#E2E8F0; align-self:stretch;" class="ss-text-divider"></div>

              <!-- Right Column: Specs -->
              <div style="width:140px; flex-shrink:0; display:flex; flex-direction:column; gap:8px; font-size:11px; justify-content:center;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="color:#64748b; font-weight:500;">Font</span>
                  <span id="ss-text-spec-font" style="font-weight:600; color:#111827; max-width:85px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">—</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="color:#64748b; font-weight:500;">Size</span>
                  <span id="ss-text-spec-size" style="font-weight:600; color:#111827;">—</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="color:#64748b; font-weight:500;">Weight</span>
                  <span id="ss-text-spec-weight" style="font-weight:600; color:#111827;">—</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="color:#64748b; font-weight:500;">Color</span>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span id="ss-text-spec-color-swatch" style="width:10px; height:10px; border-radius:3px; border:1px solid rgba(0,0,0,0.1); background:transparent; display:none;"></span>
                    <span id="ss-text-spec-color" style="font-weight:600; color:#111827; font-family:'Geist Mono',monospace;">—</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAILWIND COMPONENT SECTION -->
        <div class="ss-comp-section">
          <!-- Tabs -->
          <div class="ss-tabs">
            <button class="ss-tab ss-tab--active" data-tab="tailwind">TAILWIND COMPONENT</button>
            <button class="ss-tab" data-tab="classes">CLASSES</button>
            <button class="ss-tab" data-tab="styles">STYLES</button>
          </div>

          <!-- Tailwind pane -->
          <div class="ss-tab-pane" id="ss-pane-tailwind">
            <div class="ss-framework-row">
              <span class="ss-ready-pill">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                Ready
              </span>
              <div style="display:flex; gap:6px; align-items:center;">
                <!-- Tailwind Version Switcher -->
                <div class="ss-tw-version-toggle">
                  <button class="ss-tw-ver-btn" id="ss-tw-v3-btn">v3</button>
                  <button class="ss-tw-ver-btn" id="ss-tw-v4-btn">v4</button>
                </div>
                <div class="ss-dropdown" id="ss-framework-dropdown">
                  <button class="ss-dropdown-trigger" id="ss-framework-trigger">
                    <span id="ss-framework-val">React (TSX)</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="ss-dropdown-arrow"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  <div class="ss-dropdown-options" id="ss-framework-options">
                    <div class="ss-dropdown-option ss-selected" data-value="React (TSX)">React (TSX)</div>
                    <div class="ss-dropdown-option" data-value="React (JSX)">React (JSX)</div>
                    <div class="ss-dropdown-option" data-value="Vue 3">Vue 3</div>
                    <div class="ss-dropdown-option" data-value="HTML">HTML</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="ss-code-block">
              <button class="ss-code-copy-btn" id="ss-copy-code" title="Copy code">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              </button>
              <pre class="ss-code"><code id="ss-code-inner" style="color:#64748b;font-style:italic">← Click any element on the page to generate its Tailwind component</code></pre>
            </div>
          </div>

          <!-- Classes pane -->
          <div class="ss-tab-pane ss-hidden" id="ss-pane-classes">
            <div class="ss-cls-grid" id="ss-cls-grid">
              <div style="color: #94a3b8; font-style: italic; padding: 12px 4px; text-align: left; font-size: 11.5px;">← Click any element on the page to view its Tailwind classes</div>
            </div>
          </div>

          <!-- Styles pane -->
          <div class="ss-tab-pane ss-hidden" id="ss-pane-styles">
            <div class="ss-styles-tbl" id="ss-styles-tbl">
              <div style="color: #94a3b8; font-style: italic; padding: 12px 4px; text-align: left; font-size: 11.5px;">← Click any element on the page to view its CSS styles</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions Footer -->
      <div class="ss-actions">
        <button class="ss-btn-primary" id="ss-copy-comp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          <span id="ss-copy-comp-label">Copy Component</span>
        </button>
        <div class="ss-sec-btns">
          <button class="ss-btn-sec" id="ss-btn-classes">Copy Classes</button>
          <button class="ss-btn-sec" id="ss-btn-html">Copy Raw HTML</button>
          <button class="ss-btn-sec" id="ss-btn-colors">Copy Colors</button>
        </div>
      </div>

    </div>
  </div>

  <!-- VIEW 2: HISTORY VIEW -->
  <div id="ss-history-view" class="ss-history-view ss-hidden">
    <!-- Tabs -->
    <div class="ss-history-tabs">
      <button class="ss-hist-tab ss-hist-tab--active" id="ss-hist-tab-history" style="margin-right: 0; width: 100%;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        History
      </button>
    </div>

    <!-- Filter row -->
    <div class="ss-history-filter-row">
      <div class="ss-hist-select-wrap">
        <select class="ss-hist-filter-select" id="ss-hist-site-filter">
          <option>All Sites</option>
        </select>
      </div>
      <button class="ss-hist-filter-icon-btn" title="Filter options">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- History list -->
    <div class="ss-history-list" id="ss-hist-list-body">
      <!-- Empty state inside history list -->
      <div class="ss-hist-empty ss-hidden" id="ss-hist-empty-state">
        <div class="ss-hist-empty-illustration">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="22" y="16" width="30" height="26" rx="6" fill="#F3F4F6" stroke="#E5E7EB" stroke-width="1.5"/>
            <rect x="14" y="22" width="30" height="26" rx="6" fill="#FFFFFF" stroke="#DBEAFE" stroke-width="1.5" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.02))"/>
            <circle cx="29" cy="35" r="7" fill="#3B82F6"/>
            <path d="M29 32V35H32" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h3>No history yet</h3>
        <p>Your inspected elements will appear here for quick access.</p>
      </div>

      <div id="ss-hist-populated-state">
        <div class="ss-hist-section-label" id="ss-hist-section-label">TODAY</div>
        <div id="ss-hist-items-container">
          <!-- Dynamically rendered items -->
        </div>
      </div>
      
      <!-- View all button -->
      <button class="ss-hist-view-all-btn" id="ss-hist-view-all">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        View all history
      </button>
    </div>
  </div>
  
  <!-- Context Menu for History Items -->
  <div class="ss-hist-context-menu ss-hidden" id="ss-hist-context-menu">
    <button class="ss-hist-ctx-item" id="ss-hist-ctx-open">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Open in inspector
    </button>
    <div class="ss-hist-ctx-divider"></div>
    <button class="ss-hist-ctx-item ss-hist-ctx-item--danger" id="ss-hist-ctx-delete">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>
      Delete
    </button>
  </div>

</div>
`
  }


  // ═══════════════════════════════════════════════════════════════
  // SHADOW DOM CREATION
  // ═══════════════════════════════════════════════════════════════

  function createPanel() {
    if (shadowHost) return;

    shadowHost = document.createElement('div');
    shadowHost.setAttribute('id', '__stylesnoop_root__');
    shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(shadowHost);

    shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = panelHTML();

    panelEl  = shadowRoot.getElementById('ss-panel');
    tooltipEl = shadowRoot.getElementById('ss-tooltip');

    wireEvents();
    updateOverlayStyles();
    updateSelectionUI();
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT WIRING
  // ═══════════════════════════════════════════════════════════════

  function wireEvents() {
    // Custom Framework Dropdown
    const trigger = shadowRoot.getElementById('ss-framework-trigger');
    const dropdown = shadowRoot.getElementById('ss-framework-dropdown');
    const options = shadowRoot.getElementById('ss-framework-options');

    if (trigger && dropdown) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('ss-open');
      });

      // Close on outside clicks
      document.addEventListener('click', () => {
        dropdown.classList.remove('ss-open');
      });
      panelEl.addEventListener('click', () => {
        dropdown.classList.remove('ss-open');
      });

      options.querySelectorAll('.ss-dropdown-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = opt.getAttribute('data-value');
          selectedFramework = val;
          shadowRoot.getElementById('ss-framework-val').textContent = val;
          
          options.querySelectorAll('.ss-dropdown-option').forEach(o => o.classList.remove('ss-selected'));
          opt.classList.add('ss-selected');
          
          dropdown.classList.remove('ss-open');
          
          if (selectedEl) {
            updateCode(selectedEl, val);
          }
        });
      });
    }

    // Close
    shadowRoot.getElementById('ss-close').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
    });

    // Back to inspect view
    shadowRoot.getElementById('ss-header-inspect-btn').addEventListener('click', e => {
      e.stopPropagation();
      switchView('inspector');
    });

    // Open history view
    shadowRoot.getElementById('ss-header-history-btn').addEventListener('click', e => {
      e.stopPropagation();
      switchView('history');
    });

    // Inspect toggle
    const inspectToggle = shadowRoot.getElementById('ss-inspect-toggle');
    if (inspectToggle) {
      inspectToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
          startInspecting();
        } else {
          stopInspecting();
        }
      });
    }

    // Theme toggle
    shadowRoot.getElementById('ss-theme-toggle').addEventListener('click', e => {
      e.stopPropagation();
      try {
        const currentTheme = panelEl.classList.contains('ss-dark') ? 'dark' : 'light';
        panelEl.classList.toggle('ss-dark', currentTheme === 'light');
      } catch (_) {}
    });

    // Tabs
    shadowRoot.querySelectorAll('.ss-tab').forEach(tab => {
      tab.addEventListener('click', e => {
        e.stopPropagation();
        switchTab(tab.dataset.tab);
      });
    });


    // Copy code (icon inside block)
    shadowRoot.getElementById('ss-copy-code').addEventListener('click', e => {
      e.stopPropagation();
      clipCopy(currentCode, shadowRoot.getElementById('ss-copy-code'), null, '✓');
      if (selectedEl) saveToHistory(selectedEl);
    });

    // Copy component (primary)
    shadowRoot.getElementById('ss-copy-comp').addEventListener('click', e => {
      e.stopPropagation();
      const label = shadowRoot.getElementById('ss-copy-comp-label');
      clipCopy(currentCode, null, () => {
        const orig = label.textContent;
        label.textContent = '✓ Copied to clipboard!';
        shadowRoot.getElementById('ss-copy-comp').classList.add('ss-copied');
        if (selectedEl) saveToHistory(selectedEl);
        setTimeout(() => {
          label.textContent = orig;
          shadowRoot.getElementById('ss-copy-comp').classList.remove('ss-copied');
        }, 1800);
      });
      try { ext.runtime.sendMessage({ type: 'telemetry', event: 'tailwind_copied' }); } catch(_) {}
    });

    // Copy Classes
    shadowRoot.getElementById('ss-btn-classes').addEventListener('click', e => {
      e.stopPropagation();
      if (!selectedEl) return;
      const classes = stylesToTailwind(extractStyles(selectedEl)).join(' ');
      clipCopy(classes, e.currentTarget);
      saveToHistory(selectedEl);
    });

    // Copy HTML
    shadowRoot.getElementById('ss-btn-html').addEventListener('click', e => {
      e.stopPropagation();
      if (!selectedEl) return;
      clipCopy(selectedEl.outerHTML, e.currentTarget);
      saveToHistory(selectedEl);
    });

    // Copy Palette/Colors
    shadowRoot.getElementById('ss-btn-colors').addEventListener('click', e => {
      e.stopPropagation();
      if (!selectedEl) return;
      const cs = window.getComputedStyle(selectedEl);
      const pairs = [
        ['color', cs.color],
        ['background', cs.backgroundColor],
        ['border', cs.borderColor],
      ].filter(([, v]) => v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent');
      const txt = pairs.map(([k, v]) => `${k}: ${v} → tw: ${nearestColor(v) || '?'}`).join('\n') || 'No colors';
      clipCopy(txt, e.currentTarget);
      saveToHistory(selectedEl);
    });

    // Scroll to element
    shadowRoot.getElementById('ss-scroll-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (selectedEl) selectedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Favorite current element
    const favBtn = shadowRoot.getElementById('ss-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleFavoriteCurrentElement();
      });
    }

    // Copy selector
    shadowRoot.getElementById('ss-copy-sel').addEventListener('click', e => {
      e.stopPropagation();
      if (!selectedEl) return;
      const btn = e.currentTarget;
      const origHTML = btn.innerHTML;
      clipCopy(getSelector(selectedEl), btn, () => {
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        saveToHistory(selectedEl);
        setTimeout(() => {
          btn.innerHTML = origHTML;
        }, 1500);
      });
    });

    // Draggable header and topbar
    shadowRoot.getElementById('ss-header').addEventListener('mousedown', startDrag);
    shadowRoot.getElementById('ss-topbar').addEventListener('mousedown', startDrag);

    // Block page events from panel
    panelEl.addEventListener('click', e => e.stopPropagation());
    panelEl.addEventListener('mousedown', e => e.stopPropagation());
    panelEl.addEventListener('mouseover', e => e.stopPropagation());

    // ─── History View Event Wiring ───
    
    // Site filter change
    shadowRoot.getElementById('ss-hist-site-filter').addEventListener('change', e => {
      e.stopPropagation();
      renderHistoryList();
    });

    // View all button
    shadowRoot.getElementById('ss-hist-view-all').addEventListener('click', e => {
      e.stopPropagation();
      try {
        ext.runtime.sendMessage({ action: 'openHistoryPage' });
      } catch (_) {
        // Fallback: click behavior
      }
    });

    // Context menu actions
    shadowRoot.getElementById('ss-hist-ctx-open').addEventListener('click', e => {
      e.stopPropagation();
      if (activeHistItemId) {
        ext.storage.local.get(['inspectionHistory'], (result) => {
          const history = result.inspectionHistory || [];
          const found = history.find(h => h.id === activeHistItemId);
          if (found) {
            try {
              const target = document.querySelector(found.tag);
              if (target) {
                switchView('inspector');
                populate(target);
                highlightEl(target, 'select');
              } else {
                alert('Element could not be found on the current page.');
              }
            } catch (_) {}
          }
        });
      }
      closeHistContextMenu();
    });

    shadowRoot.getElementById('ss-hist-ctx-delete').addEventListener('click', e => {
      e.stopPropagation();
      if (activeHistItemId) {
        ext.storage.local.get(['inspectionHistory'], (result) => {
          let history = result.inspectionHistory || [];
          history = history.filter(h => h.id !== activeHistItemId);
          ext.storage.local.set({ inspectionHistory: history }, () => {
            renderHistoryList();
          });
        });
      }
      closeHistContextMenu();
    });

    // Tailwind version toggle listener
    const twV3Btn = shadowRoot.getElementById('ss-tw-v3-btn');
    const twV4Btn = shadowRoot.getElementById('ss-tw-v4-btn');
    
    const updateVersionToggleUI = () => {
      if (selectedTailwindVersion === 'v4') {
        twV3Btn.classList.remove('ss-active');
        twV4Btn.classList.add('ss-active');
      } else {
        twV3Btn.classList.add('ss-active');
        twV4Btn.classList.remove('ss-active');
      }
    };
    
    updateVersionToggleUI();
    
    twV3Btn.addEventListener('click', e => {
      e.stopPropagation();
      selectedTailwindVersion = 'v3';
      try { ext.storage.local.set({ selectedTailwindVersion: 'v3' }); } catch(_) {}
      updateVersionToggleUI();
      if (selectedEl) populate(selectedEl);
    });
    
    twV4Btn.addEventListener('click', e => {
      e.stopPropagation();
      selectedTailwindVersion = 'v4';
      try { ext.storage.local.set({ selectedTailwindVersion: 'v4' }); } catch(_) {}
      updateVersionToggleUI();
      if (selectedEl) populate(selectedEl);
    });

    // Close context menu on outside click
    document.addEventListener('click', () => closeHistContextMenu());
    panelEl.addEventListener('click', () => closeHistContextMenu());
  }

  // ═══════════════════════════════════════════════════════════════
  // DRAG
  // ═══════════════════════════════════════════════════════════════

  function startDrag(e) {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    const rect = panelEl.getBoundingClientRect();
    panelRight = window.innerWidth - rect.right;
    panelTop   = rect.top;
    
    // Lock the height inline and clear bottom property so dragging works smoothly
    panelEl.style.height = `${rect.height}px`;
    panelEl.style.bottom = 'auto';
    
    document.addEventListener('mousemove', onDrag, { passive: true });
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
  }

  function onDrag(e) {
    if (!isDragging) return;
    panelRight = Math.max(0, panelRight - (e.clientX - dragStartX));
    panelTop   = Math.max(0, panelTop   + (e.clientY - dragStartY));
    panelEl.style.right = `${panelRight}px`;
    panelEl.style.top   = `${panelTop}px`;
    dragStartX = e.clientX; dragStartY = e.clientY;
  }

  function stopDrag() {
    isDragging = false;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
  }

  function updateSelectionUI() {
    if (!shadowRoot) return;
    const activeState = shadowRoot.getElementById('ss-inspector-active-state');
    if (activeState) {
      activeState.classList.remove('ss-hidden');
    }

    if (!selectedEl) {
      const elName = shadowRoot.getElementById('ss-el-name');
      if (elName) elName.textContent = "Click any element";

      const elDesc = shadowRoot.getElementById('ss-el-desc');
      if (elDesc) elDesc.textContent = "← Hover and click to inspect";

      const elTag = shadowRoot.getElementById('ss-el-tag');
      if (elTag) elTag.textContent = "—";

      const thumb = shadowRoot.getElementById('ss-thumb');
      const ph = shadowRoot.getElementById('ss-thumb-ph');
      if (thumb) {
        const old = thumb.querySelector('.ss-clone-wrap');
        if (old) old.remove();
        thumb.style.border = '1.5px dashed #E2E8F0';
        thumb.style.background = '#F8FAFC';
      }
      if (ph) {
        ph.classList.remove('ss-hidden');
      }

      const codeInner = shadowRoot.getElementById('ss-code-inner');
      if (codeInner) {
        codeInner.textContent = "← Click any element on the page to generate its Tailwind component";
        codeInner.style.cssText = "color:#64748b; font-style:italic;";
      }

      const grid = shadowRoot.getElementById('ss-cls-grid');
      if (grid) {
        grid.innerHTML = `<span class="ss-cls-pill" style="color:#9CA3AF;background:#F9FAFB;border-color:#F3F4F6">No element selected</span>`;
      }

      const tbl = shadowRoot.getElementById('ss-styles-tbl');
      if (tbl) {
        tbl.innerHTML = `
          <div class="ss-style-row">
            <span class="ss-style-prop">—</span>
            <span class="ss-style-val" style="color:#9CA3AF">No element selected</span>
          </div>
        `;
      }
    } else {
      const thumb = shadowRoot.getElementById('ss-thumb');
      if (thumb) {
        thumb.style.border = '1px solid #E2E8F0';
        thumb.style.background = '#FFFFFF';
      }
      const codeInner = shadowRoot.getElementById('ss-code-inner');
      if (codeInner) {
        codeInner.style.cssText = '';
      }
    }
  }

  // ─── VIEW AND HISTORY CONTROLLERS ─────────────────────────────
  function switchView(viewName) {
    activeView = viewName;
    const inspectorView = shadowRoot.getElementById('ss-inspector-view');
    const historyView = shadowRoot.getElementById('ss-history-view');
    const headerInspectBtn = shadowRoot.getElementById('ss-header-inspect-btn');
    const headerHistoryBtn = shadowRoot.getElementById('ss-header-history-btn');
    
    if (inspectorView) { inspectorView.classList.remove('ss-fade-in'); }
    if (historyView) { historyView.classList.remove('ss-fade-in'); }
    void inspectorView?.offsetWidth;
    void historyView?.offsetWidth;
    
    if (viewName === 'history') {
      if (inspectorView) {
        inspectorView.classList.add('ss-hidden');
        inspectorView.style.display = 'none';
      }
      if (historyView) {
        historyView.classList.remove('ss-hidden');
        historyView.classList.add('ss-fade-in');
        historyView.style.setProperty('display', 'flex', 'important');
      }
      
      if (headerInspectBtn) headerInspectBtn.classList.remove('ss-hidden');
      if (headerHistoryBtn) headerHistoryBtn.classList.add('ss-hidden');
      
      // Resize panel to narrow mode
      if (panelEl) panelEl.style.width = '360px';
      
      renderHistoryList();
    } else {
      if (inspectorView) {
        inspectorView.classList.remove('ss-hidden');
        inspectorView.classList.add('ss-fade-in');
        inspectorView.style.setProperty('display', 'flex', 'important');
      }
      if (historyView) {
        historyView.classList.add('ss-hidden');
        historyView.style.display = 'none';
      }
      
      if (headerInspectBtn) headerInspectBtn.classList.add('ss-hidden');
      if (headerHistoryBtn) headerHistoryBtn.classList.remove('ss-hidden');
      
      // Resize panel to slightly wider mode than history panel
      if (panelEl) panelEl.style.width = '400px';

      // ── RESTORE INSPECTOR STATE ──────────────────────────────
      // Re-populate the inspector with the previously selected element.
      // This ensures code, thumbnail, breadcrumbs, and classes are
      // all exactly as the user left them — no reset, no blank state.
      if (selectedEl) {
        // Small rAF delay so the panel is visible before we paint into it
        requestAnimationFrame(() => {
          populate(selectedEl);
          // Re-draw the selection overlay on the element
          highlightEl(selectedEl, 'select');
        });
      }
    }
  }

  function renderHistoryList() {
    try {
      const container = shadowRoot.getElementById('ss-hist-items-container');
      const emptyState = shadowRoot.getElementById('ss-hist-empty-state');
      const populatedState = shadowRoot.getElementById('ss-hist-populated-state');
      const viewAllBtn = shadowRoot.getElementById('ss-hist-view-all');
      if (!container) return;
      
      ext.storage.local.get(['inspectionHistory'], (result) => {
        try {
          let history = result.inspectionHistory || [];
        
        // Remove mock data check to prevent seeding
        const filterVal = shadowRoot.getElementById('ss-hist-site-filter').value;
        if (filterVal && filterVal !== 'All Sites') {
          history = history.filter(item => item.site === filterVal);
        }
        
        updateSiteFilterDropdown();

        if (history.length === 0) {
          if (filterVal && filterVal !== 'All Sites') {
            container.innerHTML = `<div style="text-align:center;color:#64748b;padding:24px 0;">No items found for this site.</div>`;
            if (emptyState) emptyState.classList.add('ss-hidden');
            if (populatedState) populatedState.classList.remove('ss-hidden');
          } else {
            if (emptyState) emptyState.classList.remove('ss-hidden');
            if (populatedState) populatedState.classList.add('ss-hidden');
          }
          if (viewAllBtn) {
            viewAllBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              View all history
            `;
          }
          return;
        }

        if (emptyState) emptyState.classList.add('ss-hidden');
        if (populatedState) populatedState.classList.remove('ss-hidden');
        
        if (viewAllBtn) {
          viewAllBtn.innerHTML = 'All history shown';
        }

        container.innerHTML = history.map(item => {
          let thumbHtml = '';
          const elType = item.elType || 'card';
          const elText = item.elText || '';
          const elBg = item.elBg || '#FFFFFF';
          const elColor = item.elColor || '#000000';

          if (elType === 'btn') {
            thumbHtml = `
              <div class="ss-hist-thumb" style="background:#F8FAFC; padding:4px; display:flex; align-items:center; justify-content:center;">
                <button style="background:${elBg === 'transparent' || elBg === 'rgba(0, 0, 0, 0)' ? '#111827' : elBg}; color:${elColor || '#ffffff'}; border:none; border-radius:4px; font-size:5px; font-weight:700; padding:4px 6px; cursor:default; font-family:inherit; white-space:nowrap; max-width:80px; overflow:hidden; text-overflow:ellipsis; scale: 0.85;">${elText || 'Button'}</button>
              </div>
            `;
          } else if (elType === 'heading') {
            thumbHtml = `
              <div class="ss-hist-thumb" style="padding:6px; background:#FFFFFF; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:2px;">
                <span style="font-size:7px; font-weight:850; color:#111; line-height:1.2; display:block; max-height:16px; overflow:hidden; text-align:left; font-family:inherit;">${elText || 'Heading'}</span>
                <span style="font-size:4.5px; color:#64748b; font-family:inherit; text-align:left; line-height:1.1; overflow:hidden; max-height:10px; display:block;">Blazing fast performance...</span>
              </div>
            `;
          } else if (elType === 'input') {
            thumbHtml = `
              <div class="ss-hist-thumb" style="padding:6px; background:#F8FAFC;">
                <div style="width:100%; border:1px solid #d1d5db; border-radius:4px; background:#fff; padding:3px 6px; display:flex; align-items:center; gap:3px;">
                  <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <span style="font-size:5px; color:#9ca3af; font-family:inherit; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${elText || 'Search...'}</span>
                </div>
              </div>
            `;
          } else if (elType === 'navbar') {
            thumbHtml = `
              <div class="ss-hist-thumb" style="padding:4px; background:#FFFFFF; display:flex; flex-direction:column; justify-content:center; gap:3px;">
                <div style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#fff; padding:3px 4px; border:1px solid #e2e8f0; border-radius:4px; box-shadow:0 1px 2px rgba(0,0,0,0.01);">
                  <span style="font-size:5.5px; font-weight:800; color:#111; display:flex; align-items:center; gap:1.5px;"><div style="width:3px; height:3px; background:#2563eb; border-radius:50%;"></div>Logo</span>
                  <div style="display:flex; gap:2.5px; font-size:4.5px; color:#64748b;">
                    <span>Home</span><span>About</span>
                  </div>
                </div>
              </div>
            `;
          } else if (elType === 'image') {
            thumbHtml = `
              <div class="ss-hist-thumb" style="padding:6px; background:#F8FAFC;">
                <div style="width:100%; height:100%; border-radius:5px; background:#f1f5f9; border:1px solid #e2e8f0; display:flex; align-items:center; justify-content:center;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </div>
              </div>
            `;
          } else {
            thumbHtml = `
              <div class="ss-hist-thumb" style="background:#FFFFFF; padding:6px;">
                <div style="width:100%; height:100%; border:1px solid #f1f5f9; border-radius:5px; background:#ffffff; padding:4px; display:flex; align-items:center; gap:4px; box-shadow:0 1px 2px rgba(0,0,0,0.01);">
                  <div style="width:14px; height:14px; border-radius:4px; background:#eef2ff; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:0px; min-width:0; text-align:left;">
                    <span style="font-size:5px; font-weight:700; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family:inherit;">Performance</span>
                    <span style="font-size:4px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family:inherit;">Blazing fast...</span>
                  </div>
                </div>
              </div>
            `;
          }

          const isSel = (item.id === activeHistItemId) ? ' ss-history-item--selected' : '';
          const favColor = item.favorited ? '#F59E0B' : 'transparent';
          const favStroke = item.favorited ? '#F59E0B' : '#94A3B8';

          return `
            <div class="ss-history-item${isSel}" data-id="${item.id}">
              ${thumbHtml}
              <div class="ss-hist-item-info">
                <div class="ss-hist-item-name">${item.name}</div>
                <div class="ss-hist-item-tag">${item.tag}</div>
                <div class="ss-hist-item-time">${item.time}</div>
              </div>
              <div class="ss-hist-item-actions">
                <button class="ss-hist-fav-btn" data-id="${item.id}" title="Favorite">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="${favColor}" stroke="${favStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </button>
                <button class="ss-hist-menu-btn" data-id="${item.id}" title="Options">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                  </svg>
                </button>
              </div>
            </div>
          `;
        }).join('');
        
        shadowRoot.querySelectorAll('.ss-history-item').forEach(itemEl => {
          itemEl.addEventListener('click', (e) => {
            if (e.target.closest('.ss-hist-menu-btn') || e.target.closest('.ss-hist-fav-btn')) return;
            const id = parseFloat(itemEl.dataset.id);
            const found = history.find(h => h.id === id);
            if (found) {
              try {
                const target = document.querySelector(found.tag);
                if (target) {
                  switchView('inspector');
                  populate(target);
                  highlightEl(target, 'select');
                } else {
                  alert('Element could not be found on the current page.');
                }
              } catch (_) {}
            }
          });
        });
        
        shadowRoot.querySelectorAll('.ss-hist-fav-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseFloat(btn.dataset.id);
            const foundIndex = history.findIndex(h => h.id === id);
            if (foundIndex !== -1) {
              history[foundIndex].favorited = !history[foundIndex].favorited;
              ext.storage.local.set({ inspectionHistory: history }, () => {
                renderHistoryList();
              });
            }
          });
        });

        shadowRoot.querySelectorAll('.ss-hist-menu-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseFloat(btn.dataset.id);
            showHistContextMenu(e, id);
          });
        });
        } catch (err) {
          console.error("Error rendering history:", err);
        }
      });
    } catch (_) {}
  }

  function updateSiteFilterDropdown() {
    try {
      const select = shadowRoot.getElementById('ss-hist-site-filter');
      if (!select) return;
      
      ext.storage.local.get(['inspectionHistory'], (result) => {
        try {
          const history = result.inspectionHistory || [];
        const sites = ['All Sites'];
        history.forEach(item => {
          if (item.site && !sites.includes(item.site)) {
            sites.push(item.site);
          }
        });
        
        const currentVal = select.value;
        select.innerHTML = sites.map(s => `<option>${s}</option>`).join('');
        if (sites.includes(currentVal)) {
          select.value = currentVal;
        } else {
          select.value = 'All Sites';
        }
        } catch (err) {
          console.error("Error updating site filter:", err);
        }
      });
    } catch (_) {}
  }

  function showHistContextMenu(e, id) {
    try {
      const menu = shadowRoot.getElementById('ss-hist-context-menu');
      if (!menu) return;
      
      activeHistItemId = id;
      menu.classList.remove('ss-hidden');
      
      const rect = e.currentTarget.getBoundingClientRect();
      const panelRect = panelEl.getBoundingClientRect();
      
      let left = rect.left - panelRect.left - 130;
      let top = rect.bottom - panelRect.top + 4;
      
      if (left < 10) left = 10;
      if (top + 130 > panelRect.height) {
        top = rect.top - panelRect.top - 130;
      }
      
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      
      e.currentTarget.classList.add('active');
    } catch (_) {}
  }

  function closeHistContextMenu() {
    try {
      const menu = shadowRoot.getElementById('ss-hist-context-menu');
      if (menu) menu.classList.add('ss-hidden');
      shadowRoot.querySelectorAll('.ss-hist-menu-btn.active').forEach(b => b.classList.remove('active'));
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // TABS
  // ═══════════════════════════════════════════════════════════════

  function switchTab(name) {
    activeTab = name;
    shadowRoot.querySelectorAll('.ss-tab').forEach(t =>
      t.classList.toggle('ss-tab--active', t.dataset.tab === name));
    ['tailwind', 'classes', 'styles'].forEach(n => {
      const pane = shadowRoot.getElementById(`ss-pane-${n}`);
      if (pane) pane.classList.toggle('ss-hidden', n !== name);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // POPULATE PANEL
  // ═══════════════════════════════════════════════════════════════

  function openPanel(el) {
    if (!shadowHost) createPanel();
    selectedEl = el;
    panelEl.classList.remove('ss-hidden');

    // Animate in
    panelEl.classList.add('ss-entering');
    requestAnimationFrame(() => requestAnimationFrame(() =>
      panelEl.classList.remove('ss-entering')));

    populate(el);
    try { ext.runtime.sendMessage({ type: 'telemetry', event: 'inspection_started' }); } catch(_) {}
  }

  function buildHistoryItemData(el) {
    const name = getPreviewText(el) || el.tagName.toLowerCase();
    const tag = getSelector(el);
    const badge = getLabel(el);
    let elType = 'card';
    let elBg = '#FFFFFF';
    let elColor = '#000000';
    try {
      const cs = window.getComputedStyle(el);
      elBg = cs.backgroundColor;
      elColor = cs.color;
    } catch(e){}

    const tagLow = el.tagName.toLowerCase();
    const lbl = badge;
    if (lbl === 'BUTTON') elType = 'btn';
    else if (lbl === 'TEXT') elType = 'heading';
    else if (lbl === 'IMAGE') elType = 'image';
    else if (lbl === 'SECTION') elType = 'navbar';
    else if (tagLow === 'input' || tagLow === 'textarea') elType = 'input';

    const codeReactTSX = generateComponent(el, 'React (TSX)');
    const codeReactJSX = generateComponent(el, 'React (JSX)');
    const codeVue = generateComponent(el, 'Vue 3');
    const codeHTML = generateComponent(el, 'HTML');
    const classes = stylesToTailwind(extractStyles(el)).join(' ');

    return {
      name, tag, badge,
      elType, elText: name, elBg, elColor,
      codeReactTSX, codeReactJSX, codeVue, codeHTML, classes
    };
  }

  function saveToHistory(el) {
    try {
      ext.storage.local.get(['inspectionHistory'], (res) => {
        let history = res.inspectionHistory || [];
        const id = Date.now();
        const site = window.location.hostname;
        const time = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        
        const itemData = buildHistoryItemData(el);

        // Check for duplicates (same selector on the same host site)
        const dupIndex = history.findIndex(h => h.tag === itemData.tag && h.site === site);
        let favorited = false;
        if (dupIndex !== -1) {
          favorited = history[dupIndex].favorited;
          history.splice(dupIndex, 1); // remove old duplicate to move it to the top
        }

        const newItem = {
          id, site, time,
          favorited,
          ...itemData
        };
        
        history.unshift(newItem);
        if (history.length > 500) history = history.slice(0, 500);
        
        ext.storage.local.set({ inspectionHistory: history }, () => {
          if (typeof activeView !== 'undefined' && activeView === 'history') {
            renderHistoryList();
          }
        });
      });
    } catch (e) {}
  }

  function toggleFavoriteCurrentElement() {
    if (!selectedEl) return;
    const tag = getSelector(selectedEl);
    const site = window.location.hostname;
    
    ext.storage.local.get(['inspectionHistory'], (res) => {
      let history = res.inspectionHistory || [];
      const foundIndex = history.findIndex(h => h.tag === tag && h.site === site);
      
      let isFav = false;
      if (foundIndex !== -1) {
        history[foundIndex].favorited = !history[foundIndex].favorited;
        isFav = history[foundIndex].favorited;
      } else {
        const id = Date.now();
        const time = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const itemData = buildHistoryItemData(selectedEl);

        const newItem = {
          id, site, time,
          favorited: true,
          ...itemData
        };
        history.unshift(newItem);
        isFav = true;
      }
      
      ext.storage.local.set({ inspectionHistory: history }, () => {
        updateFavBtnUI(isFav);
        if (typeof activeView !== 'undefined' && activeView === 'history') {
          renderHistoryList();
        }
      });
    });
  }

  function checkIfCurrentElementIsFavorited() {
    if (!selectedEl) {
      updateFavBtnUI(false);
      return;
    }
    const tag = getSelector(selectedEl);
    const site = window.location.hostname;
    ext.storage.local.get(['inspectionHistory'], (res) => {
      const history = res.inspectionHistory || [];
      const found = history.find(h => h.tag === tag && h.site === site);
      updateFavBtnUI(found ? found.favorited : false);
    });
  }

  function updateFavBtnUI(isFav) {
    if (!shadowRoot) return;
    const btn = shadowRoot.getElementById('ss-fav-btn');
    if (!btn) return;
    const svg = btn.querySelector('svg');
    if (!svg) return;
    
    if (isFav) {
      svg.setAttribute('fill', '#F59E0B');
      svg.setAttribute('stroke', '#F59E0B');
      btn.style.color = '#F59E0B';
      btn.title = "Remove from favorites";
    } else {
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      btn.style.color = '#94a3b8';
      btn.title = "Add to favorites";
    }
  }

  function rgbStringToHex(rgbStr) {
    if (!rgbStr) return '#000000';
    const m = rgbStr.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return rgbStr;
    const r = parseInt(m[1]).toString(16).padStart(2, '0').toUpperCase();
    const g = parseInt(m[2]).toString(16).padStart(2, '0').toUpperCase();
    const b = parseInt(m[3]).toString(16).padStart(2, '0').toUpperCase();
    return `#${r}${g}${b}`;
  }

  function getWeightName(weight) {
    const w = parseInt(weight);
    if (isNaN(w)) return weight;
    if (w <= 100) return 'Thin';
    if (w <= 200) return 'Extra Light';
    if (w <= 300) return 'Light';
    if (w <= 400) return 'Regular';
    if (w <= 500) return 'Medium';
    if (w <= 600) return 'Semi Bold';
    if (w <= 700) return 'Bold';
    if (w <= 800) return 'Extra Bold';
    return 'Black';
  }

  function getCleanFontFamily(fontFamily) {
    if (!fontFamily) return 'System';
    const first = fontFamily.split(',')[0].trim();
    return first.replace(/['"]/g, '');
  }

  function populate(el) {
    selectedEl = el;
    updateSelectionUI();
    checkIfCurrentElementIsFavorited();

    // Enable select action buttons
    try {
      const favBtn = shadowRoot.getElementById('ss-fav-btn');
      const scrollBtn = shadowRoot.getElementById('ss-scroll-btn');
      const copySelBtn = shadowRoot.getElementById('ss-copy-sel');
      if (favBtn) { favBtn.disabled = false; favBtn.style.opacity = '1'; favBtn.style.pointerEvents = 'auto'; }
      if (scrollBtn) { scrollBtn.disabled = false; scrollBtn.style.opacity = '1'; scrollBtn.style.pointerEvents = 'auto'; }
      if (copySelBtn) { copySelBtn.disabled = false; copySelBtn.style.opacity = '1'; copySelBtn.style.pointerEvents = 'auto'; }
    } catch (_) {}

    const lbl = getLabel(el);
    const isText = (lbl === 'TEXT');
    
    const genCard = shadowRoot.getElementById('ss-preview-general-card');
    const textCard = shadowRoot.getElementById('ss-preview-text-card');
    if (genCard && textCard) {
      genCard.classList.toggle('ss-hidden', isText);
      textCard.classList.toggle('ss-hidden', !isText);
    }

    if (isText) {
      const styles = extractStyles(el);
      const textVal = el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : '';
      const textPreview = textVal.length > 80 ? textVal.slice(0, 77) + '…' : textVal;
      
      const pDisplay = shadowRoot.getElementById('ss-text-preview-display');
      if (pDisplay) {
        pDisplay.textContent = textPreview || el.tagName.toLowerCase();
        pDisplay.style.fontFamily = styles.fontFamily;
        pDisplay.style.fontWeight = styles.fontWeight;
        pDisplay.style.color = styles.color;
      }
      
      // Build CSS class / selector string
      const clsList = stylesToTailwind(styles, el).join('.');
      const selStr = `${el.tagName.toLowerCase()}${clsList ? '.' + clsList : ''}`;
      const selectorDisplay = shadowRoot.getElementById('ss-text-selector-display');
      if (selectorDisplay) {
        selectorDisplay.textContent = selStr;
      }
      
      // Update Specs
      const fontDisplay = shadowRoot.getElementById('ss-text-spec-font');
      if (fontDisplay) fontDisplay.textContent = getCleanFontFamily(styles.fontFamily);
      
      const sizeDisplay = shadowRoot.getElementById('ss-text-spec-size');
      if (sizeDisplay) sizeDisplay.textContent = styles.fontSize;
      
      const weightDisplay = shadowRoot.getElementById('ss-text-spec-weight');
      if (weightDisplay) weightDisplay.textContent = `${styles.fontWeight} (${getWeightName(styles.fontWeight)})`;
      
      const hexColor = rgbStringToHex(styles.color);
      const colorDisplay = shadowRoot.getElementById('ss-text-spec-color');
      if (colorDisplay) colorDisplay.textContent = hexColor;
      
      const swatchDisplay = shadowRoot.getElementById('ss-text-spec-color-swatch');
      if (swatchDisplay) {
        swatchDisplay.style.background = styles.color;
        swatchDisplay.style.display = 'inline-block';
      }
    } else {
      // Name / tag / badge (default)
      const name = getPreviewText(el) || el.tagName.toLowerCase();
      shadowRoot.getElementById('ss-el-name').textContent =
        name.length > 32 ? name.slice(0,29)+'…' : name;
      shadowRoot.getElementById('ss-el-tag').textContent = getSelector(el);

      const badgeEl = shadowRoot.getElementById('ss-el-badge');
      if (badgeEl) {
        badgeEl.textContent = lbl;
        badgeEl.className = `ss-badge ${labelClass(lbl)}`;
      }
    }

    // Set code block loading placeholder
    const codeInner = shadowRoot.getElementById('ss-code-inner');
    if (codeInner) {
      codeInner.innerHTML = '<span style="color:#64748b;font-style:italic">Generating component...</span>';
    }

    // Set thumbnail loading placeholder
    const thumb = shadowRoot.getElementById('ss-thumb');
    const ph = shadowRoot.getElementById('ss-thumb-ph');
    if (thumb) {
      const old = thumb.querySelector('.ss-clone-wrap');
      if (old) old.remove();
    }
    if (ph && !isText) {
      ph.classList.remove('ss-hidden');
    }

    // Framework options dropdown styling
    let fw = selectedFramework;
    const fwValEl = shadowRoot.getElementById('ss-framework-val');
    if (fwValEl) {
      fwValEl.textContent = fw;
    }
    const options = shadowRoot.getElementById('ss-framework-options');
    if (options) {
      options.querySelectorAll('.ss-dropdown-option').forEach(o => {
        if (o.getAttribute('data-value') === fw) {
          o.classList.add('ss-selected');
        } else {
          o.classList.remove('ss-selected');
        }
      });
    }

    // Build Breadcrumbs
    const breadcrumbsContainer = shadowRoot.getElementById('ss-el-breadcrumbs');
    if (breadcrumbsContainer) {
      let parents = [];
      let cur = el;
      let shadowPathIndices = new Set();
      while (cur && parents.length < 4) {
        parents.unshift(cur);
        const parent = cur.parentElement;
        if (parent) {
          cur = parent;
        } else {
          const root = cur.getRootNode();
          if (root && root.host) {
            shadowPathIndices.add(parents.length - 1);
            cur = root.host;
          } else {
            cur = null;
          }
        }
      }
      
      breadcrumbsContainer.innerHTML = parents.map((p, idx) => {
        const tagName = p.tagName.toLowerCase();
        const className = p.className && typeof p.className === 'string'
          ? p.className.trim().split(/\s+/)[0]
          : '';
        const classStr = className ? `.${className.slice(0, 12)}` : '';
        const isLast = idx === parents.length - 1;
        const label = `${tagName}${classStr}`;
        
        let prefix = '';
        if (shadowPathIndices.has(idx)) {
          prefix = `<span class="ss-breadcrumb-shadow-badge" style="font-size: 8px; font-weight: 800; background: #e2e8f0; color: #475569; padding: 1.5px 4.5px; border-radius: 4px; margin-right: 4.5px; vertical-align: middle; display: inline-block;">SHADOW</span>`;
          if (panelEl && panelEl.classList.contains('ss-dark')) {
            prefix = `<span class="ss-breadcrumb-shadow-badge" style="font-size: 8px; font-weight: 800; background: #334155; color: #cbd5e1; padding: 1.5px 4.5px; border-radius: 4px; margin-right: 4.5px; vertical-align: middle; display: inline-block;">SHADOW</span>`;
          }
        }
        
        return `<span class="ss-breadcrumb-item${isLast ? ' ss-breadcrumb-item--active' : ''}" data-index="${idx}">${prefix}${label}</span>`;
      }).join('<span class="ss-breadcrumb-separator">›</span>');

      // Click handler
      breadcrumbsContainer.querySelectorAll('.ss-breadcrumb-item').forEach(item => {
        item.addEventListener('click', e => {
          e.stopPropagation();
          const idx = parseInt(item.getAttribute('data-index'));
          const targetParent = parents[idx];
          if (targetParent && targetParent !== selectedEl) {
            highlightEl(targetParent, 'select');
            selectedElHoverClasses = [];
            selectedElDefaultStyles = extractStyles(targetParent);
            populate(targetParent);
          }
        });
      });
    }

    // Classes
    updateClasses(el);

    // Styles
    updateStyles(el);

    // Defer the heavy generation to prevent layout blocking
    setTimeout(() => {
      if (selectedEl !== el) return;
      if (!isText) {
        buildThumb(el);
      }
      updateCode(el, fw);
    }, 25);
  }

  // ─── THUMBNAIL ───────────────────────────────────────────────
  // ─── THUMBNAIL HELPERS ─────────────────────────────────────────
  function getInheritedBackgroundColor(el) {
    let cur = el;
    while (cur) {
      try {
        const bg = window.getComputedStyle(cur).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'initial' && bg !== 'inherit') {
          return bg;
        }
      } catch (_) {}
      cur = cur.parentElement;
    }
    return 'transparent';
  }

  function cloneNodeWithShadows(node) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return node.cloneNode(false);
    }
    const clone = node.cloneNode(false);
    if (node.shadowRoot) {
      const shadowClone = clone.attachShadow({ mode: node.shadowRoot.mode || 'open' });
      for (const child of node.shadowRoot.childNodes) {
        shadowClone.appendChild(cloneNodeWithShadows(child));
      }
    }
    for (const child of node.childNodes) {
      clone.appendChild(cloneNodeWithShadows(child));
    }
    return clone;
  }

  // ─── THUMBNAIL ───────────────────────────────────────────────
  function buildThumb(el) {
    const thumb = shadowRoot.getElementById('ss-thumb');
    const ph = shadowRoot.getElementById('ss-thumb-ph');

    // Remove old clone
    const old = thumb.querySelector('.ss-clone-wrap');
    if (old) old.remove();

    try {
      const elRect = el.getBoundingClientRect();
      if (!elRect.width || !elRect.height) { ph.classList.remove('ss-hidden'); return; }

      ph.classList.add('ss-hidden');

      const clone = cloneNodeWithShadows(el);
      
      // Sanitization to prevent CSP / script / frame execution errors on complex pages (e.g. Gemini)
      const dangerousTags = ['script', 'iframe', 'noscript', 'template', 'object', 'embed', 'style', 'link', 'meta', 'base'];
      if (dangerousTags.includes(clone.tagName.toLowerCase())) {
        ph.classList.remove('ss-hidden');
        return;
      }
      
      clone.querySelectorAll(dangerousTags.join(',')).forEach(e => e.remove());
      
      const stripEvents = (node) => {
        if (node.attributes) {
          const toRemove = [];
          for (let i = 0; i < node.attributes.length; i++) {
            const attrName = node.attributes[i].name;
            if (attrName.startsWith('on')) {
              toRemove.push(attrName);
            }
          }
          toRemove.forEach(attrName => node.removeAttribute(attrName));
        }
        if (node.children) {
          for (let i = 0; i < node.children.length; i++) {
            stripEvents(node.children[i]);
          }
        }
      };
      stripEvents(clone);

      applyInlineStyles(el, clone, 5, true);

      const thumbW = thumb.offsetWidth || 344;
      const thumbH = thumb.offsetHeight || 120;
      let scale = Math.min(thumbW / elRect.width, thumbH / elRect.height, 1);
      if (scale < 0.15) {
        scale = 0.15; // cap minimum scale to keep text and containers readable
      }

      const wrap = document.createElement('div');
      wrap.className = 'ss-clone-wrap';
      wrap.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        width: ${elRect.width}px;
        height: ${elRect.height}px;
        transform: translate(-50%, -50%) scale(${scale});
        transform-origin: center;
        overflow: hidden;
        pointer-events: none;
      `;

      // Apply inherited background color so transparent cards/texts render correctly
      const inheritedBg = getInheritedBackgroundColor(el);
      if (inheritedBg !== 'transparent') {
        wrap.style.backgroundColor = inheritedBg;
      }

      wrap.appendChild(clone);
      thumb.appendChild(wrap);
    } catch(err) {
      ph.classList.remove('ss-hidden');
    }
  }

  function applyInlineStyles(orig, clone, depth, isRoot = false) {
    if (depth < 0) return;
    try {
      const cs = window.getComputedStyle(orig);
      clone.style.cssText = '';

      const props = [
        'background-color','color','font-size','font-weight','font-family',
        'border-radius','border','padding','display','flex-direction',
        'align-items','justify-content','gap','line-height','box-shadow','opacity',
        'box-sizing', 'text-align', 'text-transform', 'letter-spacing',
        'border-top-width', 'border-top-style', 'border-top-color',
        'border-right-width', 'border-right-style', 'border-right-color',
        'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
        'border-left-width', 'border-left-style', 'border-left-color',
        'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
        'background-image', 'background-size', 'background-position', 'background-repeat',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height'
      ];
      props.forEach(p => {
        const v = cs.getPropertyValue(p);
        if (v) clone.style.setProperty(p, v, 'important');
      });

      if (isRoot) {
        clone.style.setProperty('position', 'absolute', 'important');
        clone.style.setProperty('top', '0', 'important');
        clone.style.setProperty('left', '0', 'important');
        clone.style.setProperty('margin', '0', 'important');
        clone.style.setProperty('transform', 'none', 'important');
        clone.style.setProperty('transition', 'none', 'important');
        clone.style.setProperty('animation', 'none', 'important');
        
        const rect = orig.getBoundingClientRect();
        clone.style.setProperty('width', `${rect.width}px`, 'important');
        clone.style.setProperty('height', `${rect.height}px`, 'important');
        clone.style.setProperty('box-sizing', 'border-box', 'important');
      } else {
        const w = cs.getPropertyValue('width');
        if (w && w !== 'auto') clone.style.setProperty('width', w, 'important');
        const h = cs.getPropertyValue('height');
        if (h && h !== 'auto') clone.style.setProperty('height', h, 'important');
        const pos = cs.getPropertyValue('position');
        if (pos && pos !== 'static') clone.style.setProperty('position', pos, 'important');
        const t = cs.getPropertyValue('top');
        if (t && t !== 'auto') clone.style.setProperty('top', t, 'important');
        const l = cs.getPropertyValue('left');
        if (l && l !== 'auto') clone.style.setProperty('left', l, 'important');
      }
      clone.style.setProperty('overflow', 'hidden', 'important');

      if (orig.shadowRoot && clone.shadowRoot) {
        const oKids = Array.from(orig.shadowRoot.children);
        const cKids = Array.from(clone.shadowRoot.children);
        for (let i = 0; i < Math.min(oKids.length, cKids.length, 30); i++) {
          applyInlineStyles(oKids[i], cKids[i], depth - 1, false);
        }
      }
      const oLight = Array.from(orig.children);
      const cLight = Array.from(clone.children);
      for (let i = 0; i < Math.min(oLight.length, cLight.length, 30); i++) {
        applyInlineStyles(oLight[i], cLight[i], depth - 1, false);
      }
    } catch(_) {}
  }

  // ─── CODE ────────────────────────────────────────────────────
  function updateCode(el, framework) {
    try {
      currentCode = generateComponent(el, framework);
      shadowRoot.getElementById('ss-code-inner').innerHTML = highlight(currentCode);
    } catch(e) {
      console.error("StyleSnoop generateComponent error:", e);
      shadowRoot.getElementById('ss-code-inner').textContent = '// Could not generate component';
      currentCode = '';
    }
  }

  // ─── CLASSES ─────────────────────────────────────────────────
  function updateClasses(el) {
    let cls = stylesToTailwind(extractStyles(el));
    if (el === selectedEl && selectedElHoverClasses.length > 0) {
      cls = [...cls, ...selectedElHoverClasses];
    }
    const grid = shadowRoot.getElementById('ss-cls-grid');
    grid.innerHTML = cls.length
      ? cls.map(c => `<span class="ss-cls-pill">${c}</span>`).join('')
      : '<span class="ss-cls-pill" style="color:#9CA3AF;background:#F9FAFB;border-color:#F3F4F6">No classes mapped</span>';
  }

  // ─── STYLES ──────────────────────────────────────────────────
  function updateStyles(el) {
    const s = extractStyles(el);
    const tbl = shadowRoot.getElementById('ss-styles-tbl');
    const rows = [
      ['font-family',     s.fontFamily],
      ['font-size',       s.fontSize],
      ['font-weight',     s.fontWeight],
      ['line-height',     s.lineHeight],
      ['color',           s.color],
      ['background-color',s.backgroundColor],
      ['background-image',s.backgroundImage && s.backgroundImage !== 'none' ? s.backgroundImage : null],
      ['padding',         `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`],
      ['margin',          `${s.marginTop} ${s.marginRight} ${s.marginBottom} ${s.marginLeft}`],
      ['border-radius',   s.borderRadius],
      ['border',          s.borderWidth !== '0px' ? s.border : 'none'],
      ['box-shadow',      s.boxShadow || 'none'],
      ['display',         s.display],
      ['width',           s.width],
      ['height',          s.height],
    ];

    tbl.innerHTML = rows.filter(([, v]) => v && v !== 'none' && v !== '0px 0px 0px 0px').map(([p, v]) => {
      const isColor = p === 'color' || p === 'background-color';
      const isGradient = p === 'background-image' && v && v.includes('gradient');
      const swatch = isColor && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent'
        ? `<span class="ss-swatch" style="background:${v}"></span>`
        : isGradient
        ? `<span class="ss-swatch" style="background:${v}"></span>` : '';
      return `<div class="ss-style-row">
        <span class="ss-style-prop">${p}</span>
        <span class="ss-style-val">${swatch}${v}</span>
      </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════
  // CLIPBOARD
  // ═══════════════════════════════════════════════════════════════

  function clipCopy(text, btnEl, onSuccess, iconTick) {
    navigator.clipboard.writeText(text).then(() => {
      if (onSuccess) { onSuccess(); return; }
      if (!btnEl) return;

      if (iconTick) {
        // Icon button — just color it green
        btnEl.classList.add('ss-copied');
        setTimeout(() => btnEl.classList.remove('ss-copied'), 1500);
        return;
      }
      // Text button
      const origHTML = btnEl.innerHTML;
      btnEl.innerHTML = '✓ Copied!';
      btnEl.classList.add('ss-copied');
      setTimeout(() => {
        btnEl.innerHTML = origHTML;
        btnEl.classList.remove('ss-copied');
      }, 1800);
    }).catch(() => {
      // Fallback
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      } catch(_) {}
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // HOVER HIGHLIGHT
  // ═══════════════════════════════════════════════════════════════

  function isInsidePanel(e) {
    if (!shadowHost) return false;
    try {
      const path = e.composedPath ? e.composedPath() : [];
      return path.includes(shadowHost) || path.includes(shadowRoot);
    } catch(_) { return false; }
  }

  function getTargetFromEvent(e) {
    if (e.composedPath) {
      const path = e.composedPath();
      if (path && path.length > 0) {
        // Return first Element Node
        for (const node of path) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return node;
          }
        }
      }
    }
    return e.target;
  }

  let hoverFrameId = null;
  let latestMoveEvent = null;

  function processHover() {
    hoverFrameId = null;
    if (!latestMoveEvent) return;
    const e = latestMoveEvent;
    const el = getTargetFromEvent(e);
    if (el === hoveredEl) { posTooltip(e); return; }
    if (hoveredEl && hoveredEl !== selectedEl) restoreEl(hoveredEl);
    hoveredEl = el;
    highlightEl(el, 'hover');
    posTooltip(e);

    // Auto-capture hover styles on the selected element
    if (selectedEl && el === selectedEl) {
      captureHoverStyles();
    }
  }

  function onMouseMove(e) {
    if (!active || isInsidePanel(e)) return;
    latestMoveEvent = e;
    if (!hoverFrameId) {
      hoverFrameId = requestAnimationFrame(processHover);
    }
  }

  function onMouseOut(e) {
    if (!active || isInsidePanel(e)) return;
    latestMoveEvent = null;
    if (hoverFrameId) {
      cancelAnimationFrame(hoverFrameId);
      hoverFrameId = null;
    }
    if (hoveredEl && hoveredEl !== selectedEl) { restoreEl(hoveredEl); hoveredEl = null; }
    if (tooltipEl) tooltipEl.classList.add('ss-hidden');
  }

  function onClick(e) {
    if (!active || isInsidePanel(e)) return;
    e.preventDefault(); e.stopPropagation();
    
    // Hide old select overlay before showing the new one
    if (shadowRoot) {
      const selectOverlay = shadowRoot.getElementById('ss-select-overlay');
      if (selectOverlay) selectOverlay.classList.add('ss-hidden');
    }

    const targetEl = getTargetFromEvent(e);
    if (selectedEl && selectedEl !== targetEl) restoreEl(selectedEl);
    selectedEl = targetEl;
    highlightEl(selectedEl, 'select');
    selectedElHoverClasses = [];
    selectedElDefaultStyles = extractStyles(selectedEl);
    openPanel(selectedEl);
    if (tooltipEl) tooltipEl.classList.add('ss-hidden');
  }

  function updateOverlayStyles() {
    if (!shadowRoot) return;
    const hover = shadowRoot.getElementById('ss-hover-overlay');
    const select = shadowRoot.getElementById('ss-select-overlay');
    if (hover) {
      hover.style.borderColor = highlightColor;
      if (!highlightEnabled) hover.classList.add('ss-hidden');
    }
    if (select) {
      select.style.borderColor = highlightColor;
    }
  }

  // ─── Outline helpers ─────────────────────────────────────────
  function highlightEl(el, mode) {
    if (!el || !shadowRoot) return;
    if (mode === 'hover' && !highlightEnabled) return;
    
    if (!savedOutlines.has(el)) {
      savedOutlines.set(el, {
        cursor: el.style.cursor,
      });
    }
    el.style.cursor = 'crosshair';

    const rect = el.getBoundingClientRect();
    const overlayId = (mode === 'select') ? 'ss-select-overlay' : 'ss-hover-overlay';
    const overlay = shadowRoot.getElementById(overlayId);
    if (overlay) {
      overlay.style.top = `${rect.top}px`;
      overlay.style.left = `${rect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      
      const computed = window.getComputedStyle(el);
      overlay.style.borderRadius = computed.borderRadius;
      
      overlay.classList.remove('ss-hidden');
    }
  }

  function restoreEl(el) {
    if (!el) return;
    const saved = savedOutlines.get(el);
    if (saved) {
      el.style.cursor = saved.cursor;
    }
    // Hide hover overlay
    if (shadowRoot) {
      const hoverOverlay = shadowRoot.getElementById('ss-hover-overlay');
      if (hoverOverlay) hoverOverlay.classList.add('ss-hidden');
    }
  }

  function updateOverlayPositions() {
    if (!active) return;
    if (hoveredEl) {
      highlightEl(hoveredEl, 'hover');
    }
    if (selectedEl) {
      highlightEl(selectedEl, 'select');
    }
  }

  // ─── Tooltip ─────────────────────────────────────────────────
  function posTooltip(e) {
    if (!tooltipEl) return;
    const el = getTargetFromEvent(e);
    if (!el) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'iframe') {
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      tooltipEl.innerHTML = `
        <div style="font-family: 'Inter', sans-serif; line-height: 1.2;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; font-weight: 700;">
            <span style="color: #ef4444; display: flex; align-items: center; gap: 4px;">⚠️ iframe</span>
            <span style="color: #38bdf8; font-family: monospace;">${w}px × ${h}px</span>
          </div>
          <div style="margin-top: 4px; font-size: 9.5px; color: #94a3b8; border-top: 1px solid #334155; padding-top: 4px; line-height: 1.3;">
            Cross-origin boundaries prevent style extraction. Open DevTools to inspect inside.
          </div>
        </div>
      `;
      tooltipEl.style.left = `${e.clientX + 12}px`;
      tooltipEl.style.top  = `${e.clientY + 12}px`;
      tooltipEl.classList.remove('ss-hidden');
      return;
    }
    const cls = (typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).slice(0, 2).map(c => `.${c}`).join('') : '';
    const id = el.id ? `#${el.id}` : '';
    
    // Calculate dimensions
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    
    // Get padding and margin
    const cs = window.getComputedStyle(el);
    const pt = cs.paddingTop, pr = cs.paddingRight, pb = cs.paddingBottom, pl = cs.paddingLeft;
    const mt = cs.marginTop, mr = cs.marginRight, mb = cs.marginBottom, ml = cs.marginLeft;
    
    let pStr = '';
    if (pt === '0px' && pr === '0px' && pb === '0px' && pl === '0px') {
      pStr = 'p: 0';
    } else if (pt === pr && pr === pb && pb === pl) {
      pStr = `p: ${pt}`;
    } else {
      pStr = `p: ${pt} ${pr} ${pb} ${pl}`;
    }
    
    let mStr = '';
    if (mt === '0px' && mr === '0px' && mb === '0px' && ml === '0px') {
      mStr = 'm: 0';
    } else if (mt === mr && mr === mb && mb === ml) {
      mStr = `m: ${mt}`;
    } else {
      mStr = `m: ${mt} ${mr} ${mb} ${ml}`;
    }
    
    tooltipEl.innerHTML = `
      <div style="font-family: 'Inter', sans-serif; line-height: 1.2;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; font-weight: 700;">
          <span style="color: #f8fafc;">${tag}${id}${cls}</span>
          <span style="color: #38bdf8; font-family: monospace;">${w}px × ${h}px</span>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 4px; font-size: 9.5px; color: #94a3b8; border-top: 1px solid #334155; padding-top: 4px; white-space: nowrap;">
          <span>${pStr}</span>
          <span>${mStr}</span>
        </div>
      </div>
    `;
    
    tooltipEl.style.left = `${e.clientX + 12}px`;
    tooltipEl.style.top  = `${e.clientY + 12}px`;
    tooltipEl.classList.remove('ss-hidden');
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTIVATE / DEACTIVATE
  // ═══════════════════════════════════════════════════════════════

  function startInspecting() {
    if (inspecting) return;
    inspecting = true;
    
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseout',  onMouseOut,  { passive: true });
    document.addEventListener('click',     onClick,      true);
    window.addEventListener('scroll', updateOverlayPositions, { passive: true });
    window.addEventListener('resize', updateOverlayPositions, { passive: true });
    
    document.body.style.cursor = 'crosshair';

    if (shadowRoot) {
      const toggle = shadowRoot.getElementById('ss-inspect-toggle');
      if (toggle) toggle.checked = true;
      const banner = shadowRoot.getElementById('ss-topbar');
      if (banner) {
        banner.innerHTML = `
          <div class="ss-inspect-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            </svg>
            INSPECT MODE
          </div>
          <span class="ss-esc-hint">Press ESC to exit</span>
        `;
        banner.style.background = '';
        banner.style.color = '';
      }
    }
  }

  function stopInspecting() {
    if (!inspecting) return;
    inspecting = false;

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseout',  onMouseOut);
    document.removeEventListener('click',     onClick,   true);
    window.removeEventListener('scroll', updateOverlayPositions);
    window.removeEventListener('resize', updateOverlayPositions);

    document.body.style.cursor = '';

    if (shadowRoot) {
      const hover = shadowRoot.getElementById('ss-hover-overlay');
      if (hover) hover.classList.add('ss-hidden');
      const toggle = shadowRoot.getElementById('ss-inspect-toggle');
      if (toggle) toggle.checked = false;
      const banner = shadowRoot.getElementById('ss-topbar');
      if (banner) {
        banner.innerHTML = `
          <div class="ss-inspect-label" style="opacity: 0.6;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            INSPECT PAUSED
          </div>
          <span class="ss-esc-hint" style="opacity: 0.6;">Toggle Inspect to resume</span>
        `;
        banner.style.background = '#f1f5f9';
        banner.style.color = '#64748b';
        if (panelEl && panelEl.classList.contains('ss-dark')) {
          banner.style.background = '#1a1a1a';
          banner.style.color = '#a3a3a3';
        }
      }
    }
  }

  function activate() {
    if (active) return;
    active = true;
    createPanel();
    
    if (panelEl) {
      panelEl.style.bottom = '20px';
      panelEl.style.top = '20px';
      panelEl.style.right = '20px';
      panelEl.style.height = 'calc(100vh - 40px)';
      panelEl.style.width = activeView === 'history' ? '360px' : '400px';
    }

    document.addEventListener('keydown', onKeyDown);
    startInspecting();

    panelEl.classList.remove('ss-hidden');
    panelEl.classList.add('ss-entering');
    requestAnimationFrame(() => requestAnimationFrame(() =>
      panelEl.classList.remove('ss-entering')));
    updateSelectionUI();
  }

  function deactivate() {
    active = false;
    stopInspecting();
    document.removeEventListener('keydown', onKeyDown);
    if (hoveredEl)  { restoreEl(hoveredEl);  hoveredEl = null; }
    if (selectedEl) { restoreEl(selectedEl); selectedEl = null; }

    if (panelEl)   panelEl.classList.add('ss-hidden');
    if (tooltipEl) tooltipEl.classList.add('ss-hidden');

    if (shadowRoot) {
      const hover = shadowRoot.getElementById('ss-hover-overlay');
      const select = shadowRoot.getElementById('ss-select-overlay');
      if (hover) hover.classList.add('ss-hidden');
      if (select) select.classList.add('ss-hidden');
    }

    try { ext.runtime.sendMessage({ type: 'inspector-deactivated-by-user' }); } catch(_) {}
  }

  function onKeyDown(e) {
    const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    if (isInput) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (inspecting) {
        stopInspecting();
      } else {
        deactivate();
      }
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      if (!inspecting) {
        startInspecting();
      } else {
        stopInspecting();
      }
    }
  }

  window.addEventListener('__toggle_snoop_event__', () => {
    console.log("CONTENT SCRIPT RECEIVED __toggle_snoop_event__!");
    try {
      ext.runtime.sendMessage({ action: 'toggle-inspector' }, (response) => {
        if (ext.runtime.lastError) {
          console.error("CONTENT SCRIPT sendMessage callback lastError:", ext.runtime.lastError.message);
        } else {
          console.log("CONTENT SCRIPT sendMessage callback response:", response);
        }
      });
    } catch (e) {
      console.error("CONTENT SCRIPT sendMessage caught error:", e);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // MESSAGE LISTENER
  // ═══════════════════════════════════════════════════════════════

  try {
    ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      console.log("CONTENT SCRIPT ONMESSAGE:", msg);
      if (msg.action === 'startInspect' || msg.action === 'start-inspecting') {
        activate();
        switchView('inspector');
        sendResponse({ ok: true, active: true });
      } else if (msg.action === 'stopInspect' || msg.action === 'stop-inspecting') {
        deactivate();
        sendResponse({ ok: true, active: false });
      } else if (msg.action === 'getStatus') {
        sendResponse({ active });
      } else if (msg.action === 'ping') {
        sendResponse({ ok: true });
      } else if (msg.action === 'showHistory') {
        activate();
        switchView('history');
        sendResponse({ ok: true });
      }
      return true;
    });
  } catch(_) {}

  // ═══════════════════════════════════════════════════════════════
  // STORAGE LISTENER (Live Sync)
  // ═══════════════════════════════════════════════════════════════
  try {
    ext.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes.inspectionHistory) {
          if (typeof activeView !== 'undefined' && activeView === 'history') {
            renderHistoryList();
          }
          checkIfCurrentElementIsFavorited();
        }
        if (changes.selectedTailwindVersion) {
          selectedTailwindVersion = changes.selectedTailwindVersion.newValue;
          if (selectedEl) populate(selectedEl);
        }
        if (changes.highlightColor) {
          highlightColor = changes.highlightColor.newValue;
          updateOverlayStyles();
        }
        if (changes.highlightEnabled) {
          highlightEnabled = changes.highlightEnabled.newValue;
          updateOverlayStyles();
        }
      }
    });
  } catch (_) {}

  // ═══════════════════════════════════════════════════════════════
  // FIRST-RUN ONBOARDING TOOLTIP
  // ═══════════════════════════════════════════════════════════════
  // Shows once on first install, stored in chrome.storage.local.
  // Renders in its own Shadow DOM so it's 100% isolated from the page.

  function initOnboarding() {
    try {
      ext.storage.local.get(['onboardingShown'], (res) => {
        if (res && res.onboardingShown) return; // Already seen — do nothing

        // Mark as shown immediately so it never fires twice
        ext.storage.local.set({ onboardingShown: true });

        // ── Build isolated shadow host ───────────────────────────
        const host = document.createElement('div');
        host.id = 'ss-onboarding-host';
        host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;';
        document.documentElement.appendChild(host);

        const shadow = host.attachShadow({ mode: 'open' });

        shadow.innerHTML = `
          <style>
            :host { all: initial; }
            .ss-ob-wrap {
              position: fixed;
              top: 56px;
              right: 14px;
              pointer-events: all;
              font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
              animation: ss-ob-drop .35s cubic-bezier(.34,1.56,.64,1) both;
            }
            @keyframes ss-ob-drop {
              from { opacity:0; transform: translateY(-10px); }
              to   { opacity:1; transform: translateY(0); }
            }
            /* Arrow pointing UP toward toolbar */
            .ss-ob-arrow {
              width: 0; height: 0;
              border-left: 8px solid transparent;
              border-right: 8px solid transparent;
              border-bottom: 9px solid #1e293b;
              margin-left: auto;
              margin-right: 18px;
            }
            .ss-ob-card {
              background: #1e293b;
              color: #f1f5f9;
              border-radius: 10px;
              padding: 13px 14px 11px;
              box-shadow: 0 8px 30px rgba(0,0,0,.35);
              max-width: 220px;
              display: flex;
              flex-direction: column;
              gap: 9px;
            }
            .ss-ob-row {
              display: flex;
              align-items: flex-start;
              gap: 10px;
            }
            .ss-ob-icon {
              flex-shrink: 0;
              width: 28px; height: 28px;
              background: #6366f1;
              border-radius: 7px;
              display: flex; align-items: center; justify-content: center;
            }
            .ss-ob-icon svg { display:block; }
            .ss-ob-text {
              font-size: 12.5px;
              line-height: 1.5;
              color: #cbd5e1;
            }
            .ss-ob-text strong {
              color: #f8fafc;
              font-weight: 600;
            }
            .ss-ob-btn {
              align-self: flex-end;
              background: #6366f1;
              color: #fff;
              border: none;
              border-radius: 6px;
              padding: 5px 14px;
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
              transition: background .12s;
            }
            .ss-ob-btn:hover { background: #4f46e5; }
            .ss-ob-progress {
              height: 2px;
              background: rgba(255,255,255,.12);
              border-radius: 99px;
              overflow: hidden;
            }
            .ss-ob-progress-bar {
              height: 100%;
              background: #6366f1;
              border-radius: 99px;
              animation: ss-ob-prog 8s linear forwards;
            }
            @keyframes ss-ob-prog {
              from { width: 100%; }
              to   { width: 0%; }
            }
          </style>
          <div class="ss-ob-wrap" id="ss-ob-wrap">
            <div class="ss-ob-arrow"></div>
            <div class="ss-ob-card">
              <div class="ss-ob-row">
                <div class="ss-ob-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </div>
                <p class="ss-ob-text">
                  <strong>StyleSnoop is ready.</strong><br>
                  Click the extension icon in your toolbar to start inspecting any element.
                </p>
              </div>
              <div class="ss-ob-progress"><div class="ss-ob-progress-bar"></div></div>
              <button class="ss-ob-btn" id="ss-ob-dismiss">Got it</button>
            </div>
          </div>
        `;

        function dismiss() {
          const wrap = shadow.getElementById('ss-ob-wrap');
          if (wrap) {
            wrap.style.transition = 'opacity .25s, transform .25s';
            wrap.style.opacity = '0';
            wrap.style.transform = 'translateY(-8px)';
            setTimeout(() => { try { host.remove(); } catch(_) {} }, 280);
          }
        }

        shadow.getElementById('ss-ob-dismiss').addEventListener('click', dismiss);

        // Auto-dismiss after 8 seconds
        setTimeout(dismiss, 8000);
      });
    } catch (_) {}
  }

  // ─── HELPER FUNCTIONS FOR SOURCE EXTRACTION / COMPATIBILITY ───
  function detectLanguage(code, classNames = '') {
    const lowerClasses = classNames.toLowerCase();
    
    if (lowerClasses.includes('language-tsx') || lowerClasses.includes('lang-tsx')) return 'React TSX';
    if (lowerClasses.includes('language-jsx') || lowerClasses.includes('lang-jsx')) return 'React JSX';
    if (lowerClasses.includes('language-typescript') || lowerClasses.includes('lang-typescript') || lowerClasses.includes('language-ts') || lowerClasses.includes('lang-ts')) {
      if (code.includes('React') || code.includes('useState') || code.includes('useRef') || /<[A-Z]/.test(code)) {
        return 'React TSX';
      }
      return 'TypeScript';
    }
    if (lowerClasses.includes('language-javascript') || lowerClasses.includes('lang-javascript') || lowerClasses.includes('language-js') || lowerClasses.includes('lang-js')) {
      if (code.includes('React') || code.includes('useState') || code.includes('useRef') || /<[A-Z]/.test(code)) {
        return 'React JSX';
      }
      return 'JavaScript';
    }
    if (lowerClasses.includes('language-vue') || lowerClasses.includes('lang-vue')) return 'Vue 3';
    if (lowerClasses.includes('language-html') || lowerClasses.includes('lang-html')) return 'HTML';
    if (lowerClasses.includes('language-css') || lowerClasses.includes('lang-css')) return 'CSS';

    const trimmed = code.trim();
    if (trimmed.includes('<template>') || (trimmed.includes('<script') && trimmed.includes('setup'))) {
      return 'Vue 3';
    }
    if (trimmed.startsWith('<!DOCTYPE') || (trimmed.startsWith('<') && !/import |export |const |let |function /.test(trimmed) && /<\/?[a-z]+[ >]/.test(trimmed))) {
      return 'HTML';
    }

    const hasJSX = /<[A-Z][a-zA-Z0-9]*/.test(trimmed) || /className=/.test(trimmed) || /export default function [A-Z]/.test(trimmed) || /const [A-Z][a-zA-Z0-9]*\s*=\s*\(\)\s*=>/.test(trimmed);
    const hasTypeScript = /:\s*(string|number|boolean|any|void|React\.FC|FC)/.test(trimmed) || /interface\s+[A-Z]/.test(trimmed) || /type\s+[A-Z]/.test(trimmed) || /as\s+[A-Z]/.test(trimmed);

    if (hasJSX) {
      return hasTypeScript ? 'React TSX' : 'React JSX';
    }
    if (hasTypeScript) {
      return 'TypeScript';
    }
    if (/import\s+.*\s+from\s+['"].*['"]/.test(trimmed) || /export\s+default/.test(trimmed) || /const\s+.*\s+=\s+require\(/.test(trimmed)) {
      return 'JavaScript';
    }
    return 'HTML';
  }

  function extractSourceCode(el) {
    const startTime = performance.now();
    const isTimeout = () => (performance.now() - startTime) > 200;

    const buildData = (code, elementForLang) => {
      const cls = elementForLang ? (elementForLang.className + ' ' + (elementForLang.querySelector('code') ? elementForLang.querySelector('code').className : '')) : '';
      return {
        code: code.trim(),
        language: detectLanguage(code, cls),
        source: window.location.hostname
      };
    };

    if (!el) return null;

    if (isTimeout()) return null;
    const localMonaco = el.closest('.monaco-editor') || el.querySelector('.monaco-editor');
    if (localMonaco) {
      const lines = Array.from(localMonaco.querySelectorAll('.view-line'));
      if (lines.length > 0) return buildData(lines.map(line => line.textContent).join('\n'), localMonaco);
      const ta = localMonaco.querySelector('textarea');
      if (ta && ta.value) return buildData(ta.value, localMonaco);
    }

    if (isTimeout()) return null;
    const localCM = el.closest('.CodeMirror, .cm-editor') || el.querySelector('.CodeMirror, .cm-editor');
    if (localCM) {
      const cmContent = localCM.querySelector('.cm-content');
      if (cmContent) return buildData(cmContent.textContent || '', localCM);
      const lines = Array.from(localCM.querySelectorAll('.CodeMirror-line'));
      if (lines.length > 0) return buildData(lines.map(l => l.textContent).join('\n'), localCM);
      const ta = localCM.querySelector('textarea');
      if (ta && ta.value) return buildData(ta.value, localCM);
    }

    if (isTimeout()) return null;
    const localPrismShiki = el.closest('pre[class*="language-"], code[class*="language-"], .shiki, .prism') || 
                            el.querySelector('pre[class*="language-"], code[class*="language-"], .shiki, .prism') ||
                            (el.parentElement && el.parentElement.querySelector('pre[class*="language-"], code[class*="language-"], .shiki, .prism'));
    if (localPrismShiki) {
      const codeTag = localPrismShiki.tagName.toLowerCase() === 'pre' ? localPrismShiki.querySelector('code') : localPrismShiki;
      const code = (codeTag || localPrismShiki).innerText || (codeTag || localPrismShiki).textContent || '';
      if (code.trim()) return buildData(code, localPrismShiki);
    }

    if (isTimeout()) return null;
    const localPreCode = el.closest('pre, code') || el.querySelector('pre, code') || (el.parentElement && el.parentElement.querySelector('pre, code'));
    if (localPreCode) {
      const codeTag = localPreCode.tagName.toLowerCase() === 'pre' ? localPreCode.querySelector('code') : localPreCode;
      const code = (codeTag || localPreCode).innerText || (codeTag || localPreCode).textContent || '';
      if (code.trim()) return buildData(code, localPreCode);
    }

    if (isTimeout()) return null;
    const localTextarea = el.closest('textarea') || el.querySelector('textarea') || (el.parentElement && el.parentElement.querySelector('textarea'));
    if (localTextarea && localTextarea.value && localTextarea.value.trim()) {
      return buildData(localTextarea.value, localTextarea);
    }

    // Fallback gracefully to Portable Component
    try {
      const fallbackCode = generateComponent(el, 'React (TSX)');
      return buildData(fallbackCode, el);
    } catch (_) {}

    return null;
  }

  function computeSelectionBoundary(el) {
    return null;
  }

  function computeCopyReadiness(el) {
    return { score: 'low', bg: '#f1f5f9', text: '#475569', color: '#cbd5e1' };
  }

  window.elToJSX = elToJSX;
  window.stylesToTailwind = stylesToTailwind;
  window.extractStyles = extractStyles;
  window.generateComponent = generateComponent;

})();
