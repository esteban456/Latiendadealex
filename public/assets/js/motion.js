(() => {
  'use strict';
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (motionPreference?.matches || !('IntersectionObserver' in window)) return;

  const revealSelector = '.section, .promo-banner, .discovery-ribbon, .product, .catalog > aside, .catalog > main, .cart, .checkout-card, .summary-card, .card, .cat-card, .offer-main, .offer-small, .service-card, .trust-item';
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
    element.style.setProperty('--motion-delay', `${Math.min(index, 4) * 55}ms`);
    observer.observe(element);
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(revealSelector)) register(root, [...(root.parentElement?.children || [])].indexOf(root) % 5);
    root.querySelectorAll?.(revealSelector).forEach((element) => register(element, [...(element.parentElement?.children || [])].indexOf(element) % 5));
  }

  scan(document.body);
  const mutations = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(scan)));
  mutations.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => {
    document.querySelectorAll('.motion-reveal:not(.is-visible)').forEach((element) => element.classList.add('is-visible'));
  }, 2200);
})();
