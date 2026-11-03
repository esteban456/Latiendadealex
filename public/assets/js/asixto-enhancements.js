(() => {
  const styleId = 'asixto-launcher-motion-style';
  const css = `
    .asixto-launcher-enhanced {
      position: relative !important;
      width: 64px !important;
      height: 64px !important;
      min-width: 64px !important;
      min-height: 64px !important;
      border: 2px solid rgba(255,255,255,.92) !important;
      border-radius: 50% !important;
      background: linear-gradient(145deg, #f28a42 0%, #ed6c30 56%, #d94e25 100%) !important;
      box-shadow: 0 12px 28px rgba(130,57,24,.30), 0 0 0 5px rgba(237,108,48,.11) !important;
      transform-origin: center !important;
      animation: asixto-launcher-enter .7s cubic-bezier(.2,.9,.25,1.25) both, asixto-launcher-float 4.8s ease-in-out 1s infinite !important;
      transition: transform .22s ease, box-shadow .22s ease, filter .22s ease !important;
      overflow: visible !important;
    }
    .asixto-launcher-enhanced::after {
      content: "";
      position: absolute;
      inset: -7px;
      border: 1px solid rgba(237,108,48,.32);
      border-radius: 50%;
      pointer-events: none;
      animation: asixto-launcher-ring 3.6s ease-out 1.2s infinite;
    }
    .asixto-launcher-enhanced svg {
      width: 29px !important;
      height: 29px !important;
      transition: transform .24s cubic-bezier(.2,.8,.25,1.2) !important;
    }
    .asixto-launcher-enhanced:hover,
    .asixto-launcher-enhanced:focus-visible {
      transform: translateY(-4px) scale(1.07) !important;
      filter: saturate(1.08) !important;
      box-shadow: 0 16px 32px rgba(130,57,24,.36), 0 0 0 6px rgba(237,108,48,.15) !important;
    }
    .asixto-launcher-enhanced:hover svg,
    .asixto-launcher-enhanced:focus-visible svg {
      transform: rotate(-8deg) scale(1.08) !important;
    }
    .asixto-launcher-enhanced:active {
      transform: scale(.94) !important;
    }
    @keyframes asixto-launcher-enter {
      from { opacity: 0; transform: translateY(16px) scale(.78); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes asixto-launcher-float {
      0%, 100% { translate: 0 0; }
      50% { translate: 0 -3px; }
    }
    @keyframes asixto-launcher-ring {
      0% { opacity: .45; transform: scale(.92); }
      70%, 100% { opacity: 0; transform: scale(1.22); }
    }
    @media (prefers-reduced-motion: reduce) {
      .asixto-launcher-enhanced,
      .asixto-launcher-enhanced::after { animation: none !important; }
      .asixto-launcher-enhanced,
      .asixto-launcher-enhanced svg { transition: none !important; }
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
      const view = element.ownerDocument.defaultView;
      let fixedHost = element;
      let isFixed = false;
      for (let depth = 0; fixedHost && depth < 5; depth++, fixedHost = fixedHost.parentElement) {
        if (view.getComputedStyle(fixedHost).position === 'fixed') { isFixed = true; break; }
      }
      if (!isFixed) continue;
      const rect = element.getBoundingClientRect();
      const nearBottom = view.innerHeight - rect.bottom < 150;
      const nearSide = rect.left < 140 || view.innerWidth - rect.right < 140;
      if (rect.width < 44 || rect.width > 96 || rect.height < 44 || rect.height > 96 || !nearBottom || !nearSide) continue;
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
