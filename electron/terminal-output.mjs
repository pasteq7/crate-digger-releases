// Each pipe needs its own state: terminal sequences can span data chunks.
export function terminalOutputFilter() {
  let state = "text";
  return (chunk) => {
    let output = "";
    for (const char of chunk) {
      const code = char.charCodeAt(0);
      if (char === "\x1b") {
        state = state === "string" ? "stringEscape" : "escape";
        continue;
      }
      if (state === "stringEscape") {
        state = char === "\\" ? "text" : "string";
        continue;
      }
      if (state === "string") {
        if (char === "\x07" || char === "\x9c") state = "text";
        continue;
      }
      if (state === "escape") {
        if (char === "[") state = "csi";
        else if ("]PX^_".includes(char)) state = "string";
        else if (code < 0x20 || code > 0x2f) state = "text";
        continue;
      }
      if (state === "csi") {
        if (code >= 0x40 && code <= 0x7e) state = "text";
        continue;
      }
      if (char === "\x9b") state = "csi";
      else if ("\x90\x98\x9d\x9e\x9f".includes(char)) state = "string";
      else if (
        char === "\n" ||
        char === "\r" ||
        char === "\t" ||
        (code >= 0x20 && !(code >= 0x7f && code <= 0x9f))
      )
        output += char;
    }
    return output;
  };
}
