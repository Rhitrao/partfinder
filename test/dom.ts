// A DOM small enough to read, and real enough to run the client script against.
//
// Not a browser and not trying to be: no layout, no styles, no real HTML parser. It is the
// handful of things src/vendors/script.ts actually touches - an element tree, ids, classes,
// events, and a <template> that knows how to find the shop rows in the endpoint's markup - so
// that the script can be executed rather than read. Nothing here is a test; vitest collects
// test/**/*.test.ts only.

/** Every opening tag in some markup that carries an id, with the attributes worth keeping. */
function* openingTags(
  html: string,
): Generator<{ tagName: string; id: string; className: string; attrs: string; at: number }> {
  for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s[^<>]*)?)>/g)) {
    const attrs = tag[2] ?? "";
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    if (id === undefined) continue;
    yield {
      tagName: tag[1]!,
      id,
      className: attrs.match(/\bclass="([^"]*)"/)?.[1] ?? "",
      attrs,
      at: (tag.index ?? 0) + tag[0]!.length,
    };
  }
}

/** A CSS selector, to the extent the script uses one. */
function matchesSelector(node: El, selector: string): boolean {
  if (selector.startsWith(".")) return node.classes().includes(selector.slice(1));
  if (selector === "input[name^='qty_']") {
    return node.tagName === "INPUT" && node.name.startsWith("qty_");
  }
  return node.tagName === selector.toUpperCase();
}

export class El {
  readonly tagName: string;
  readonly doc: Doc;
  className = "";
  type = "";
  href = "";
  target = "";
  rel = "";
  value = "";
  name = "";
  rows = 0;
  readOnly = false;
  hidden = false;
  disabled = false;
  open = false;
  checked = false;
  childNodes: El[] = [];
  parentNode: El | null = null;
  /** Text set directly on this node, as distinct from its children's. */
  own = "";
  private readonly attrs = new Map<string, string>();
  readonly handlers = new Map<string, ((event: unknown) => void)[]>();
  private identifier = "";
  /** Only a <template> has one: the tree its innerHTML was parsed into. */
  content: El | null = null;
  /** What was assigned to innerHTML, kept verbatim so a test can check what was inserted. */
  rawHtml = "";

  constructor(doc: Doc, tagName: string) {
    this.doc = doc;
    // Uppercase, as a browser reports it for an HTML element. The script compares against "A".
    this.tagName = tagName.toUpperCase();
  }

  get id(): string {
    return this.identifier;
  }
  set id(value: string) {
    this.identifier = value;
    this.doc.index.set(value, this);
  }

  classes(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }

  readonly classList = {
    add: (name: string) => {
      if (!this.classes().includes(name)) this.className = `${this.className} ${name}`.trim();
    },
    remove: (name: string) => {
      this.className = this.classes().filter((c) => c !== name).join(" ");
    },
    contains: (name: string) => this.classes().includes(name),
  };

  get textContent(): string {
    return this.own + this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.own = String(value);
  }

  /**
   * A <template>'s innerHTML. The only parsing is finding the elements the script addresses by
   * id - the shop rows and the filter slot - which is all it ever reaches into this markup for.
   */
  set innerHTML(html: string) {
    this.rawHtml = html;
    const content = new El(this.doc, "#fragment");
    for (const { tagName, id, className } of openingTags(html)) {
      const node = new El(this.doc, tagName);
      node.className = className;
      node.id = id;
      if (className.includes("shop")) {
        const actions = new El(this.doc, "div");
        actions.className = "actions";
        node.appendChild(actions);
      }
      content.appendChild(node);
    }
    content.own = html;
    this.content = content;
  }
  get innerHTML(): string {
    return this.rawHtml;
  }

  get firstChild(): El | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): El | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  appendChild(node: El): El {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node: El, reference: El | null): El {
    node.parentNode = this;
    const at = reference === null ? -1 : this.childNodes.indexOf(reference);
    if (at < 0) this.childNodes.push(node);
    else this.childNodes.splice(at, 0, node);
    return node;
  }
  removeChild(node: El): El {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler);
    this.handlers.set(type, existing);
  }
  /** Fires every handler for one event type, as a click or a change would. */
  fire(type: string, event: unknown = { target: this }): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  setAttribute(name: string, value: string): void {
    if (name === "id") this.id = value;
    else this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    if (name === "id") return this.identifier;
    return this.attrs.get(name) ?? null;
  }

  descendants(): El[] {
    return this.childNodes.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelectorAll(selector: string): El[] {
    return this.descendants().filter((node) => matchesSelector(node, selector));
  }
  querySelector(selector: string): El | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  // Everything below is called by the script and has nothing to assert.
  scrollIntoView(): void {}
  focus(): void {}
  select(): void {}
}

export class Doc {
  readonly index = new Map<string, El>();
  readonly body: El;
  readonly root: El;
  readonly handlers = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    this.root = new El(this, "html");
    this.body = new El(this, "body");
    this.root.appendChild(this.body);
  }

  createElement(tagName: string): El {
    return new El(this, tagName);
  }
  /**
   * Detached nodes stay findable, as they are in a browser until the last reference goes. The
   * script guards on parentNode wherever that matters, and clearRetry() is why.
   */
  getElementById(id: string): El | null {
    return this.index.get(id) ?? null;
  }
  querySelectorAll(selector: string): El[] {
    return this.root.querySelectorAll(selector);
  }
  querySelector(selector: string): El | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler);
    this.handlers.set(type, existing);
  }
  fire(type: string, event: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  /** An element with an id, already attached, the way the server-rendered page provides them. */
  add(tagName: string, id: string, parent: El = this.body): El {
    const node = this.createElement(tagName);
    node.id = id;
    parent.appendChild(node);
    return node;
  }
}

/**
 * The page the script will run against, built from the Worker's own HTML.
 *
 * Every id the response carries becomes an element here, with its tag taken from the markup, so
 * the stub cannot drift from what the server renders: drop pf-status from the page and the
 * script returns early, and the tests that call the Turnstile callback fail. The values of the
 * form fields are read out of the same HTML, because the script sends them to the endpoint.
 */
export function pageFrom(html: string): Doc {
  const doc = new Doc();
  for (const { tagName, id, className, attrs, at } of openingTags(html)) {
    if (doc.index.has(id)) continue;
    const node = doc.add(tagName, id);
    node.className = className;
    for (const attr of attrs.matchAll(/\b(data-[\w-]+|name|value|type)="([^"]*)"/g)) {
      const key = attr[1]!;
      const value = attr[2]!;
      if (key === "name") node.name = value;
      else if (key === "value") node.value = value;
      else if (key === "type") node.type = value;
      else node.setAttribute(key, value);
    }
    // Text the server put inside the element, when it is text and nothing else. The status line
    // is the one that matters: the page says "Finding suppliers…" before any script runs.
    const to = html.indexOf(`</${tagName.toLowerCase()}>`, at);
    const inner = to < 0 ? "" : html.slice(at, to);
    if (inner !== "" && !inner.includes("<")) node.own = inner;
  }
  const data = html.match(/id="pf-data"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
  const pfData = doc.getElementById("pf-data");
  if (pfData) pfData.own = data;
  // A <select> holds its value in the selected <option>, which this stub does not model.
  const country = doc.getElementById("country");
  if (country) country.value = html.match(/<option value="(\w+)" selected/)?.[1] ?? "";
  return doc;
}
