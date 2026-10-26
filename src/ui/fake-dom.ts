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

  constructor(public tag: string) {}

  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  get className(): string {
    return [...this.classes].join(' ');
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

  addEventListener(type: string, handler: Handler): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  append(...nodes: Array<FakeEl | FakeText>): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: Array<FakeEl | FakeText | string>): void {
    this.children = nodes.map((node) => (typeof node === 'string' ? new FakeText(node) : node));
  }

  set textContent(value: string) {
    this.children = value === '' ? [] : [new FakeText(value)];
  }

  get textContent(): string {
    return this.children.map((child) => (child instanceof FakeText ? child.data : child.textContent)).join('');
  }
}

export const fakeDocument = {
  createElement: (tag: string) => new FakeEl(tag),
  createTextNode: (data: string) => new FakeText(data),
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
