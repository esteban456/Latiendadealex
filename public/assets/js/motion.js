(() => {
  'use strict';

  // El encabezado cambia de sombra al bajar; no depende del resto de animaciones.
  const header = document.querySelector('header.header');
  if (header) {
    const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
  }

  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (motionPreference?.matches || !('IntersectionObserver' in window)) return;

  // Barra fina que muestra cuánto llevamos recorrido de la página.
  const progress = document.createElement('div');
  progress.className = 'alx-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);
  let progressQueued = false;
  const updateProgress = () => {
    if (progressQueued) return;
    progressQueued = true;
    window.requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      progress.style.transform = `scaleX(${ratio})`;
      progressQueued = false;
    });
  };
  updateProgress();
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress, { passive: true });

  // Pequeña onda al pulsar botones y controles.
  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest?.('.btn, .button, .icon-btn, .chip, .view-btn, .hamburger, .account-submit, .provider-button, .small-button, .qty button');
    if (!button || button.disabled) return;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'alx-ripple';
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    button.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  });

  const revealSelector = '.section, .promo-banner, .discovery-ribbon, .product, .catalog > aside, .catalog > main, .cart, .checkout-card, .summary-card, .card, .cat-card, .offer-main, .offer-small, .service-card, .trust-item, .admin-sidebar, .admin-page-heading, .admin-stat, .product-section, .orders-section, .toolbar, .table-card, .login-card, .login-header, .login-main, .account-aside, .account-panel';
  const observed = new WeakSet();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -36px 0px', threshold: 0.06 });

  function register(element, index = 0) {
    if (observed.has(element)) return;
    observed.add(element);
    element.classList.add('motion-reveal');
    element.style.setProperty('--motion-delay', `${Math.min(index, 7) * 70}ms`);
    observer.observe(element);
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(revealSelector)) register(root, [...(root.parentElement?.children || [])].indexOf(root) % 8);
    root.querySelectorAll?.(revealSelector).forEach((element) => register(element, [...(element.parentElement?.children || [])].indexOf(element) % 8));
  }

  scan(document.body);
  const mutations = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(scan)));
  mutations.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => {
    document.querySelectorAll('.motion-reveal:not(.is-visible)').forEach((element) => element.classList.add('is-visible'));
  }, 2200);
})();
