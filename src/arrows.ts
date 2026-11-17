// Typed arrows ("->", "=>") shown as arrow characters in card titles and link
// labels. Display only: stored text keeps what was typed, so the editor and
// agents see the ASCII form. Longer patterns come first in the regex so "<->"
// isn't read as "<" + "->". "<=" is left alone, since it usually means "less
// than or equal".
const ARROWS: Record<string, string> = {
  "<->": "↔",
  "<=>": "⇔",
  "->": "→",
  "<-": "←",
  "=>": "⇒",
};

const PATTERN = /<->|<=>|->|<-|=>/g;

export function arrows<T extends string | undefined>(text: T): T {
  return (text && text.replace(PATTERN, (a) => ARROWS[a])) as T;
}

const PLAIN: Record<string, string> = Object.fromEntries(Object.entries(ARROWS).map(([a, c]) => [c, a]));

// The typed form of text shown with arrows. Also turns arrow characters typed
// or pasted directly into their ASCII form, so stored text stays ASCII.
export function unarrows(text: string): string {
  return text.replace(/[↔⇔→←⇒]/g, (c) => PLAIN[c]);
}

// onChange for an input whose value is arrows(stored): returns the text to
// store, and shows an arrow just completed (e.g. "-" then ">") in place. The
// input is updated here, before React re-renders it with the same value, so
// the caret stays put instead of jumping to the end.
export function typedArrows(el: HTMLInputElement | HTMLTextAreaElement): string {
  const raw = unarrows(el.value);
  const shown = arrows(raw);
  if (shown !== el.value) {
    const pos = arrows(unarrows(el.value.slice(0, el.selectionStart ?? el.value.length))).length;
    el.value = shown;
    el.setSelectionRange(pos, pos);
  }
  return raw;
}
