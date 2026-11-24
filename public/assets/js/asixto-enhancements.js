(() => {
  const styleId = 'asixto-launcher-motion-style';
  const css = `
    .asx-chat {
      bottom: 18px !important;
      right: 18px !important;
    }
    .asixto-launcher-enhanced {
      position: relative !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 9px !important;
      width: auto !important;
      height: 48px !important;
      min-width: 0 !important;
      min-height: 48px !important;
      padding: 0 16px 0 7px !important;
      border: 1px solid rgba(255,255,255,.92) !important;
      border-radius: 999px !important;
      background: linear-gradient(135deg, rgba(255,255,255,.98), rgba(255,248,242,.96)) !important;
      color: #2b211c !important;
      font-family: "Manrope", system-ui, -apple-system, "Segoe UI", sans-serif !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      line-height: 1 !important;
      letter-spacing: .01em !important;
      box-shadow: 0 10px 26px rgba(97,48,24,.18), 0 2px 6px rgba(97,48,24,.08) !important;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      transform-origin: center !important;
      transition: transform .28s ease, box-shadow .28s ease, background .28s ease !important;
      animation: alx-ai-enter .55s cubic-bezier(.2,.7,.2,1) both !important;
      overflow: hidden !important;
    }
    .asixto-launcher-enhanced::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(120deg, rgba(237,108,48,.08), transparent 46%);
      pointer-events: none;
    }
    .alx-ai-mark {
      position: relative;
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      flex: 0 0 34px;
      border-radius: 50%;
      background: linear-gradient(145deg, #f6a623, #ed6c30 60%, #d84c68);
      box-shadow: 0 4px 10px rgba(237,108,48,.28);
    }
    .alx-ai-mark svg {
      width: 18px;
      height: 18px;
      color: #fff;
      transition: transform .3s ease !important;
    }
    .alx-ai-label { white-space: nowrap; }
    .asixto-launcher-enhanced:hover,
    .asixto-launcher-enhanced:focus-visible {
      transform: translateY(-2px) !important;
      filter: none !important;
      background: linear-gradient(135deg, #fff, #fff5ed) !important;
      box-shadow: 0 14px 30px rgba(97,48,24,.22), 0 2px 6px rgba(97,48,24,.08) !important;
    }
    .asixto-launcher-enhanced:hover .alx-ai-mark svg,
    .asixto-launcher-enhanced:focus-visible .alx-ai-mark svg {
      transform: rotate(8deg) scale(1.05);
    }
    .asixto-launcher-enhanced:active {
      transform: translateY(0) scale(.98) !important;
    }
    @keyframes alx-ai-enter {
      from { opacity: 0; translate: 0 8px; }
      to { opacity: 1; translate: 0 0; }
    }
    @media (max-width: 520px) {
      .asixto-launcher-enhanced {
        width: 52px !important;
        height: 52px !important;
        min-height: 52px !important;
        padding: 0 !important;
        justify-content: center !important;
        border-radius: 50% !important;
      }
      .alx-ai-label { display: none; }
      .alx-ai-mark {
        width: 38px;
        height: 38px;
        flex-basis: 38px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .asixto-launcher-enhanced { animation: none !important; }
      .asixto-launcher-enhanced,
      .alx-ai-mark svg { transition: none !important; }
    }
  `;
  const observedRoots = new WeakSet();
  let queued = false;

  function addStyles(root) {
    if (!root || root.querySelector?.(`#${styleId}`)) return;
    const doc = root.ownerDocument || document;
    const style = doc.createElement('style');
    style.id = styleId;
    style.textContent = css;
    (root.head || root).appendChild(style);
  }

  function labelFor(element) {
    const parts = [
      element.id,
      typeof element.className === 'string' ? element.className : '',
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.innerText,
    ];
    let parent = element.parentElement;
    for (let i = 0; parent && i < 4; i++, parent = parent.parentElement) {
      parts.push(parent.id, typeof parent.className === 'string' ? parent.className : '');
    }
    return parts.join(' ').toLowerCase();
  }

  function enhance(root) {
    addStyles(root);
    const clickables = root.querySelectorAll?.('button, a, iframe, [role="button"]') || [];
    for (const element of clickables) {
      const label = labelFor(element);
      if (!/(asixto|chat|asistente|ayuda|support)/i.test(label) || /(whatsapp|cerrar|close|enviar|send)/i.test(label)) continue;
      if (element.classList.contains('asixto-launcher-enhanced')) continue;
      const view = element.ownerDocument.defaultView;
      let fixedHost = element;
      let isFixed = false;
      for (let depth = 0; fixedHost && depth < 5; depth++, fixedHost = fixedHost.parentElement) {
        if (view.getComputedStyle(fixedHost).position === 'fixed') { isFixed = true; break; }
      }
      if (!isFixed) continue;
      const rect = element.getBoundingClientRect();
      const nearBottom = view.innerHeight - rect.bottom < 160;
      const nearSide = rect.left < 180 || view.innerWidth - rect.right < 180;
      if (rect.width < 44 || rect.width > 190 || rect.height < 44 || rect.height > 72 || !nearBottom || !nearSide) continue;

      element.setAttribute('aria-label', 'Abrir asistente IA');
      element.setAttribute('title', 'Abrir asistente IA');
      element.innerHTML = `
        <span class="alx-ai-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.55 4.45L18 9l-4.45 1.55L12 15l-1.55-4.45L6 9l4.45-1.55L12 3z" />
            <path d="M18.5 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
          </svg>
        </span>
        <span class="alx-ai-label">Asistente IA</span>
      `;
      element.classList.add('asixto-launcher-enhanced');
    }

    const all = root.querySelectorAll?.('*') || [];
    for (const element of all) {
      if (element.shadowRoot) {
        addStyles(element.shadowRoot);
        observe(element.shadowRoot);
        enhance(element.shadowRoot);
      }
    }
  }

  function observe(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-label', 'title', 'style'] });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance(document);
    });
  }

  addStyles(document);
  observe(document.documentElement);
  enhance(document);
})();
