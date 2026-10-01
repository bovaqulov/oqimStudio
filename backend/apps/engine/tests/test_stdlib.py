"""The bot's standard library, run where it will actually run.

`script/stdlib.js` is the file a new bot starts with: 54 functions prepended to
every Kod block and every `{{ ifoda }}` (`script.compose`). Every assertion here
goes through `run_script`, under the same six boundaries and the same wrapper as
a customer's message would — not against a JavaScript mock, because a mock is a
second implementation of the thing under test and this repository has already
paid for one of those.

The rule the library is written to is that **nothing throws**. An expression
that raises does not fail loudly: it renders as a blank space in a message
somebody is reading, and nobody reports a blank space. So `NothingThrowsTests`
sweeps every public function against every shape of bad input at once, and each
group's tests carry an awkward argument beside the happy one — an unanswered
question, a word where a number was meant, a date that is not one.

Dates are pinned by argument rather than by the clock. `parseDateUz` takes the
day to count from precisely so that a test can say what "ertaga" means, and a
suite whose answers change at midnight is a suite that fails on somebody else's
morning.
"""

import json
from pathlib import Path
from unittest import skipUnless

from django.test import TestCase

from apps.engine.expressions import BUILTINS, PROVIDED, RESERVED, declared_functions
from apps.engine.script import check_syntax, compose, is_available, locate, run_script

#: The file itself. Read rather than imported: it is JavaScript, and the only
#: thing Python does with it is hand it to the sandbox exactly as a bot's
#: `script_library` column would.
STDLIB_PATH = Path(__file__).resolve().parents[1] / "script" / "stdlib.js"
STDLIB = STDLIB_PATH.read_text(encoding="utf-8")

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")

#: What the library promises to give an author, by group. The list is written
#: out rather than derived from the file, so that deleting a function is a
#: failing test instead of a smaller set agreeing with itself.
PUBLIC = {
    "son va pul": ["num", "money", "discount", "markup", "roundTo", "percentOf", "numberToWords"],
    "sana va vaqt": [
        "toDate", "date", "time", "dateTime", "weekday", "monthName",
        "addDays", "daysBetween", "isPast", "isWorkingHours", "nextWorkingDay",
    ],
    "matn": ["clean", "titleCase", "truncate", "slug", "lines", "mask"],
    "o'zbekiston": ["phone", "phonePretty", "isPhone", "operator"],
    "tekshirish": ["isEmpty", "isEmail", "isDate", "oneOf"],
    "ro'yxat": ["toList", "sum", "cartTotal", "groupBy", "sortBy", "bulletList", "pick", "get"],
    "telegram": ["escapeHtml", "escapeMd", "chunk", "keyboard"],
    "javobni tushunish": [
        "similarity", "closest", "yesNo", "extractPhone", "extractNumbers", "parseDateUz", "parseTimeUz",
    ],
    "yordamchi": ["randomId", "hash", "safe"],
}
EVERY_FUNCTION = [name for group in PUBLIC.values() for name in group]

#: Marks an answer that was a thrown error rather than a value. A string
#: because it has to survive the trip back as JSON beside the real answers.
THREW = "!! "


class StdlibCase(TestCase):
    """One sandbox process per test method, and the expression as the test name.

    Batched deliberately. Starting the sandbox costs a process launch and the
    library costs another ~20 ms to compile, so a call per assertion would be
    most of this file's runtime spent on the same forty kilobytes. What a batch
    must not cost is diagnosis, so every expression comes back under its own
    key and `subTest` names the one that disagreed.
    """

    def answers(self, expressions: list[str]) -> dict:
        """Each expression's value, evaluated in one run with the library above it."""
        body = ["const out = {};"]
        for source in expressions:
            key = json.dumps(source)
            body.append(
                f"try {{ const qiymat = ({source});"
                f" out[{key}] = qiymat === undefined ? {json.dumps(THREW + 'undefined')} : qiymat; }}"
                f" catch (xato) {{ out[{key}] = {json.dumps(THREW)} + String((xato && xato.message) || xato); }}"
            )
        body.append("return out;")
        result = run_script(compose(STDLIB, "\n".join(body)).source)
        self.assertTrue(result.ok, f"{result.kind}: {result.error}")
        return result.value

    def assertAnswers(self, cases: dict):
        """`{expression: expected}` — every one of them, in a single run."""
        answers = self.answers(list(cases))
        for source, expected in cases.items():
            with self.subTest(source):
                self.assertEqual(answers[source], expected)


