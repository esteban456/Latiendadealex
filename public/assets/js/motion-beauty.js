(() => {
  'use strict';

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (reduce?.matches) return;

  // Parallax muy ligero de la portada + luces flotantes propias.
  const hero = document.querySelector('.hero');
  if (hero && hero.querySelector('img')) {
    if (!hero.querySelector('.alx-orb')) {
      ['one', 'two'].forEach((side) => {
        const orb = document.createElement('span');
        orb.className = `alx-orb alx-orb--${side}`;
        orb.setAttribute('aria-hidden', 'true');
        hero.appendChild(orb);
      });
    }

    let queued = false;
    const updateHero = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        const shift = Math.min(28, Math.max(0, window.scrollY) * 0.08);
        hero.style.setProperty('--hero-shift', `${shift.toFixed(1)}px`);
        queued = false;
      });
    };
    updateHero();
    window.addEventListener('scroll', updateHero, { passive: true });
    window.addEventListener('resize', updateHero, { passive: true });
  }

  // Inclinación 3D suave de las tarjetas de producto (solo ratón real).
  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  if (!fine || !fine.matches) return;

  let frame = 0;
  document.addEventListener('pointermove', (event) => {
    const card = event.target.closest?.('.card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) / rect.width - .5;
    const py = (event.clientY - rect.top) / rect.height - .5;
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      card.style.setProperty('--rx', `${(-py * 5).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${(px * 6).toFixed(2)}deg`);
    });
  }, { passive: true });

  document.addEventListener('pointerout', (event) => {
    const card = event.target.closest?.('.card');
    if (!card || card.contains(event.relatedTarget)) return;
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
})();
