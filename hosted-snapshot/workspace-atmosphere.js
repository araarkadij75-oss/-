/* Presentation only. No CRM data, credentials, network calls or application globals. */
(() => {
  'use strict';
  const key = 'eliteservice.workspace-atmosphere.v1';
  const themes = ['rain', 'space', 'mountains'];
  const root = document.documentElement;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) {}
  let theme = themes.includes(saved.theme) ? saved.theme : 'rain';
  let paused = saved.paused === true;
  root.dataset.atmosphere = theme;
  root.dataset.atmospherePaused = String(paused);
  function init() {
    const select = document.getElementById('workspaceAtmosphere');
    const pause = document.getElementById('rainMotionPaused');
    const stage = document.getElementById('workspaceAtmosphereStage');
    if (!select || !pause || !stage) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 36; i++) {
      const particle = document.createElement('i');
      particle.className = 'atmosphere-particle';
      particle.style.setProperty('--x', `${(i * 37.71 + 1.3) % 100}%`);
      particle.style.setProperty('--y', `${(i * 23.67 + 3) % 100}%`);
      particle.style.setProperty('--duration', `${4.5 + (i % 9) * .8}s`);
      particle.style.setProperty('--delay', `${-i * 1.73}s`);
      particle.style.setProperty('--size', `${3 + i % 5}px`);
      fragment.appendChild(particle);
    }
    stage.appendChild(fragment);
    select.value = theme;
    pause.checked = paused;
    function apply() {
      theme = themes.includes(select.value) ? select.value : 'rain';
      paused = pause.checked;
      root.dataset.atmosphere = theme;
      root.dataset.atmospherePaused = String(paused);
      try { localStorage.setItem(key, JSON.stringify({theme, paused})); } catch (_) {}
    }
    select.addEventListener('change', apply);
    pause.addEventListener('change', apply);
    document.addEventListener('visibilitychange', () => {
      root.dataset.atmosphereHidden = String(document.hidden);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
