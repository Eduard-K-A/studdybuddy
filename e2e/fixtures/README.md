# e2e fixtures

**`sn2-notes.pdf`** — a hand-built single-page PDF, 1.1 KB, six lines of
Helvetica text about the SN2 mechanism. Written by hand rather than exported
from a word processor so it stays small enough to read in a diff and carries no
metadata, no fonts and no producer string.

It deliberately contains a word hyphenated across a line break
(`nucleo-` / `phile`), because rejoining those is the part of
`cleanExtractedText` most likely to regress.