@SCRIPTS
class LibraryContractTests(StdlibCase):
    """What the rest of the product is entitled to assume about this file."""

    def test_it_is_a_file_the_sandbox_will_store_and_run(self):
        """`check_syntax` is what both save endpoints call before writing."""
        self.assertIsNone(check_syntax(STDLIB))

    def test_it_declares_every_function_it_advertises(self):
        """A name `declared_functions` cannot see is a name the editor warns
        about on every save — it is a regex over the file's text, not a parser,
        so a declaration has to be written in one of the two shapes it reads."""
        declared = declared_functions(STDLIB)
        self.assertEqual([name for name in EVERY_FUNCTION if name not in declared], [])

    def test_there_are_fifty_four_of_them(self):
        self.assertEqual(len(EVERY_FUNCTION), 54)
        self.assertEqual(len(set(EVERY_FUNCTION)), 54, "one name declared twice")

    def test_no_name_collides_with_something_already_in_scope(self):
        """`table` and `tableText` are declared by the expression driver and the
        builtins are JavaScript's own. A library function of the same name would
        be a `const`/`function` clash — a syntax error taking every expression
        on the block down with it, not a shadowed helper."""
        self.assertEqual(sorted(declared_functions(STDLIB) & (BUILTINS | PROVIDED | RESERVED)), [])

    def test_it_leaves_room_for_the_author(self):
        """`bots/views.py::SCRIPT_LIBRARY_LIMIT`. The library is a starting
        point, so the ceiling has to hold what somebody adds to it as well."""
        self.assertLess(len(STDLIB), 40_000)

    def test_it_does_not_return(self):
        """A top-level `return` in the library ends the composed body before the
        block's own code runs, which is the one way this file can silently stop
        a bot answering. `FORBIDDEN` in the panel says so; this makes it true."""
        self.assertEqual(self.answers(["1 + 1"])["1 + 1"], 2)

    def test_a_fault_in_the_block_is_still_reported_against_the_block(self):
        """The library is 900-odd lines. `compose`/`locate` subtract them, and a
        message pointing at line 950 of a two-line block is worse than silence."""
        composed = compose(STDLIB, "const a = 1;\nthrow new Error('x');")
        result = run_script(composed.source)
        origin = locate(composed, result.line)
        self.assertEqual((origin.where, origin.line), ("block", 2))


@SCRIPTS
class NothingThrowsTests(StdlibCase):
    """The rule the whole library is written to, swept across all of it.

    An expression that raises is not a loud failure — `expressions.resolve_into`
    turns it into an empty string and the block still sends, so the customer
    reads a sentence with a hole in it and nobody is told. Every public function
    therefore has to survive an unanswered question, a word where a number was
    meant, an empty basket and no argument at all.
    """

    #: Every shape a run's context actually hands a function. `undefined` is the
    #: question nobody answered, `""` the one answered with a tapped space.
    AWKWARD = ["", "null", "undefined", "''", "'   '", "'salom'", "0", "-1", "NaN", "false", "[]", "{}"]

    def test_no_public_function_throws_on_any_of_them(self):
        calls = [
            f"{name}({argument})" for name in EVERY_FUNCTION for argument in self.AWKWARD
        ] + [
            f"{name}(null, null)" for name in EVERY_FUNCTION
        ] + [
            f"{name}('salom', 'salom')" for name in EVERY_FUNCTION
        ]
        answers = self.answers(calls)
        threw = sorted(
            f"{source} -> {value}"
            for source, value in answers.items()
            if isinstance(value, str) and value.startswith(THREW) and value != THREW + "undefined"
        )
        self.assertEqual(threw, [])

    def test_and_none_of_them_answers_undefined(self):
        """`undefined` has no JSON. A function that answers one has its value
        dropped out of the object it was in, which reads downstream as a field
        that was never written rather than as a function that went wrong."""
        answers = self.answers([f"{name}()" for name in EVERY_FUNCTION])
        self.assertEqual([source for source, value in answers.items() if value == THREW + "undefined"], [])


