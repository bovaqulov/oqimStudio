#!/usr/bin/env bash
#
# Reads whatever the user is looking at, when the picture itself cannot reach
# the model. Prints the text it found on stdout.
#
#   read-screen.sh                # newest screenshot on the Desktop
#   read-screen.sh clip           # whatever is on the clipboard
#   read-screen.sh path/to/x.png  # a named file

set -uo pipefail
OUT="${TMPDIR:-/tmp}/oqim-ocr.png"

case "${1:-desktop}" in
  clip)
    osascript \
      -e "set f to (open for access POSIX file \"$OUT.raw\" with write permission)" \
      -e 'try' -e 'write (the clipboard as «class PNGf») to f' -e 'end try' \
      -e 'close access f' >/dev/null 2>&1
    SRC="$OUT.raw"
    [ -s "$SRC" ] || { echo "buferda rasm yo'q" >&2; exit 1; }
    ;;
  desktop)
    SRC=$(ls -t "$HOME/Desktop"/Screenshot*.png 2>/dev/null | head -1)
    [ -n "$SRC" ] || { echo "Desktop'da skrinshot topilmadi" >&2; exit 1; }
    echo "manba: $(basename "$SRC")" >&2
    ;;
  *)
    SRC="$1"
    [ -f "$SRC" ] || { echo "fayl yo'q: $SRC" >&2; exit 1; }
    ;;
esac

# Upscaled, not downscaled. Tesseract reads small UI type badly, and a retina
# screenshot shrunk to fit an image limit is exactly the wrong direction — this
# path never sends the picture anywhere, so size costs nothing.
sips -Z 2400 "$SRC" --out "$OUT" >/dev/null 2>&1 || { echo "sips o'qiy olmadi" >&2; exit 1; }
tesseract "$OUT" - 2>/dev/null | grep -vE '^\s*$'
