// @ts-check

const ROVING_KEYS = Object.freeze(['ArrowRight', 'ArrowLeft', 'Home', 'End']);

/**
 * @param {number} index
 * @param {string} key
 * @param {number} length
 */
export function nextRovingTabIndex(index, key, length) {
  const size = Number(length || 0);
  if (!Number.isInteger(index) || index < 0 || index >= size || size <= 0) return index;
  if (key === 'ArrowRight') return (index + 1) % size;
  if (key === 'ArrowLeft') return (index - 1 + size) % size;
  if (key === 'Home') return 0;
  if (key === 'End') return size - 1;
  return index;
}

/**
 * @param {Iterable<any>} buttons
 * @param {string} dataKey
 * @param {(value:string)=>void} activate
 */
export function bindRovingTabKeyboard(buttons, dataKey, activate) {
  const tabs = Array.from(buttons || []);
  if (!tabs.length) return;
  tabs.forEach((btn, index) => btn.addEventListener('keydown', event => {
    if (!ROVING_KEYS.includes(event.key)) return;
    event.preventDefault();
    const nextIndex = nextRovingTabIndex(index, event.key, tabs.length);
    const next = tabs[nextIndex];
    const value = next?.dataset?.[dataKey];
    if (!next || !value) return;
    activate(value);
    next.focus();
  }));
}