@SCRIPTS
class NumberAndMoneyTests(StdlibCase):
    def test_num_reads_what_a_person_typed(self):
        self.assertAnswers({
            "num(150000)": 150000,
            "num(\"12 000 so'm\")": 12000,
            "num('1,5')": 1.5,
            "num('1 200,50')": 1200.5,
            "num('1.234.567')": 1234567,
            "num('-12 000')": -12000,
            "num('salom')": 0,
            "num(null)": 0,
            "num([1, 2])": 0,
            "num(NaN)": 0,
            "num('', 5)": 5,
        })

    def test_money_is_a_number_somebody_can_read(self):
        self.assertAnswers({
            "money(150000)": "150 000 so'm",
            "money(1250000)": "1 250 000 so'm",
            "money(7, 'XTR')": "7 XTR",
            "money(150000, '')": "150 000",
            "money(-5000)": "-5 000 so'm",
            "money('salom')": "0 so'm",
            "money(null)": "0 so'm",
        })

    def test_discount_and_markup_clamp_the_percentage(self):
        self.assertAnswers({
            "discount(12000, 15)": 10200,
            "discount(12000, 500)": 0,
            "discount(12000, 'abc')": 12000,
            "discount(null, 15)": 0,
            "markup(12000, 15)": 13800,
            "markup(null, null)": 0,
        })

    def test_roundTo_takes_a_step_and_not_a_number_of_decimals(self):
        self.assertAnswers({
            "roundTo(12345, 1000)": 12000,
            "roundTo(1.2345, 0.01)": 1.23,
            "roundTo(12345)": 12345,
            "roundTo(12345, 0)": 12345,
            "roundTo('salom', 'x')": 0,
        })

    def test_percentOf_survives_a_zero_whole(self):
        self.assertAnswers({
            "percentOf(25, 200)": 12.5,
            "percentOf(1, 3)": 33.33,
            "percentOf(5, 0)": 0,
            "percentOf(null, null)": 0,
        })

    def test_numberToWords_says_ming_and_not_bir_ming(self):
        """The one piece of grammar in this file. Uzbek says «ming» for 1000 and
        «bir million» for a million, so the «bir» is dropped at exactly one
        scale — and 100 is «yuz», never «bir yuz»."""
        self.assertAnswers({
            "numberToWords(12500)": "o'n ikki ming besh yuz",
            "numberToWords(1000)": "ming",
            "numberToWords(1000000)": "bir million",
            "numberToWords(100)": "yuz",
            "numberToWords(101)": "yuz bir",
            "numberToWords(999)": "to'qqiz yuz to'qson to'qqiz",
            "numberToWords(1500000000)": "bir milliard besh yuz million",
            "numberToWords(0)": "nol",
            "numberToWords(-45)": "minus qirq besh",
            "numberToWords(1e30)": "",
        })


