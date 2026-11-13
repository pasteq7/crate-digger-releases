import test from "node:test";
import assert from "node:assert/strict";
import { terminalOutputFilter } from "../electron/terminal-output.mjs";

test("activity output removes terminal formatting while preserving readable text", () => {
  const input =
    "\x1b[32mBjörk — 東京\x1b[0m\r\n\t50%\x1b[2K\x1b[?25l\x1b[1A\n" +
    "\x1b]0;Window title\x07\x1b]8;;https://example.com\x1b\\Album\x1b]8;;\x1b\\\n" +
    "\x1b(B\x9b31mDone\x9b0m\x07\x00";
  const expected = "Björk — 東京\r\n\t50%\nAlbum\nDone";
  assert.equal(terminalOutputFilter()(input), expected);
  // Exercise every possible pipe boundary, including inside OSC terminators.
  for (let split = 0; split <= input.length; split++) {
    const filter = terminalOutputFilter();
    assert.equal(
      filter(input.slice(0, split)) + filter(input.slice(split)),
      expected,
    );
  }
  const filter = terminalOutputFilter();
  assert.equal([...input].map(filter).join(""), expected);
});
