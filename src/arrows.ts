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