@SCRIPTS
class DateAndTimeTests(StdlibCase):
    def test_toDate_reads_every_way_a_date_arrives(self):
        self.assertAnswers({
            "date(toDate('2026-08-27'))": "27.08.2026",
            "date(toDate('27.08.2026'))": "27.08.2026",
            "date(toDate('27/08/26'))": "27.08.2026",
            "toDate('31.02.2026')": None,
            "toDate('salom')": None,
            "toDate(null)": None,
            "toDate([])": None,
        })

    def test_an_iso_date_is_read_as_a_local_day(self):
        """`new Date("2026-08-27")` is UTC by specification, so on a server east
        of Greenwich `getDate()` answers the 27th and west of it the 26th. The
        day an author typed must not depend on where the process is running."""
        self.assertAnswers({"date('2026-08-27')": "27.08.2026"})

    def test_a_small_number_is_not_a_timestamp(self):
        """`new Date(0)` is 1970. An unfilled numeric field would otherwise
        reach a customer as «01.01.1970» — a confidently wrong date, which is
        worse than the blank the rest of this library answers with."""
        self.assertAnswers({"date(0)": "", "date(13)": "", "monthName(0)": "", "monthName(13)": ""})

    def test_the_formatters_answer_nothing_for_a_value_that_is_nothing(self):
        self.assertAnswers({
            "date('2026-08-27')": "27.08.2026",
            "date('2026-08-27', '/')": "27/08/2026",
            "date(null)": "",
            "date('salom')": "",
            "time('2026-08-27T14:30:00')": "14:30",
            "time('2026-08-27')": "00:00",
            "time('salom')": "",
            "dateTime('2026-08-27T14:30:00')": "27.08.2026 14:30",
            "dateTime(null)": "",
        })

    def test_but_no_argument_at_all_means_now(self):
        """The distinction this group turns on: `date()` is today, `date(x)`
        where x is empty is a blank. Written with `arguments.length` because the
        two cases look identical from inside a function otherwise, and reading a
        skipped question as today's date is the silent kind of wrong."""
        self.assertAnswers({
            "date().length": 10,
            "time().length": 5,
            "weekday() !== ''": True,
            "monthName() !== ''": True,
            "addDays().length": 10,
            "nextWorkingDay().length": 10,
            "typeof isWorkingHours()": "boolean",
        })

    def test_weekday_and_monthName_are_uzbek(self):
        self.assertAnswers({
            "weekday('2026-08-27')": "payshanba",
            "weekday('salom')": "",
            "monthName(8)": "avgust",
            "monthName('2026-08-27')": "avgust",
            "monthName(null)": "",
        })

    def test_addDays_crosses_a_year_boundary(self):
        self.assertAnswers({
            "addDays('2026-08-27', 3)": "2026-08-30",
            "addDays('2026-12-31', 1)": "2027-01-01",
            "addDays('2026-08-30', -3)": "2026-08-27",
            "addDays('salom', 3)": "",
            "addDays(null, 3)": "",
        })

    def test_daysBetween_counts_days_and_not_hours(self):
        """23:00 to 01:00 is one day. Counted from midnight for that reason —
        a delivery window measured in fractions of a day is nobody's answer."""
        self.assertAnswers({
            "daysBetween('2026-08-27', '2026-09-03')": 7,
            "daysBetween('2026-09-03', '2026-08-27')": -7,
            "daysBetween('2026-08-27T23:00:00', '2026-08-28T01:00:00')": 1,
            "daysBetween('salom', '2026-09-03')": 0,
            "daysBetween(null, null)": 0,
        })

    def test_isPast_and_the_working_calendar(self):
        self.assertAnswers({
            "isPast('2020-01-01')": True,
            "isPast('2099-01-01')": False,
            "isPast('salom')": False,
            "isPast(null)": False,
            # 2026-08-31 is a Monday, 2026-08-29 a Saturday.
            "isWorkingHours('2026-08-31T10:00:00')": True,
            "isWorkingHours('2026-08-31T20:00:00')": False,
            "isWorkingHours('2026-08-29T10:00:00')": False,
            "isWorkingHours('2026-08-31T09:30:00', 10, 19)": False,
            "isWorkingHours('salom')": False,
            "nextWorkingDay('2026-08-28')": "2026-08-31",
            "nextWorkingDay('2026-08-31')": "2026-09-01",
            "nextWorkingDay('salom')": "",
        })


@SCRIPTS
class TextTests(StdlibCase):
    def test_clean_is_what_a_typed_answer_goes_through(self):
        self.assertAnswers({
            "clean('  Ali   Vali  ')": "Ali Vali",
            "clean('bir\\nikki')": "bir ikki",
            "clean('abcdef', 3)": "abc",
            "clean(123)": "123",
            "clean(null)": "",
            # An object reaching a message as «[object Object]» is the classic
            # embarrassment, and `clean` is the last stop before a message.
            "clean({})": "",
        })

    def test_titleCase_leaves_the_apostrophe_alone(self):
        self.assertAnswers({
            "titleCase('ali vali')": "Ali Vali",
            "titleCase(\"o'ktam\")": "O'ktam",
            "titleCase('ALI-VALI')": "Ali-Vali",
            "titleCase('тошкент')": "Тошкент",
            "titleCase(null)": "",
        })

    def test_truncate_cuts_between_words(self):
        self.assertAnswers({
            "truncate('bir ikki uch tort', 12)": "bir ikki…",
            "truncate('qisqa', 40)": "qisqa",
            "truncate('abcdefgh', 3)": "ab…",
            "truncate('abcdefgh', 1)": "…",
            "truncate(null, 10)": "",
            "truncate('abc', 'salom')": "abc",
        })

    def test_slug_transliterates_cyrillic(self):
        self.assertAnswers({
            "slug('Salom, Dunyo!')": "salom-dunyo",
            "slug('Тошкент shahri')": "toshkent-shahri",
            "slug(\"O'zbekiston\")": "ozbekiston",
            "slug('!!!')": "",
            "slug(null)": "",
        })

    def test_lines_and_mask(self):
        self.assertAnswers({
            "lines('a\\n\\n b ')": ["a", "b"],
            "lines(null)": [],
            "lines(12)": ["12"],
            "mask('998901234567')": "99********67",
            "mask('8600123412341234', 4, 4)": "8600********1234",
            "mask('1234', 4, 4)": "****",
            "mask(null)": "",
        })


