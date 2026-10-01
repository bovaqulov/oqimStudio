---
name: skrinshot
description: Read the user's screen when their screenshot does not reach the model — images silently fail in long sessions, and "fix it" with an unreadable picture is otherwise a dead end. Use whenever an attached image is missing or rejected, or the user points at something visual you cannot see ("bu yerni tuzat", "fix it", "bu qism").
---

# Reading a screen you were not shown

Images stop arriving in long sessions. The failure is silent from the user's
side: they attach a screenshot, the message says `[Image: original 3584x2240…]`,
and the picture is simply not there. Resizing it does not help once a session
has accumulated enough of them — a 760px JPEG was refused in the same session
that had accepted 2000px ones an hour earlier.

Guessing at what they meant is worse than useless: two guesses at "hover
ishlamayapti" cost a round trip each and neither was the right element. Read the
screen instead.

```bash
.claude/skills/skrinshot/read-screen.sh              # newest Desktop screenshot
.claude/skills/skrinshot/read-screen.sh clip         # the clipboard
.claude/skills/skrinshot/read-screen.sh data/img.png # a file they named
```

It upscales to 2400px and runs `tesseract`. Nothing leaves the machine, so size
costs nothing — which is why it upscales rather than down: OCR reads small UI
type badly, and shrinking a retina screenshot to fit an image limit is exactly
the wrong direction.

## Finding the picture

macOS saves screenshots to `~/Desktop` by default (`defaults read
com.apple.screencapture location` says where). The script takes the newest one —
**check the filename it prints**. A stale file is the common trap: the user
pastes from the clipboard or from another app, nothing new lands on the Desktop,
and you confidently read a screenshot from an hour ago and answer the wrong
question. If the timestamp is not from the last minute or two, it is the wrong
image.

When nothing is there, ask them to save it over a fixed path — `data/image.png`
works well, and they only have to be told once. Then read that path directly.

## What you get, and what you do not

Enough to locate the problem. From one dashboard this pulled `Kanallar holati`,
`@Belting_sotu_bot` and `Muammo bor` — which was the whole question, and the
answer turned out to be that those three lines came from *two overlapping
windows* and the bot was healthy. Layout is not preserved; treat adjacency with
suspicion.

Only the `eng` traineddata is installed, so Uzbek comes through approximately:
**Oqim → "Ogim"**, **To'lovlar → "To'loviar"**, **oqim → "ogim"**. Read past it.
Do not add a language pack for this — you are locating a UI element, not
transcribing a document, and `eng` is enough for that.

Small type, low-contrast text and icon-only controls are frequently dropped
entirely. A disabled row in a segmented control read as absent, which nearly
became a bug report about a row that was on screen the whole time. **Absence in
the output is not evidence of absence on screen.**

## After reading

Say what you saw and what you are about to change, in one line, before changing
it. The reading is a reconstruction and the user is the one who can tell you it
is wrong — cheaply, before the work, rather than expensively after.

If OCR gives you nothing usable, ask for one sentence instead: *"qaysi ekranda,
qaysi element?"*. That is far cheaper than a wrong fix, and unlike the image it
always arrives.
