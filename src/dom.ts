// h() — единственный способ строить DOM. Строки становятся текстом, а не HTML:
// названия из Steam не могут вставить разметку.

type AttrValue = string | number | boolean | null | undefined | EventListener;
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === 'function') el.addEventListener(name.replace(/^on/, ''), value);
    else if (name === 'class') el.className = String(value);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/** Значок Tabler из шрифта, скрытый от экранных чтецов. */
export function icon(name: string): HTMLElement {
  return h('i', { class: `ti ti-${name}`, 'aria-hidden': 'true' });
}