@SCRIPTS
class UzbekistanTests(StdlibCase):
    def test_phone_normalises_however_it_was_written(self):
        self.assertAnswers({
            "phone('+998 90 123-45-67')": "998901234567",
            "phone('901234567')": "998901234567",
            "phone('0901234567')": "998901234567",
            "phone(998901234567)": "998901234567",
            "phone('123')": "",
            "phone('salom')": "",
            "phone(null)": "",
        })

    def test_phonePretty_and_isPhone_agree_with_it(self):
        self.assertAnswers({
            "phonePretty('998901234567')": "+998 90 123 45 67",
            "phonePretty('salom')": "",
            "isPhone('90 123 45 67')": True,
            "isPhone('salom')": False,
            "isPhone(null)": False,
        })

    def test_operator_is_read_off_the_code_and_admits_when_it_cannot(self):
        self.assertAnswers({
            "operator('998901234567')": "Beeline",
            "operator('998931234567')": "Ucell",
            "operator('998971234567')": "Mobiuz",
            "operator('998121234567')": "",
            "operator('salom')": "",
        })


@SCRIPTS
class ValidationTests(StdlibCase):
    def test_isEmpty_does_not_count_zero_as_nothing(self):
        """A question answered «0» has been answered. `isEmpty` is the check an
        author reaches for before «qayta so'rang», and treating a real zero as a
        missing answer is how a flow asks the same question forever."""
        self.assertAnswers({
            "isEmpty('   ')": True,
            "isEmpty([])": True,
            "isEmpty({})": True,
            "isEmpty(null)": True,
            "isEmpty(0)": False,
            "isEmpty(false)": False,
            "isEmpty('a')": False,
        })

    def test_isEmail_and_isDate(self):
        self.assertAnswers({
            "isEmail('ali@sunrise.uz')": True,
            "isEmail('ali@sunrise')": False,
            "isEmail('a b@c.uz')": False,
            "isEmail(null)": False,
            "isEmail({})": False,
            "isDate('27.08.2026')": True,
            "isDate('31.02.2026')": False,
            "isDate(null)": False,
        })

    def test_oneOf_ignores_case_and_the_apostrophe(self):
        self.assertAnswers({
            "oneOf('terapevt', ['Terapevt', 'Stomatolog'])": True,
            "oneOf(' Terapevt ', ['Terapevt'])": True,
            "oneOf('x', ['Terapevt'])": False,
            "oneOf('a', 'a,b')": True,
            "oneOf(null, null)": False,
        })


