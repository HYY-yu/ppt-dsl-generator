export function meaningfulTextLength(text: string): { length: number; hasInvalidCharacters: boolean } {
  let length = 0;
  let seenVisible = false;
  let pendingSpace = false;
  let hasInvalidCharacters = false;
  for (const character of text) {
    if (/\p{Cf}/u.test(character)) {
      hasInvalidCharacters = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (character !== " " && character !== "\n" && character !== "\t") hasInvalidCharacters = true;
      if (seenVisible) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      length += 1;
      pendingSpace = false;
    }
    length += 1;
    seenVisible = true;
  }
  return { length, hasInvalidCharacters };
}
