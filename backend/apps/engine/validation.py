"""Checking that an answer is the kind of answer that was asked for.

A question block says what it expects — a phone number, an email, a date — and
until now the runtime stored whatever arrived. "salom men raqam emasman" became
somebody's phone number, and the clinic called it.

Every check here is deliberately forgiving about *form* and strict about
*substance*: people type "+998 90 123 45 67", "998901234567" and
"90 123 45 67" for the same number, and all three are the same number. What is
returned is the normalised value, so what reaches the contact record is one
shape rather than whatever the keyboard produced.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime

#: What a question can ask for. `text` accepts anything; `contact` and
#: `location` are answered by Telegram's own share buttons.
ANSWER_TYPES = {"text", "phone", "email", "number", "date", "contact", "location"}

#: Types whose answer has a shape worth checking.
#:
#: `contact` is in here even though it is answered by tapping: Telegram leaves
#: the keyboard open, so the customer can — and does — type instead, and a
#: question that renders a "share your number" button was still storing "abc"
#: as somebody's phone number. A tapped share arrives already normalised and
#: passes the same check unchanged.
CHECKED_TYPES = {"phone", "email", "number", "date", "contact"}

#: `contact` is a phone number that happens to have a button; the rules are the
#: phone ones.
CHECK_AS = {"contact": "phone"}

PHONE_ALLOWED = re.compile(r"^[\d\s()+\-.]+$")
EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$")
NUMBER_SHAPE = re.compile(r"^-?\d+([.,]\d+)?$")

#: Uzbek numbers are nine digits after the country code. Anything shorter is a
#: typo, and anything much longer is not a phone number at all.
UZ_LOCAL_DIGITS = 9
UZ_COUNTRY_CODE = "998"

DATE_FORMATS = ("%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%y")


@dataclass
class AnswerCheck:
    ok: bool
    #: The answer as it should be stored — normalised, not as it was typed.
    value: str = ""
    #: What to say when it was not understood. Always names an example.
    message: str = ""


def normalise_phone(raw: str) -> str | None:
    """"+998 90 123 45 67", "998901234567", "90 123 45 67" -> "+998901234567"."""
    text = raw.strip()
    if not PHONE_ALLOWED.match(text):
        return None

    digits = re.sub(r"\D", "", text)
    if len(digits) == UZ_LOCAL_DIGITS:
        digits = UZ_COUNTRY_CODE + digits
    elif digits.startswith("8") and len(digits) == UZ_LOCAL_DIGITS + 1:
        # A leading 8 is how the number is dialled at home, not how it is written.
        digits = UZ_COUNTRY_CODE + digits[1:]

    # Long enough to be a real international number, short enough to be one.
    if not 10 <= len(digits) <= 15:
        return None
    return f"+{digits}"


def normalise_date(raw: str) -> str | None:
    """Any of the formats people actually type, into ISO `YYYY-MM-DD`."""
    text = raw.strip()
    for pattern in DATE_FORMATS:
        try:
            parsed = datetime.strptime(text, pattern).date()
        except ValueError:
            continue
        # A two-digit year lands this century; "25.08.26" is not 1926.
        return parsed.isoformat()
    return None


def check_pattern(checked: AnswerCheck, pattern: str) -> AnswerCheck:
    """An author's own rule, applied on top of the type's.

    On top rather than instead: the type is what normalises the value, so a
    phone number is matched against the pattern in the one shape it is stored
    in rather than in whichever shape the customer's keyboard produced.

    A pattern that does not compile is the author's typo and not the
    customer's mistake. Refusing every answer because of it would make the
    block unanswerable by anybody, so a broken pattern is ignored and the
    type's own check stands.
    """
    try:
        if re.search(pattern, checked.value):
            return checked
    except re.error:
        return checked
    return AnswerCheck(ok=False, message="Javob talab qilingan shaklga mos emas.")


def check_answer(answer_type: str, text: str, pattern: str = "") -> AnswerCheck:
    """Whether this reply answers a question of that type, and of that shape."""
    checked = _check_type(answer_type, text)
    return check_pattern(checked, pattern) if checked.ok and pattern else checked


def _check_type(answer_type: str, text: str) -> AnswerCheck:
    """Whether this reply answers a question of that type."""
    value = (text or "").strip()
    if answer_type not in CHECKED_TYPES:
        return AnswerCheck(ok=True, value=value)
    answer_type = CHECK_AS.get(answer_type, answer_type)
    if not value:
        return AnswerCheck(ok=False, message="Javob bo'sh — iltimos, yozib yuboring.")

    if answer_type == "phone":
        phone = normalise_phone(value)
        if phone is None:
            return AnswerCheck(
                ok=False,
                message="Telefon raqamini tushunmadim. Masalan: +998 90 123 45 67 — yoki pastdagi tugma bilan yuboring.",
            )
        return AnswerCheck(ok=True, value=phone)

    if answer_type == "email":
        if not EMAIL_SHAPE.match(value):
            return AnswerCheck(ok=False, message="Email manzili noto'g'ri ko'rinadi. Masalan: ism@pochta.uz")
        return AnswerCheck(ok=True, value=value.lower())

    if answer_type == "number":
        if not NUMBER_SHAPE.match(value):
            return AnswerCheck(ok=False, message="Faqat raqam kiriting. Masalan: 3")
        return AnswerCheck(ok=True, value=value.replace(",", "."))

    if answer_type == "date":
        iso = normalise_date(value)
        if iso is None:
            return AnswerCheck(ok=False, message="Sanani tushunmadim. Masalan: 25.08.2026")
        if date.fromisoformat(iso) < date.today():
            return AnswerCheck(ok=False, message="Bu sana o'tib ketgan — kelgusi sanani tanlang.")
        return AnswerCheck(ok=True, value=iso)

    return AnswerCheck(ok=True, value=value)