@SCRIPTS
class ListTests(StdlibCase):
    def test_toList_is_where_every_other_list_function_starts(self):
        self.assertAnswers({
            "toList('olma, anor')": ["olma", "anor"],
            "toList('bir\\nikki')": ["bir", "ikki"],
            "toList('bitta')": ["bitta"],
            "toList(['a'])": ["a"],
            "toList(5)": [5],
            "toList(null)": [],
            "toList('')": [],
        })

    def test_sum_and_cartTotal(self):
        self.assertAnswers({
            "sum([1, '2', 'uch'])": 3,
            "sum([{n: 1}, {n: 2}], 'n')": 3,
            "sum('1,2,3')": 6,
            "sum(null)": 0,
            "cartTotal([{narx: 12000, soni: 2}, {narx: 5000}])": 29000,
            "cartTotal([{price: 100, qty: 3}], 'price', 'qty')": 300,
            # A quantity of zero is a quantity, not a missing one.
            "cartTotal([{narx: 12000, soni: 0}])": 0,
            "cartTotal([null, undefined, {narx: '12 000'}])": 12000,
            "cartTotal(null)": 0,
        })

    def test_groupBy_cannot_have_its_prototype_rewritten(self):
        """The key comes from a customer's answer. On a plain object literal,
        `guruhlar["__proto__"] = []` replaces the prototype instead of adding a
        key — so the group is built on a null-prototype object."""
        self.assertAnswers({
            "groupBy([{h: 'a', n: 1}, {h: 'b'}, {h: 'a'}], 'h').a.length": 2,
            "Object.keys(groupBy([{h: '__proto__'}], 'h'))": ["__proto__"],
            "Object.keys(groupBy([1, 2, 3], (x) => x > 1))": ["false", "true"],
            "Object.keys(groupBy([1], () => { throw new Error('x'); }))": [""],
            "Object.keys(groupBy(null, 'h'))": [],
        })

    def test_sortBy_compares_numbers_as_numbers(self):
        """«10» before «9» is what string ordering gives a price list."""
        self.assertAnswers({
            "sortBy([{narx: 30}, {narx: 5}], 'narx').map((x) => x.narx)": [5, 30],
            "sortBy([{narx: 30}, {narx: 5}], 'narx', true).map((x) => x.narx)": [30, 5],
            "sortBy([{n: '10'}, {n: '9'}], 'n').map((x) => x.n)": ["9", "10"],
            "sortBy(['banan', 'olma'])": ["banan", "olma"],
            "sortBy(null, 'x')": [],
        })

    def test_bulletList_is_what_a_table_becomes_in_a_chat(self):
        self.assertAnswers({
            "bulletList(['olma', 'anor'])": "• olma\n• anor",
            "bulletList([{nom: 'Olma'}, {name: 'Anor'}])": "• Olma\n• Anor",
            "bulletList(['a'], '- ')": "- a",
            "bulletList([null, ''])": "",
            "bulletList(null)": "",
        })

    def test_pick_and_get_walk_a_path_that_may_not_exist(self):
        self.assertAnswers({
            "pick({a: 1, b: 2, c: 3}, 'a,c')": {"a": 1, "c": 3},
            "pick({a: 1}, ['a', 'zzz'])": {"a": 1},
            "pick({a: 1}, '__proto__,a')": {"a": 1},
            "pick(null, 'a')": {},
            "get({a: {b: {c: 7}}}, 'a.b.c')": 7,
            "get({a: [{b: 2}]}, 'a.0.b')": 2,
            "get({a: 1}, 'x.y.z')": "",
            "get(null, 'a', 'yoq')": "yoq",
            # Reachable through a dot and never anybody's data.
            "get({}, 'constructor')": "",
        })


@SCRIPTS
class TelegramTests(StdlibCase):
    def test_escapeHtml_covers_the_three_characters_the_repo_escapes(self):
        """`sender.PARSE_MODE` is HTML and `engine/markdown.py` escapes `&`,
        `<` and `>` on the way there. This is the same set for the half of a
        message the author did not write."""
        self.assertAnswers({
            "escapeHtml('<b>Ali</b> & Vali')": "&lt;b&gt;Ali&lt;/b&gt; &amp; Vali",
            "escapeHtml(null)": "",
            "escapeHtml(12)": "12",
        })

    def test_escapeMd_escapes_all_eighteen_and_the_backslash(self):
        """Telegram names eighteen characters that must be escaped in
        MarkdownV2, and one left unescaped is not a stray asterisk — it is
        `can't parse entities`, which refuses the whole message and leaves the
        customer with nothing. The backslash doubles first because it is the
        escape character itself, the way `sender.MARKUP_MARKERS` has it."""
        self.assertAnswers({
            "_MDV2.length": 18,
            "escapeMd('_*[]()~`>#+-=|{}.!')": "\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!",
            "escapeMd('Narx: 12.500 (chegirma!)')": "Narx: 12\\.500 \\(chegirma\\!\\)",
            # One backslash in, two out — it is the escape character itself.
            "escapeMd('a\\\\b')": "a\\\\b",
            "escapeMd(null)": "",
        })

    def test_chunk_splits_at_a_boundary_a_reader_can_see(self):
        self.assertAnswers({
            "chunk('salom')": ["salom"],
            "chunk('a'.repeat(9000)).map((s) => s.length)": [4096, 4096, 808],
            "chunk('bir\\nikki\\nuch', 8)": ["bir\nikki", "uch"],
            "chunk('abcd', 1)": ["a", "b", "c", "d"],
            "chunk(null)": [],
            "chunk('', 5)": [],
        })

    def test_keyboard_builds_rows_of_the_width_it_was_asked_for(self):
        self.assertAnswers({
            "keyboard(['Ha', \"Yo'q\"]).keyboard": [[{"text": "Ha"}, {"text": "Yo'q"}]],
            "keyboard(['a', 'b'], 1).keyboard": [[{"text": "a"}], [{"text": "b"}]],
            "keyboard([{nom: 'A'}]).keyboard": [[{"text": "A"}]],
            "keyboard(null).keyboard": [],
            "keyboard(['a']).resize_keyboard": True,
        })


