// Минимальный DOM для тестов вида панели. Vitest здесь работает в среде node, а вид строится через h():
// настоящий DOM (jsdom, happy-dom) не подключаем. Умеет ровно то, что нужно h() и панели.

type Handler = (event: unknown) => void;

export class FakeText {
  constructor(public data: string) {}
}

export class FakeEl {
  children: Array<FakeEl | FakeText> = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Handler[]>();
  classes = new Set<string>();
  props = new Map<string, string>();
  style = {
    width: '',
    setProperty: (name: string, value: string) => void this.props.set(name, value),
  };
  classList = {
    add: (name: string) => void this.classes.add(name),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };
  hidden = false;
  disabled = false;
  value = '';
  isConnected = true;
  /** Родитель: нужен `replaceWith`. Ставят `append` и `replaceChildren`. */
  parent: FakeEl | null = null;
  /** Как у `<img>`: тест выставляет сам, если нужна «уже готовая» картинка. */
  complete = false;
  naturalWidth = 0;

  constructor(public tag: string) {}

  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  get className(): string {
    return [...this.classes].join(' ');
  }

  /** `img.src` и атрибут `src` — одно и то же. */
  get src(): string {
    return this.attrs.get('src') ?? '';
  }

  set src(value: string) {
    this.attrs.set('src', value);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === 'value') this.value = value;
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  /** Обработчики, повешенные на фазу перехвата (`capture: true`). */
  captures = new Set<Handler>();

  addEventListener(type: string, handler: Handler, options?: boolean | { capture?: boolean }): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
    if (options === true || (typeof options === 'object' && options.capture)) this.captures.add(handler);
  }

  removeEventListener(type: string, handler: Handler): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((known) => known !== handler));
    this.captures.delete(handler);
  }

  append(...nodes: Array<FakeEl | FakeText>): void {
    for (const node of nodes) if (node instanceof FakeEl) node.parent = this;
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: Array<FakeEl | FakeText | string>): void {
    this.children = nodes.map((node) => (typeof node === 'string' ? new FakeText(node) : node));
    for (const node of this.children) if (node instanceof FakeEl) node.parent = this;
  }

  /** Как в DOM: без родителя ничего не делает. */
  replaceWith(node: FakeEl): void {
    const parent = this.parent;
    if (!parent) return;
    parent.children = parent.children.map((child) => (child === this ? node : child));
    node.parent = parent;
    this.parent = null;
  }

  get firstElementChild(): FakeEl | null {
    return this.children.find((child): child is FakeEl => child instanceof FakeEl) ?? null;
  }

  contains(node: unknown): boolean {
    return findAll(this, (el) => el === node).length > 0;
  }

  /** Только селектор вида `[атрибут]`: панели этого хватает. */
  querySelector(selector: string): FakeEl | null {
    const attr = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    if (!attr) throw new Error(`fake-dom: unsupported selector ${selector}`);
    return findAll(this, (el) => el !== this && el.attrs.has(attr))[0] ?? null;
  }

  focus(): void {
    fakeDocument.activeElement = this;
  }

  set textContent(value: string) {
    this.children = value === '' ? [] : [new FakeText(value)];
  }

  get textContent(): string {
    return this.children.map((child) => (child instanceof FakeText ? child.data : child.textContent)).join('');
  }
}

/** Обработчики событий документа (`keydown`, `focusin` панели настроек). */
const documentEvents = new FakeEl('#document');

export const fakeDocument = {
  createElement: (tag: string) => new FakeEl(tag),
  createTextNode: (data: string) => new FakeText(data),
  body: new FakeEl('body'),
  /** Куда последним перевели фокус (`focus()`); тест сбрасывает сам. */
  activeElement: null as FakeEl | null,
  listeners: documentEvents.listeners,
  addEventListener: (type: string, handler: Handler) => documentEvents.addEventListener(type, handler),
  removeEventListener: (type: string, handler: Handler) => documentEvents.removeEventListener(type, handler),
};

/** Все элементы дерева (сам корень первым), подходящие под условие. */
export function findAll(root: unknown, match: (el: FakeEl) => boolean): FakeEl[] {
  const el = root as FakeEl;
  const found = match(el) ? [el] : [];
  for (const child of el.children) if (child instanceof FakeEl) found.push(...findAll(child, match));
  return found;
}

export const byClass = (root: unknown, name: string): FakeEl[] => findAll(root, (el) => el.classes.has(name));

export const byTag = (root: unknown, tag: string): FakeEl[] => findAll(root, (el) => el.tag === tag);

/** Вызывает обработчики события элемента. */
export function fire(target: unknown, type: string): void {
  for (const handler of (target as FakeEl).listeners.get(type) ?? []) handler({ type });
}
