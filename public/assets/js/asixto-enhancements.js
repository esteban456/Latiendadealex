(() => {
  const styleId = 'asixto-launcher-motion-style';
  const css = `
    .asx-chat {
      bottom: 18px !important;
      right: 18px !important;
    }
    /* WhatsApp a la izquierda del botón de IA, sin superponerse. */
    .wa {
      right: 178px !important;
      bottom: 18px !important;
      width: 52px !important;
      height: 52px !important;
      box-shadow: 0 10px 24px rgba(18,140,126,.28) !important;
      transition: transform .28s ease, box-shadow .28s ease !important;
    }
    .wa:hover {
      transform: translateY(-2px) scale(1.03) !important;
      box-shadow: 0 14px 28px rgba(18,140,126,.34) !important;
    }
    .asixto-launcher-enhanced {
      position: relative !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 9px !important;
      width: 148px !important;
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

    /* Ventana del chat: misma identidad visual que la tienda. */
    .asx-chat__panel {
      width: 380px !important;
      height: min(540px, calc(100vh - 130px)) !important;
      max-height: none !important;
      border: 1px solid rgba(255,255,255,.9) !important;
      border-radius: 22px !important;
      background: #fffdfb !important;
      box-shadow: 0 24px 60px rgba(65,32,18,.22), 0 4px 14px rgba(65,32,18,.10) !important;
      overflow: hidden !important;
      animation: alx-panel-in .34s cubic-bezier(.2,.7,.2,1) both !important;
    }
    .asx-chat__header {
      background: linear-gradient(120deg, #f6a623, #ed6c30 55%, #d84c68) !important;
      padding: 15px 16px !important;
      gap: 10px !important;
    }
    .asx-chat__header-l {
      flex-wrap: wrap;
      gap: 6px 8px;
    }
    .asx-chat__title {
      font-family: "Manrope", system-ui, sans-serif !important;
      font-size: 15px !important;
      font-weight: 800 !important;
      letter-spacing: .01em;
    }
    .alx-chat-badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 6px;
      border: 1px solid rgba(255,255,255,.4);
      border-radius: 6px;
      background: rgba(255,255,255,.18);
      color: #fff;
      font-family: "Manrope", system-ui, sans-serif;
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: .09em;
    }
    .alx-chat-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: rgba(255,255,255,.85);
      font-family: "Manrope", system-ui, sans-serif;
      font-size: 11px;
      font-weight: 600;
    }
    .alx-chat-status::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #c7f7d8;
      box-shadow: 0 0 0 3px rgba(199,247,216,.2);
    }
    .asx-chat__close {
      display: grid !important;
      place-items: center !important;
      width: 30px !important;
      height: 30px !important;
      border-radius: 50% !important;
      background: rgba(255,255,255,.18) !important;
      transition: background .25s ease, transform .25s ease !important;
    }
    .asx-chat__close:hover {
      background: rgba(255,255,255,.3) !important;
      transform: rotate(90deg);
    }
    .asx-chat__close svg { width: 15px; height: 15px; color: #fff; }
    .asx-chat__msgs {
      background: linear-gradient(180deg, #fff9f4, #f8f8fb 72%) !important;
      padding: 16px !important;
      gap: 10px !important;
    }
    .asx-chat__msgs::-webkit-scrollbar { width: 6px; }
    .asx-chat__msgs::-webkit-scrollbar-thumb { background: #e8d8cd; border-radius: 99px; }
    .asx-chat__msg {
      max-width: 84% !important;
      padding: 10px 13px !important;
      font-family: "Manrope", system-ui, sans-serif !important;
      font-size: 13.5px !important;
      line-height: 1.5 !important;
      box-shadow: 0 3px 10px rgba(65,32,18,.06);
    }
    .asx-chat__msg--agent {
      background: #fff !important;
      border: 1px solid #f0e8e2 !important;
      border-radius: 16px 16px 16px 5px !important;
      color: #2b211c !important;
    }
    .asx-chat__msg--visitor {
      background: linear-gradient(135deg, #f6a623, #ed6c30 60%, #d84c68) !important;
      border-radius: 16px 16px 5px 16px !important;
      color: #fff !important;
      box-shadow: 0 6px 14px rgba(237,108,48,.22) !important;
    }
    .asx-chat__msg--system {
      background: rgba(255,255,255,.82) !important;
      border-radius: 999px !important;
      color: #7a6b63 !important;
      font-size: 11.5px !important;
      padding: 6px 11px !important;
      box-shadow: none !important;
    }
    .asx-chat__typing { color: #9a8a80 !important; font-size: 11px !important; }
    .asx-chat__quick {
      padding: 0 16px 10px !important;
      gap: 7px !important;
    }
    .asx-chat__quick button {
      border: 1px solid rgba(237,108,48,.28) !important;
      border-radius: 999px !important;
      background: #fff8f3 !important;
      color: #b8541f !important;
      font-family: "Manrope", system-ui, sans-serif !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      padding: 6px 12px !important;
      transition: background .25s ease, border-color .25s ease !important;
    }
    .asx-chat__quick button:hover {
      background: #ffefe4 !important;
      border-color: rgba(237,108,48,.5) !important;
    }
    .asx-chat__form {
      padding: 12px !important;
      gap: 8px !important;
      border-top: 1px solid #f0e8e2 !important;
      background: #fffdfb !important;
    }
    .asx-chat__input {
      border: 1px solid #eadfd7 !important;
      border-radius: 14px !important;
      padding: 10px 12px !important;
      font-family: "Manrope", system-ui, sans-serif !important;
      font-size: 13px !important;
      box-shadow: inset 0 1px 2px rgba(65,32,18,.04);
      transition: border-color .25s ease, box-shadow .25s ease !important;
    }
    .asx-chat__input:focus {
      border-color: #ed6c30 !important;
      box-shadow: 0 0 0 3px rgba(237,108,48,.12) !important;
      outline: none !important;
    }
    .asx-chat__attach {
      width: 42px !important;
      height: 42px !important;
      border: 1px solid #eadfd7 !important;
      border-radius: 14px !important;
      background: #fff !important;
      color: #8a6b5a !important;
      transition: background .25s ease, border-color .25s ease !important;
    }
    .asx-chat__attach:hover { background: #fff5ed !important; border-color: #ed6c30 !important; }
    .asx-chat__send {
      display: grid !important;
      place-items: center !important;
      width: 42px !important;
      height: 42px !important;
      padding: 0 !important;
      border-radius: 14px !important;
      background: linear-gradient(135deg, #f6a623, #ed6c30 60%, #d84c68) !important;
      box-shadow: 0 6px 14px rgba(237,108,48,.26) !important;
      transition: transform .25s ease, box-shadow .25s ease !important;
    }
    .asx-chat__send:hover { transform: translateY(-1px) !important; }
    .asx-chat__send svg { width: 18px; height: 18px; color: #fff; }
    @keyframes alx-panel-in {
      from { opacity: 0; translate: 0 10px; scale: .985; }
      to { opacity: 1; translate: 0 0; scale: 1; }
    }
    @keyframes alx-ai-enter {
      from { opacity: 0; translate: 0 8px; }
      to { opacity: 1; translate: 0 0; }
    }
    @media (max-width: 520px) {
      .wa {
        right: 82px !important;
        width: 48px !important;
        height: 48px !important;
      }
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
      .asixto-launcher-enhanced,
      .asx-chat__panel { animation: none !important; }
      .asixto-launcher-enhanced,
      .alx-ai-mark svg,
      .wa,
      .asx-chat__close,
      .asx-chat__send { transition: none !important; }
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
    const doc = root.ownerDocument || document;
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

    // Detalles de la ventana del chat (badge IA, estado, iconos).
    const panel = root.querySelector?.('.asx-chat__panel');
    if (panel && !panel.dataset.alxUi) {
      panel.dataset.alxUi = '1';
      const headerLeft = panel.querySelector('.asx-chat__header-l');
      if (headerLeft && !headerLeft.querySelector('.alx-chat-badge')) {
        const badge = doc.createElement('span');
        badge.className = 'alx-chat-badge';
        badge.textContent = 'IA';
        headerLeft.appendChild(badge);
        const status = doc.createElement('span');
        status.className = 'alx-chat-status';
        status.textContent = 'En línea';
        headerLeft.appendChild(status);
      }
      const close = panel.querySelector('.asx-chat__close');
      if (close && !close.dataset.alxUi) {
        close.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        `;
        close.dataset.alxUi = '1';
      }
      const send = panel.querySelector('.asx-chat__send');
      if (send && !send.dataset.alxUi) {
        send.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12l16-8-6 16-3.2-6.4L4 12z" />
            <path d="M10.8 13.6L20 4" />
          </svg>
        `;
        send.setAttribute('aria-label', 'Enviar mensaje');
        send.dataset.alxUi = '1';
      }
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