@SCRIPTS
class UnderstandingTests(StdlibCase):
    def test_similarity_is_between_zero_and_one(self):
        self.assertAnswers({
            "similarity('terapefd', 'Terapevt')": 0.75,
            "similarity('Ali', 'ali')": 1,
            "similarity(\"yo'q\", 'yoq')": 1,
            "similarity('olma', 'avtomobil')": 0.11,
            "similarity(null, null)": 0,
            "similarity('', 'abc')": 0,
            # Quadratic, so a long answer is cut rather than left to run.
            "similarity('a'.repeat(5000), 'a'.repeat(5000))": 1,
        })

    def test_closest_is_what_makes_a_typo_answerable(self):
        self.assertAnswers({
            "closest('terapefd', ['Terapevt', 'Stomatolog'])": "Terapevt",
            "closest('stomatolog', ['Terapevt', 'Stomatolog'])": "Stomatolog",
            "closest('terapevt', ['Terapevt (kattalar uchun)', 'Stomatolog'])": "Terapevt (kattalar uchun)",
            "closest('olma', [{nom: 'Olma'}, {nom: 'Anor'}])": "Olma",
            # Nothing close enough is an answer of its own: the flow draws
            # «tushunmadim» rather than guessing at a customer's appointment.
            "closest('xyzxyz', ['Terapevt', 'Stomatolog'])": "",
            "closest('terapefd', ['Terapevt'], 0.9)": "",
            "closest('a', [])": "",
            "closest(null, null)": "",
        })

    def test_yesNo_has_three_answers_and_the_third_is_null(self):
        self.assertAnswers({
            "yesNo('ha, albatta')": True,
            "yesNo('mayli')": True,
            "yesNo('YES')": True,
            "yesNo('+')": True,
            "yesNo('👍')": True,
            "yesNo(\"yo'q\")": False,
            "yesNo('kerak emas')": False,
            "yesNo('-')": False,
            "yesNo('bilmadim')": None,
            "yesNo(null)": None,
            "yesNo('')": None,
        })

    def test_extractPhone_finds_a_number_inside_a_sentence(self):
        self.assertAnswers({
            "extractPhone('Raqamim +998 90 123-45-67, chaqiring')": "998901234567",
            "extractPhone('tel 901234567')": "998901234567",
            # The order number is not a phone number and is not long enough to
            # be mistaken for one.
            "extractPhone('Buyurtma 12345 raqami, tel 901234567')": "998901234567",
            "extractPhone('salom')": "",
            "extractPhone(null)": "",
        })

    def test_extractNumbers_keeps_a_grouped_thousand_together(self):
        self.assertAnswers({
            "extractNumbers(\"2 dona, 12 000 so'm\")": [2, 12000],
            "extractNumbers('1,5 kg va 2.25 l')": [1.5, 2.25],
            "extractNumbers('-5 gradus')": [-5],
            "extractNumbers('salom')": [],
            "extractNumbers(null)": [],
        })

    def test_parseDateUz_understands_however_a_customer_wrote_it(self):
        """Counted from an argument rather than from the clock, which is what
        the second parameter is for. 2026-01-01 is a Thursday."""
        base = "'2026-01-01'"
        self.assertAnswers({
            f"parseDateUz('bugun', {base})": "2026-01-01",
            f"parseDateUz('ertaga', {base})": "2026-01-02",
            f"parseDateUz('kecha', {base})": "2025-12-31",
            f"parseDateUz('indinga', {base})": "2026-01-03",
            f"parseDateUz('27 avgust', {base})": "2026-08-27",
            f"parseDateUz('avgust 27', {base})": "2026-08-27",
            f"parseDateUz('5 sentyabr', {base})": "2026-09-05",
            f"parseDateUz('05.09', {base})": "2026-09-05",
            f"parseDateUz('27.08.2026', {base})": "2026-08-27",
            f"parseDateUz('2026-12-01', {base})": "2026-12-01",
            f"parseDateUz('3 kundan keyin', {base})": "2026-01-04",
            f"parseDateUz('2 haftadan keyin', {base})": "2026-01-15",
            f"parseDateUz('salom', {base})": "",
            f"parseDateUz('31.02', {base})": "",
            f"parseDateUz(null, {base})": "",
        })

    def test_a_date_with_no_year_is_read_forward(self):
        """A bot books appointments, deliveries and queue slots — all of them in
        front of the conversation, never behind it. So «27 avgust» said in
        September is next August, not one already gone."""
        self.assertAnswers({
            "parseDateUz('27 avgust', '2026-01-01')": "2026-08-27",
            "parseDateUz('27 avgust', '2026-09-01')": "2027-08-27",
        })

    def test_a_weekday_means_the_next_one_and_shanba_is_not_dushanba(self):
        """«shanba» is the tail of five other weekday names, so the match has to
        be on the whole word: a customer writing «payshanba» must not be booked
        for Saturday."""
        base = "'2026-01-01'"
        self.assertAnswers({
            f"parseDateUz('dushanba', {base})": "2026-01-05",
            f"parseDateUz('shanba', {base})": "2026-01-03",
            f"parseDateUz('juma kuni kelaman', {base})": "2026-01-02",
            # Thursday, said on a Thursday: the one a week out.
            f"parseDateUz('payshanba', {base})": "2026-01-08",
            f"parseDateUz('keyingi dushanba', {base})": "2026-01-12",
        })

    def test_parseTimeUz_knows_that_seven_means_the_evening(self):
        self.assertAnswers({
            "parseTimeUz('15:30')": "15:30",
            "parseTimeUz('15.30')": "15:30",
            "parseTimeUz('9:00')": "09:00",
            "parseTimeUz('3 da')": "03:00",
            "parseTimeUz('ertalab 9')": "09:00",
            "parseTimeUz('kechqurun 7')": "19:00",
            "parseTimeUz('tushdan keyin 2')": "14:00",
            "parseTimeUz('salom')": "",
            "parseTimeUz('99:99')": "",
            "parseTimeUz('25')": "",
            "parseTimeUz('27.08.2026')": "",
            "parseTimeUz(null)": "",
        })


@SCRIPTS
class UtilityTests(StdlibCase):
    def test_randomId_is_readable_over_a_phone(self):
        self.assertAnswers({
            "randomId().length": 8,
            "randomId(4).length": 4,
            "randomId(999).length": 64,
            "randomId(-5).length": 1,
            "randomId('salom').length": 8,
            "/^[A-HJ-NP-Z2-9]+$/.test(randomId(64))": True,
            "randomId() !== randomId()": True,
        })

    def test_hash_answers_the_same_thing_twice(self):
        """The point of it: a customer put in half of an A/B split stays there
        on their next message, and there is nowhere to store which half."""
        self.assertAnswers({
            "hash('998901234567') === hash('998901234567')": True,
            "hash('a') !== hash('b')": True,
            "hash('a') >= 0 && hash('a') <= 4294967295": True,
            "typeof hash(null)": "number",
            "typeof hash({a: 1})": "number",
        })

    def test_safe_is_the_same_promise_for_the_authors_own_code(self):
        self.assertAnswers({
            "safe(() => 1 + 1, 0)": 2,
            "safe(() => { throw new Error('x'); }, 'zaxira')": "zaxira",
            "safe(() => null, 'z')": "z",
            "safe(5, 0)": 5,
            "safe(undefined, 'z')": "z",
        })
