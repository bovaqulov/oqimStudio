import type { DocsSection } from "./types";

/**
 * The whole `/api/v1/` reference, as one page's worth of blocks.
 *
 * ## Where the words come from
 *
 * Every status code, every error `code`, every error sentence and every field
 * name below was read off a real answer from a running server, not off a
 * design note. That is not a style preference: this product has already
 * shipped a guide that walked somebody through a screen it did not have, and a
 * reference is worse than a guide when it lies, because the reader is a
 * program and it fails at three in the morning in somebody else's deployment.
 *
 * The response bodies are the real ones, printed with the keys in reading
 * order rather than in the order the serializer happened to emit them — the
 * set of keys is exactly what came back. Ids belong to the demo workspace that
 * ships with the product.
 *
 * ## Why a function and not a `const`
 *
 * The base URL is this installation's, read from the server's own
 * configuration at render time. Frozen into a module-level constant it would
 * be whatever the first machine to import this file happened to be — and a
 * reference whose first line is the wrong host is a reference nobody gets past.
 */
export function buildApiReference(baseUrl: string): DocsSection[] {
  return [
    // -- 1 -------------------------------------------------------------------
    {
      id: "boshlash",
      title: "Boshlash",
      summary: "Kalit oling, birinchi so'rovni yuboring.",
      icon: "lightning",
      blocks: [
        {
          kind: "text",
          body:
            "Oqim Studio ochiq API'si `/api/v1/` ostida turadi va yettita endpointdan iborat — boshqasi yo'q. " +
            "Hammasi JSON qaytaradi. Bitta kalit bitta ish maydonini ko'radi: kalit qaysi ish maydonida " +
            "yaratilgan bo'lsa, o'sha va faqat o'sha.",
        },
        {
          kind: "text",
          body:
            "Kalit «Sozlamalar → API kalitlari» sahifasida yaratiladi. To'liq kalit faqat bir marta — yaratilgan " +
            "paytda — ko'rsatiladi; keyin ro'yxatda `oq_live_` va to'rtta belgi qoladi, xolos. Yo'qotgan bo'lsangiz " +
            "yangisini yarating va eskisini bekor qiling; tiklashning yo'li yo'q, chunki kalit hech qayerda " +
            "saqlanmaydi.",
        },
        { kind: "link", href: "/settings/api-keys", label: "API kalitlari", icon: "gear" },
        {
          kind: "code",
          label: "Birinchi so'rov",
          code:
            `export OQIM_API="${baseUrl}"\n` +
            `export OQIM_KEY="oq_live_..."   # kalitni shu yerga qo'ying\n` +
            `\n` +
            `curl -s "$OQIM_API/api/v1/me/" \\\n` +
            `  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "note",
          body:
            `\`${baseUrl}\` — shu o'rnatmaning backend manzili (server sozlamasidagi \`API_BASE_URL\`). ` +
            "Boshqa mashinadan chaqirayotgan bo'lsangiz, backend'ning tashqi manzilini qo'ying.",
        },
        {
          kind: "text",
          body:
            "`GET /api/v1/me/` doira talab qilmaydi, shuning uchun birinchi so'rov uchun eng to'g'risi shu: " +
            "kalit tirikmi, qaysi ish maydonida ishlaydi va qanday doiralari bor — hammasi bitta javobda. " +
            "Batafsili «Autentifikatsiya va doiralar» bo'limida.",
        },
        {
          kind: "text",
          body:
            "Ma'lumot o'qiydigan so'rovlar ro'yxat qaytaradi. Masalan oqimlar:",
        },
        {
          kind: "code",
          label: "Oqimlar ro'yxati",
          code:
            `curl -s "$OQIM_API/api/v1/flows/?limit=1" \\\n` +
            `  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "response",
          label: "200 · javob",
          code: [
            "{",
            '  "count": 4,',
            `  "next": "${baseUrl}/api/v1/flows/?limit=1&offset=1",`,
            '  "previous": null,',
            '  "results": [',
            "    {",
            '      "id": "9c6e5261c9a108e1",',
            '      "name": "Web App: kursga yozilish",',
            '      "description": "",',
            '      "workspaceId": "sunrise-agency",',
            '      "projectId": "sunrise-academy",',
            '      "botId": "sunrise-academy-bot",',
            '      "moduleKey": "dms",',
            '      "status": { "label": "Qoralama", "tone": "neutral" },',
            '      "stats": [',
            '        { "label": "Kirdi", "value": "12" },',
            '        { "label": "Bloklar", "value": "5" }',
            "      ],",
            '      "updatedAt": "2026-08-27T14:55:18.001189Z",',
            '      "enabled": true,',
            '      "runs": 12,',
            '      "origin": {},',
            '      "isMain": false,',
            '      "layoutMode": "simple"',
            "    }",
            "  ]",
            "}",
          ].join("\n"),
        },
        {
          kind: "text",
          body:
            "Ro'yxat qaytaradigan har uchala endpoint shu konvertda keladi: `count`, `next`, `previous`, `results`. " +
            "`next` va `previous` — to'liq havolalar yoki `null`. Maydon nomlari camelCase, sanalar ISO 8601 va UTC.",
        },
        {
          kind: "rows",
          title: "Sahifalash",
          rows: [
            { term: "?limit=", detail: "Nechta qator. Belgilanmasa 50; server 500 dan yuqorisini 500 ga tushiradi." },
            { term: "?offset=", detail: "Nechtasini tashlab ketish. `next` havolasi buni o'zi hisoblab beradi." },
          ],
        },
        {
          kind: "text",
          body:
            "Ro'yxatlar **aylanib chiqish uchun** tartiblangan: `next` bo'sh bo'lguncha yurish mumkin, va " +
            "tartib ustuni yurish davomida siljimaydi. Har bir ro'yxatning tartibi o'z bo'limida yozilgan. " +
            "Buni bilish kerak, chunki paneldagi tartib boshqacha va u shu maqsad uchun yaramaydi.",
        },
        {
          kind: "note",
          body:
            "Yo'l oxiridagi `/` ni yozgan ma'qul, lekin unutsangiz ham hech narsa yo'qolmaydi: `GET` uchun " +
            "server `301`, tanasi bor metodlar (`POST`, `PUT`) uchun esa `308` qaytaradi — «o'sha " +
            "metod, o'sha tana», ya'ni `curl -L`, `requests` va `fetch` so'rovni buzmasdan qayta yuboradi.",
        },
        {
          kind: "note",
          body:
            "Quyidagi misollardagi `id` lar — mahsulot bilan keladigan demo ish maydoniniki " +
            "(`sunrise-academy-bot`, `0297d621cc220a50` va shu kabilar). O'zingizning ish maydoningizda ular " +
            "yo'q, shuning uchun `404 flow_not_found` keladi: avval `GET /api/v1/flows/` va `GET /api/v1/bots/` " +
            "bilan o'z `id` laringizni oling, keyin misolga qo'ying.",
        },
      ],
    },

    // -- 2 -------------------------------------------------------------------
    {
      id: "autentifikatsiya",
      title: "Autentifikatsiya va doiralar",
      summary: "Bearer kalit, to'rtta doira, /me/ va bitta ish maydoni.",
      icon: "identification-badge",
      blocks: [
        {
          kind: "text",
          body:
            "Har bir so'rov `Authorization: Bearer <kalit>` sarlavhasi bilan boradi. Kalit `oq_live_` bilan " +
            "boshlanadi va undan keyin 32 ta harf-raqam turadi. Boshqa hech qanday autentifikatsiya usuli " +
            "qabul qilinmaydi — sessiya cookie'si ham, panel tokeni ham bu eshikni ochmaydi.",
        },
        {
          kind: "code",
          label: "Sarlavha",
          code: `curl -s "$OQIM_API/api/v1/bots/" \\\n  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "rows",
          title: "To'rtta doira — boshqasi yo'q",
          rows: [
            { term: "flows:read", detail: "`GET /flows/` va `GET /flows/<id>/`" },
            { term: "flows:write", detail: "`POST /flows/import/` va `PUT /flows/<id>/graph/`" },
            { term: "bots:read", detail: "`GET /bots/`" },
            { term: "contacts:read", detail: "`GET /contacts/`" },
            { term: "(doirasiz)", detail: "`GET /me/` — har qanday tirik kalit ochadi." },
          ],
        },
        {
          kind: "note",
          body:
            "`flows:write` `flows:read` ni o'z ichiga olmaydi va bu o'zboshimchalik emas: ikkala yozish " +
            "endpointi ham yozilgan grafni javobda to'liq qaytaradi, shuning uchun yolg'iz `flows:write` " +
            "kaliti o'zi yozganini o'qib tekshira oladi. Unga ro'yxat kerak emas — `GET /flows/` esa butun " +
            "ish maydoni nima chizganini ochadi, va bu boshqa savol.",
        },
        {
          kind: "text",
          body:
            "Doira yetmasa, javob qaysi doira kerakligini aytib beradi — mijoz to'rtta katakcha orasidan " +
            "topishga majbur emas.",
        },
        {
          kind: "response",
          label: "403 · doira yetmaydi",
          code:
            '{\n' +
            '  "error": {\n' +
            '    "code": "insufficient_scope",\n' +
            '    "message": "Bu amal uchun \'flows:write\' doirasi kerak — bu kalitda u yo\'q"\n' +
            "  }\n" +
            "}",
        },
        {
          kind: "text",
          body:
            "Ish maydonini kalit tanlaydi, so'rov emas. `X-Workspace-Id` sarlavhasini yoki `?workspaceId=` " +
            "parametrini yuborsangiz, u kalitniki bilan solishtiriladi — mos kelsa so'rov o'tadi, boshqasini " +
            "ko'rsatsa `404` keladi. `403` emas: sizning kalitingiz uchun u ish maydoni umuman mavjud emas.",
        },
        {
          kind: "response",
          label: "404 · begona ish maydoni",
          code:
            '{\n' +
            '  "error": {\n' +
            '    "code": "not_found",\n' +
            '    "message": "Ish maydoni topilmadi"\n' +
            "  }\n" +
            "}",
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/api/v1/me/",
          scope: null,
          summary: "Kalit o'zi haqida: nomi, ish maydoni, doiralari va limiti.",
        },
        {
          kind: "text",
          body:
            "Bu endpoint doira talab qilmaydi, chunki savolning o'zi shu: «menda qanday huquq bor?». Doira " +
            "yetmaganida javob beradigan endpoint kerak bo'lgan paytda javob bermasa, u bezakdan iborat " +
            "bo'lardi. Integratsiyani ishga tushirishda birinchi bo'lib shuni chaqiring: noto'g'ri kalit " +
            "ko'pincha noto'g'ri **ish maydoni** bo'lib chiqadi, va `403` buni aytmaydi — `workspaceName` " +
            "aytadi.",
        },
        {
          kind: "code",
          label: "So'rov",
          code: `curl -s "$OQIM_API/api/v1/me/" \\\n  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "response",
          label: "200 · javob",
          code: [
            "{",
            '  "id": "e2c0a4d428114202",',
            '  "name": "CRM ulanish",',
            '  "prefix": "oq_live_uxvS",',
            '  "scopes": ["flows:read", "flows:write", "bots:read", "contacts:read"],',
            '  "workspaceId": "sunrise-agency",',
            '  "workspaceName": "Sunrise Agency",',
            '  "createdAt": "2026-08-27T15:26:02.892967Z",',
            '  "lastUsedAt": "2026-08-27T15:26:12.731232Z",',
            '  "rateLimit": { "perMinute": 120, "scope": "workspace" }',
            "}",
          ].join("\n"),
        },
        {
          kind: "note",
          body:
            "Bu javobda maxfiy hech narsa yo'q va ro'yxat ataylab qisqa: kalitning o'zi ham, uning hash'i " +
            "ham, kimning yaratgani ham, ish maydonidagi **boshqa kalitlar** ham bu yerda yo'q. `prefix` — " +
            "paneldagi ro'yxatda ko'rinadigan o'sha to'rtta belgi: kalitni taqqoslashga yetadi, tiklashga " +
            "yetmaydi.",
        },
        {
          kind: "note",
          body:
            "`lastUsedAt` daqiqada bir martadan ko'p yozilmaydi, ya'ni bu so'rovlar jurnali emas — «yaqinda " +
            "ishladi» degan belgi. `rateLimit.scope` `\"workspace\"` bo'lgani esa `429` nega bu kalit bo'sh " +
            "turganida ham kelishi mumkinligini tushuntiradi.",
        },
        {
          kind: "text",
          body:
            "Har bir yo'l `OPTIONS` ga ham javob beradi — dastur urinishdan oldin so'rashi mumkin bo'lgan " +
            "yagona joy: qaysi metodlar qabul qilinadi va qaysi doira kerak.",
        },
        {
          kind: "code",
          label: "OPTIONS",
          code: `curl -s -X OPTIONS "$OQIM_API/api/v1/flows/import/" \\\n  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "response",
          label: "200 · javob",
          code:
            '{ "path": "/api/v1/flows/import/", "methods": ["OPTIONS", "POST"], "scope": "flows:write" }',
        },
        {
          kind: "note",
          body:
            "`scope` — shu yo'l uchun kerakli doira; `GET /me/` da u `null`. `OPTIONS` ham doira tekshiruvidan " +
            "o'tadi, ya'ni doirasi yetmagan kalit bu yerda ham `403` oladi — lekin o'sha `403` ning o'zi " +
            "qaysi doira kerakligini aytadi, shuning uchun javob baribir olinadi.",
        },
        {
          kind: "table",
          head: ["Nima yuborildi", "Javob"],
          rows: [
            ["Sarlavha umuman yo'q", '`401` · `api_key_required` · «Bu API uchun API kalit kerak»'],
            ["Noma'lum kalit", '`401` · `authentication_failed` · «Kalit yaroqsiz»'],
            ["Bekor qilingan kalit", '`401` · `authentication_failed` · «Kalit bekor qilingan»'],
            [
              "Panel tokeni Bearer sifatida",
              "`401` · `authentication_failed` · «Kalit 'oq_live_' bilan boshlanishi kerak»",
            ],
            [
              "Buzuq `Authorization` qatori",
              "`401` · `authentication_failed` · «Authorization sarlavhasi noto'g'ri»",
            ],
          ],
        },
        {
          kind: "note",
          body:
            "Bekor qilingan kalit «yaroqsiz» emas, «bekor qilingan» deb javob beradi. Farqi bor: birinchisi " +
            "sozlamada xato, ikkinchisi esa kimdir kalitni ataylab o'chirgani.",
        },
        {
          kind: "text",
          body:
            "Kalitning muddati yo'q — u siz bekor qilmaguningizcha ishlaydi. Bekor qilish darhol kuchga kiradi " +
            "va qaytarib bo'lmaydi.",
        },
      ],
    },

    // -- 3 -------------------------------------------------------------------
    {
      id: "oqimlar",
      title: "Oqimlar",
      summary: "O'qish, yuklash va grafni almashtirish — to'rtta endpoint.",
      icon: "flow-arrow",
      blocks: [
        {
          kind: "endpoint",
          method: "GET",
          path: "/api/v1/flows/",
          scope: "flows:read",
          summary: "Ish maydonidagi oqimlar, grafiksiz.",
        },
        {
          kind: "rows",
          title: "Filtrlar",
          rows: [
            { term: "?botId=", detail: "Faqat shu botning oqimlari." },
            { term: "?projectId=", detail: "Faqat shu loyihaning oqimlari." },
            { term: "?moduleKey=", detail: "`business`, `groups`, `channels`, `dms` yoki `webapp`." },
          ],
        },
        {
          kind: "code",
          label: "So'rov",
          code:
            `curl -s "$OQIM_API/api/v1/flows/?botId=sunrise-academy-bot&moduleKey=dms" \\\n` +
            `  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "note",
          body:
            "Ro'yxatda `nodes` va `edges` yo'q — ikki yuz oqimli ish maydoni bitta so'rovga butun kanvasini " +
            "yubormasligi uchun. Grafik bitta oqim uchun alohida so'raladi.",
        },
        {
          kind: "note",
          body:
            "Tartib — `-created_at, id`: yangi yaratilgani birinchi. Paneldagi `-updated_at` emas, chunki " +
            "muharrirdagi avtosaqlash oqimni ro'yxat boshiga ko'chiradi, siz esa o'sha paytda ro'yxatni " +
            "aylanib chiqayotgan bo'lishingiz mumkin.",
        },
        {
          kind: "note",
          body:
            "Oqim ishlayaptimi yoki yo'qmi — buni `enabled` aytadi, `status` emas. `status` shunchaki yorliq " +
            "(«Qoralama», «Faol») va `enabled` bilan mos kelmasligi mumkin: «Boshlash» bo'limidagi javobda " +
            "`enabled: true` va `status.label: \"Qoralama\"` bir vaqtda turibdi. Shartni har doim `enabled` " +
            "ustiga qo'ying.",
        },

        {
          kind: "endpoint",
          method: "GET",
          path: "/api/v1/flows/<id>/",
          scope: "flows:read",
          summary: "Bitta oqim, bloklari bilan.",
        },
        {
          kind: "code",
          label: "So'rov",
          code:
            `curl -s "$OQIM_API/api/v1/flows/0297d621cc220a50/" \\\n` +
            `  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "response",
          label: "200 · javob",
          code: [
            "{",
            '  "id": "0297d621cc220a50",',
            '  "name": "Asosiy oqim",',
            '  "description": "/start buyrug\'iga javob beradigan asosiy oqim",',
            '  "workspaceId": "sunrise-agency",',
            '  "projectId": "sunrise-academy",',
            '  "botId": "sunrise-academy-bot",',
            '  "moduleKey": "dms",',
            '  "status": { "label": "Faol", "tone": "success" },',
            '  "stats": [',
            '    { "label": "Kirdi", "value": "0" },',
            '    { "label": "Bloklar", "value": "3" }',
            "  ],",
            '  "updatedAt": "2026-08-23T06:55:19.033766Z",',
            '  "enabled": true,',
            '  "runs": 0,',
            '  "origin": { "kind": "blank", "label": "Bo\'lim bilan yaratilgan" },',
            '  "isMain": true,',
            '  "layoutMode": "simple",',
            '  "nodes": [',
            "    {",
            '      "id": "n1", "type": "start", "title": "/start",',
            '      "text": "Foydalanuvchi botni ishga tushirganda",',
            '      "channel": "tg", "scopes": ["private"], "x": 300, "y": 40',
            "    },",
            "    {",
            '      "id": "n2", "type": "message", "title": "Xush kelibsiz",',
            '      "text": "Assalomu alaykum! 👋\\nKerakli bo\'limni tanlang:",',
            '      "buttons": [',
            '        { "id": "b1", "label": "Xizmatlar", "kind": "callback" },',
            '        { "id": "b2", "label": "Narxlar", "kind": "callback" },',
            '        { "id": "b3", "label": "Operator bilan bog\'lanish", "kind": "callback" }',
            "      ],",
            '      "channel": "tg", "scopes": ["private"], "x": 300, "y": 200',
            "    }",
            "  ],",
            '  "edges": [{ "id": "e1", "from": "n1", "port": "out", "to": "n2" }]',
            "}",
          ].join("\n"),
        },
        {
          kind: "text",
          body:
            "Blokning ichidagi maydonlar blok turiga qarab o'zgaradi va o'zgarishicha qaytariladi — `type`, `id` " +
            "va bog'lanish uchun ishlatiladigan `port` nomlaridan boshqasi muharrirning o'zi tomonidan " +
            "belgilanadi. Boshqa ish maydonining oqim `id` si `404 flow_not_found` beradi, «ruxsat yo'q» emas.",
        },

        {
          kind: "endpoint",
          method: "POST",
          path: "/api/v1/flows/import/",
          scope: "flows:write",
          summary: "JSON grafdan yangi oqim yaratadi.",
        },
        {
          kind: "rows",
          title: "So'rov tanasi",
          rows: [
            { term: "projectId", detail: "Majburiy. Kalitning ish maydonidagi loyiha." },
            { term: "botId", detail: "Majburiy. Shu loyihaga tegishli bot." },
            { term: "moduleKey", detail: "Majburiy. `business` / `groups` / `channels` / `dms` / `webapp`." },
            { term: "graph", detail: "Majburiy. `{ nodes: [...], edges: [...] }` ko'rinishidagi obyekt." },
            { term: "name", detail: "Ixtiyoriy. Bo'sh qoldirilsa oqim «Yuklangan oqim» deb ataladi." },
            { term: "description", detail: "Ixtiyoriy, 280 belgigacha." },
          ],
        },
        {
          kind: "code",
          label: "So'rov",
          code:
            `curl -s -X POST "$OQIM_API/api/v1/flows/import/" \\\n` +
            `  -H "Authorization: Bearer $OQIM_KEY" \\\n` +
            `  -H "Content-Type: application/json" \\\n` +
            `  -d '{\n` +
            `    "projectId": "sunrise-academy",\n` +
            `    "botId": "sunrise-academy-bot",\n` +
            `    "moduleKey": "dms",\n` +
            `    "name": "API sinov oqimi",\n` +
            `    "description": "Hujjat uchun tekshiruv",\n` +
            `    "graph": {\n` +
            `      "nodes": [\n` +
            `        { "id": "n1", "type": "start", "title": "/start", "text": "Boshlanish", "x": 300, "y": 40 },\n` +
            `        { "id": "n2", "type": "message", "title": "Salom", "text": "Assalomu alaykum!", "x": 300, "y": 200 }\n` +
            `      ],\n` +
            `      "edges": [\n` +
            `        { "id": "e1", "from": "n1", "port": "out", "to": "n2" }\n` +
            `      ]\n` +
            `    }\n` +
            `  }'`,
        },
        {
          kind: "response",
          label: "201 · javob",
          code: [
            "{",
            '  "id": "faca9fe34b96e46d",',
            '  "name": "API sinov oqimi",',
            '  "description": "Hujjat uchun tekshiruv",',
            '  "workspaceId": "sunrise-agency",',
            '  "projectId": "sunrise-academy",',
            '  "botId": "sunrise-academy-bot",',
            '  "moduleKey": "dms",',
            '  "status": { "label": "Qoralama", "tone": "neutral" },',
            '  "stats": [',
            '    { "label": "Kirdi", "value": "0" },',
            '    { "label": "Bloklar", "value": "2" }',
            "  ],",
            '  "updatedAt": "2026-08-27T08:57:57.391626Z",',
            '  "enabled": false,',
            '  "runs": 0,',
            '  "origin": { "kind": "blank", "label": "API orqali yuklandi" },',
            '  "isMain": false,',
            '  "layoutMode": "simple",',
            '  "nodes": [',
            '    { "id": "n1", "type": "start", "title": "/start", "text": "Boshlanish", "x": 300, "y": 40 },',
            '    { "id": "n2", "type": "message", "title": "Salom", "text": "Assalomu alaykum!", "x": 300, "y": 200 }',
            "  ],",
            '  "edges": [',
            '    { "id": "e1", "from": "n1", "port": "out", "to": "n2" }',
            "  ]",
            "}",
          ].join("\n"),
        },
        {
          kind: "text",
          body:
            "Yangi oqimning `id` si javobning birinchi qatorida — grafni keyin almashtirmoqchi bo'lsangiz, " +
            "shuni saqlab qo'ying. Bloklar qanday yuborilgan bo'lsa, shundayligicha qaytariladi.",
        },
        {
          kind: "note",
          body:
            "Yuklangan oqim **o'chiq** holda tushadi (`enabled: false`) va uni shu API orqali yoqib bo'lmaydi. " +
            "Botni mijozlar oldiga qo'yish — panelda qoladigan qaror.",
        },
        {
          kind: "note",
          body:
            "Bu endpoint har doim **yangi** oqim yaratadi; tanasida oqim `id` si yo'q, shuning uchun tasodifan " +
            "birortasini bosib ketolmaydi. Almashtirish uchun `PUT /flows/<id>/graph/` bor.",
        },
        {
          kind: "text",
          body:
            "Graf avval tekshiriladi va faqat shu endpoint xatolar ro'yxatini to'liq qaytaradi: `findings` " +
            "ichida har bir xato alohida, `summary` ichida esa nima kelgani. Bunday holda hech narsa yozilmaydi.",
        },
        {
          kind: "response",
          label: "400 · yurib bo'lmaydigan graf",
          code: [
            "{",
            '  "error": {',
            '    "code": "graph_invalid",',
            '    "message": "Grafikda 2 ta xato bor — yuklab bo\'lmadi",',
            '    "field": "graph"',
            "  },",
            '  "findings": [',
            "    {",
            '      "severity": "error",',
            '      "code": "unknown_type",',
            '      "message": "«n2» (Nomalum blok) bloki noma\'lum turdagi: `kod`. Ruxsat etilganlari: start, trigger, groupjoin, groupleave, joinrequest, channelpost, message, menu, subscription, rating, followup, language, question, condition, script, delay, tag, ai, agent.ask, http, human, invoice, flowlink, end",',
            '      "nodeId": "n2"',
            "    },",
            "    {",
            '      "severity": "error",',
            '      "code": "edge_to_missing_node",',
            '      "message": "«e1» mavjud bo\'lmagan blokka ishora qilyapti: `n404`",',
            '      "edgeId": "e1"',
            "    }",
            "  ],",
            '  "summary": { "nodes": 2, "edges": 1, "types": { "start": 1, "kod": 1 } }',
            "}",
          ].join("\n"),
        },
        {
          kind: "note",
          body:
            "Birinchi `message` uzun va o'ralmagan — bloki noma'lum bo'lsa, javobning o'zi ruxsat etilgan " +
            "turlarni sanab beradi. `severity` `error` yoki `warning` bo'ladi; import faqat `error` larda " +
            "to'xtaydi, ogohlantirish yozishga xalaqit bermaydi.",
        },

        {
          kind: "endpoint",
          method: "PUT",
          path: "/api/v1/flows/<id>/graph/",
          scope: "flows:write",
          summary: "Oqimning bloklarini butunlay almashtiradi.",
        },
        {
          kind: "rows",
          title: "So'rov tanasi",
          rows: [
            { term: "nodes", detail: "Majburiy. Yangi bloklar ro'yxati — eskisi butunlay almashtiriladi." },
            { term: "edges", detail: "Majburiy. Yangi bog'lanishlar ro'yxati." },
            { term: "name", detail: "Ixtiyoriy. Yubormasangiz nom o'zgarmaydi, bo'shab qolmaydi." },
            { term: "description", detail: "Ixtiyoriy, xuddi shunday." },
          ],
        },
        {
          kind: "code",
          label: "So'rov",
          code:
            `curl -s -X PUT "$OQIM_API/api/v1/flows/faca9fe34b96e46d/graph/" \\\n` +
            `  -H "Authorization: Bearer $OQIM_KEY" \\\n` +
            `  -H "Content-Type: application/json" \\\n` +
            `  -d '{\n` +
            `    "nodes": [\n` +
            `      { "id": "n1", "type": "start", "title": "/start", "text": "Boshlanish", "x": 300, "y": 40 },\n` +
            `      { "id": "n2", "type": "message", "title": "Salom", "text": "Yangilangan matn", "x": 300, "y": 200 }\n` +
            `    ],\n` +
            `    "edges": [\n` +
            `      { "id": "e1", "from": "n1", "port": "out", "to": "n2" }\n` +
            `    ]\n` +
            `  }'`,
        },
        {
          kind: "text",
          body:
            "Javob — oqimning to'liq holati, ustiga bitta qo'shimcha maydon bilan: `triggerCount`. Bu graf " +
            "qaytadan indekslangandan keyin nechta trigger qolganini aytadi — ya'ni bot endi nechta turdagi " +
            "xabarga javob bera oladi. Noldan chiqsa, oqim saqlangan bo'lsa ham hech narsaga javob bermaydi.",
        },
        {
          kind: "response",
          label: "200 · javobning oxirgi uch qatori",
          code:
            '  "nodes": [ ... ],\n' +
            '  "edges": [ ... ],\n' +
            '  "triggerCount": 1\n' +
            "}",
        },
        {
          kind: "text",
          body:
            "Bu yerdagi graf xatosi `findings` bilan **kelmaydi** — bu ikki endpointning eng sezilarli farqi. " +
            "`PUT` bitta xabar qaytaradi: birinchi xato va u qaysi yarimda (`nodes` yoki `edges`). To'liq " +
            "ro'yxat kerak bo'lsa, grafni `POST /flows/import/` ga bering.",
        },
        {
          kind: "response",
          label: "400 · graf almashtirilmadi",
          code: [
            "{",
            '  "error": {',
            '    "code": "validation_error",',
            '    "message": "«e1» «n1» (/start) blokida yo\'q chiqishdan ketyapti: `success`. Bu blokning chiqishlari: `out`",',
            '    "field": "edges"',
            "  }",
            "}",
          ].join("\n"),
        },
        {
          kind: "note",
          body:
            "Oqim allaqachon yoqilgan bo'lsa, kelayotgan grafdagi AI bloklari tarif chegarasiga qarab " +
            "tekshiriladi va oshsa `402` keladi. AI bloklarini olib tashlaydigan so'rov hech qachon rad " +
            "etilmaydi — hisob kelayotgan graf bo'yicha yuritiladi.",
        },
        {
          kind: "text",
          body:
            "Bloklar lug'ati — turlar, chiqish nomlari va har bir turning maydonlari — bu API'da yo'q. Uni " +
            "paneldan olasiz: Bot → «Kod» bo'limidagi «Lug'atni nusxalash» tugmasi. Boshqa AI ga graf " +
            "yozdirayotgan bo'lsangiz, birinchi bo'lib shuni bering.",
        },
        { kind: "link", href: "/bots", label: "Botlar", icon: "robot" },
      ],
    },

    // -- 4 -------------------------------------------------------------------
    {
      id: "botlar",
      title: "Botlar",
      summary: "Ish maydonidagi botlar ro'yxati — tokensiz.",
      icon: "robot",
      blocks: [
        {
          kind: "endpoint",
          method: "GET",
          path: "/api/v1/bots/",
          scope: "bots:read",
          summary: "Botlar, sozlamalari va holati bilan.",
        },
        {
          kind: "rows",
          title: "Filtr",
          rows: [{ term: "?projectId=", detail: "Faqat shu loyihaning botlari." }],
        },
        {
          kind: "note",
          body: "Tartib — `handle, id`: alifbo bo'yicha, va bu tartib bot o'zgarganda ham joyida qoladi.",
        },
        {
          kind: "code",
          label: "So'rov",
          code: `curl -s "$OQIM_API/api/v1/bots/" \\\n  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "response",
          label: "200 · javob (bitta natija)",
          code: [
            "{",
            '  "count": 1,',
            '  "next": null,',
            '  "previous": null,',
            '  "results": [',
            "    {",
            '      "id": "sunrise-academy-bot",',
            '      "workspaceId": "sunrise-agency",',
            '      "projectId": "sunrise-academy",',
            '      "handle": "@sunrise_academy_bot",',
            '      "kind": "bot",',
            '      "status": { "label": "Muammo bor", "tone": "danger" },',
            '      "updatedAt": "2026-08-24T06:18:59.037859Z",',
            '      "tokenMasked": "7842119503:******oken",',
            '      "settings": {',
            '        "displayName": "",',
            '        "description": "",',
            '        "shortDescription": "",',
            '        "language": "uz",',
            '        "avatarEmoji": "🤖",',
            '        "workingHours": {',
            '          "enabled": false,',
            '          "days": [1, 2, 3, 4, 5],',
            '          "from": "09:00",',
            '          "to": "18:00",',
            '          "timezone": "Asia/Tashkent",',
            '          "awayMessage": ""',
            "        },",
            '        "languages": { "main": "uz", "enabled": ["uz", "ru"] }',
            "      },",
            '      "enabledModules": ["dms", "business", "webapp"]',
            "    }",
            "  ]",
            "}",
          ].join("\n"),
        },
        {
          kind: "rows",
          title: "Diqqat qiladigan maydonlar",
          rows: [
            { term: "kind", detail: "`bot` yoki `userbot`." },
            {
              term: "status",
              detail:
                "Ulanish holati: webhook xato bersa «Muammo bor», navbatda xabar qolsa «Xabarlar kutmoqda», " +
                "aks holda botning o'z yorlig'i.",
            },
            { term: "tokenMasked", detail: "Faqat niqoblangan ko'rinish. Haqiqiy token bu API'da umuman yo'q." },
            { term: "enabledModules", detail: "Bot qaysi bo'limlarda ishlayotgani." },
          ],
        },
        {
          kind: "note",
          body:
            "Javobda `webhookUrl` yo'q — panelning bot sahifasida bor, bu yerda yo'q. Webhook manzili botning " +
            "maxfiy tokenini ichiga oladi, va `bots:read` «qanday botlar bor» degan savolga javob berish uchun, " +
            "bundan nariga o'tmaslik uchun.",
        },
      ],
    },

    // -- 5 -------------------------------------------------------------------
    {
      id: "kontaktlar",
      title: "Kontaktlar",
      summary: "Botlarga yozgan odamlar.",
      icon: "address-book",
      blocks: [
        {
          kind: "endpoint",
          method: "GET",
          path: "/api/v1/contacts/",
          scope: "contacts:read",
          summary: "Ish maydonidagi kontaktlar.",
        },
        {
          kind: "rows",
          title: "Filtrlar",
          rows: [
            { term: "?botId=", detail: "Faqat shu bot bilan yozishganlar." },
            { term: "?projectId=", detail: "Faqat shu loyihaning botlari bilan yozishganlar." },
          ],
        },
        {
          kind: "text",
          body:
            "Tartib — `-first_seen_at, id`: eng oxirgi kelgan odam birinchi. Bu ro'yxat aynan aylanib " +
            "chiqiladigan ro'yxat — CRM sinxronizatsiyasi `?limit=`/`?offset=` bilan oxirigacha yuradi — " +
            "shuning uchun tartib ustuni qimirlamaydigani muhim. Paneldagi `-last_seen_at` bu ish uchun " +
            "yaramaydi: u har bir kelgan xabarda qayta yoziladi, ya'ni siz ikkinchi sahifani so'rayotgan " +
            "paytda kimdir botga yozsa, o'sha odam ro'yxat boshiga ko'chib, chegaradagi kontakt sizga **ikki " +
            "marta yoki umuman kelmasdi** — va hech kim buni sezmasdi.",
        },
        {
          kind: "note",
          body:
            "Bu yurishni tranzaksiyaga aylantirmaydi: yurish davomida **yangi** kontakt qo'shilsa, " +
            "offsetlar baribir siljiydi. Lekin qo'shilish tartibi bo'yicha bu siljish faqat bir qatorni " +
            "**takrorlashi** mumkin — yozuvni `id` bo'yicha upsert qilsangiz, u ham yo'qoladi.",
        },
        {
          kind: "code",
          label: "So'rov",
          code:
            `curl -s "$OQIM_API/api/v1/contacts/?botId=sunrise-academy-bot&limit=1" \\\n` +
            `  -H "Authorization: Bearer $OQIM_KEY"`,
        },
        {
          kind: "response",
          label: "200 · javob (bitta natija)",
          code: [
            "{",
            '  "count": 5,',
            `  "next": "${baseUrl}/api/v1/contacts/?botId=sunrise-academy-bot&limit=1&offset=1",`,
            '  "previous": null,',
            '  "results": [',
            "    {",
            '      "id": "c37084b1a66c522d",',
            '      "botId": "sunrise-academy-bot",',
            '      "telegramUserId": 991234567,',
            '      "chatId": 991234567,',
            '      "displayName": "Dilnoza",',
            '      "firstName": "Dilnoza",',
            '      "lastName": "",',
            '      "username": "dilnoza_test",',
            '      "phone": "",',
            '      "source": "direct",',
            '      "variables": {},',
            '      "tags": [],',
            '      "isBlocked": false,',
            '      "sourceFlowName": "Web App: kursga yozilish",',
            '      "sourceFlowId": "9c6e5261c9a108e1",',
            '      "firstSeenAt": "2026-08-27T06:10:53.959659Z",',
            '      "lastSeenAt": "2026-08-27T06:10:54.297099Z",',
            '      "language": "uz",',
            '      "languageCode": ""',
            "    }",
            "  ]",
            "}",
          ].join("\n"),
        },
        {
          kind: "rows",
          title: "Diqqat qiladigan maydonlar",
          rows: [
            { term: "tags", detail: "Teg **nomlari** ro'yxati, oddiy satrlar sifatida." },
            { term: "variables", detail: "Oqimlar shu odam uchun saqlagan o'zgaruvchilar; bo'sh bo'lsa `{}`." },
            {
              term: "sourceFlowName / sourceFlowId",
              detail: "Bu odamga birinchi bo'lib qaysi oqim yetib borgani. Hech qaysisi bo'lmasa `null`.",
            },
            {
              term: "language / languageCode",
              detail:
                "Birinchisi — bot shu odam bilan qaysi tilda gaplashishi; ikkinchisi — Telegramning o'zi " +
                "bergan `language_code`, tegishmagan holida (`\"ru-RU\"`, `\"en\"` yoki bo'sh satr).",
            },
            {
              term: "phone",
              detail:
                "Faqat odam raqamini o'zi ulashgan bo'lsa to'ladi — oqimdagi «Telefon raqamni yuborish» " +
                "tugmasi orqali. Aks holda bo'sh satr.",
            },
          ],
        },
        {
          kind: "note",
          body:
            "Kontaktni bu API orqali yaratib, o'zgartirib yoki o'chirib bo'lmaydi — `contacts:read` faqat " +
            "o'qiydi, boshqa usul `405` beradi.",
        },
      ],
    },

    // -- 6 -------------------------------------------------------------------
    {
      id: "xatolar",
      title: "Xatolar va limitlar",
      summary: "Bitta xato konverti, kodlar jadvali va daqiqalik chegara.",
      icon: "warning",
      blocks: [
        {
          kind: "text",
          body:
            "Har qanday xato bitta konvertda keladi. `code` — mijoz shart qo'yadigan barqaror satr; `message` " +
            "— o'qish uchun; `field` esa faqat xato aniq bir maydonga tegishli bo'lganda qo'shiladi.",
        },
        {
          kind: "response",
          label: "Xato konverti",
          code:
            "{\n" +
            '  "error": {\n' +
            '    "code": "validation_error",\n' +
            '    "message": "Ushbu maydon to\'ldirilishi shart.",\n' +
            '    "field": "projectId"\n' +
            "  }\n" +
            "}",
        },
        {
          kind: "table",
          head: ["Holat", "code", "Qachon"],
          rows: [
            ["400", "validation_error", "So'rov tanasi noto'g'ri. `field` qaysi maydon ekanini aytadi."],
            ["400", "graph_invalid", "Faqat `POST /flows/import/`. Yoniga `findings` va `summary` qo'shiladi."],
            ["401", "api_key_required", "`Authorization` sarlavhasi yo'q, yoki kalitdan boshqa narsa yuborilgan."],
            ["401", "authentication_failed", "Kalit yaroqsiz, bekor qilingan yoki `oq_live_` bilan boshlanmaydi."],
            ["402", "plan_limit", "Tarif bu amalni qoplamaydi. Hech narsa yozilmaydi."],
            ["403", "insufficient_scope", "Kalitda kerakli doira yo'q. Xabar qaysi doira kerakligini aytadi."],
            ["403", "not_authenticated", "Kalit panelning ichki `/api/…` endpointiga ishlatilgan."],
            ["404", "not_found", "Begona ish maydoni; yoki import'da bot/loyiha topilmadi."],
            ["404", "flow_not_found", "Bu ish maydonida bunday `id` li oqim yo'q."],
            ["404", "unknown_endpoint", "Bunday yo'l yo'q — xabar metod va yo'lni qaytarib aytadi."],
            ["405", "method_not_allowed", "Endpoint bu usulni qabul qilmaydi."],
            ["413", "payload_too_large", "So'rov tanasi ruxsat etilgan hajmdan oshdi; xabar chegarani baytda aytadi."],
            ["415", "unsupported_media_type", "`Content-Type` JSON emas."],
            ["429", "rate_limited", "Ish maydoni daqiqalik chegaradan oshdi."],
            ["500", "server_error", "Serverda kutilmagan xato — konvert baribir JSON bo'lib qoladi."],
          ],
        },
        {
          kind: "note",
          body:
            "Xato matnlari o'zbekcha — `405` va `403` niki ham. Bitta istisno bor va u ataylab: `400 " +
            "parse_error` xabari ichida JSON tahlilchisining o'z inglizcha diagnostikasi turadi " +
            "(«JSON parse error - Expecting value: line 1 column 15 (char 14)»), chunki qatorni va ustunni " +
            "aytadigan o'sha satrning o'zi — buzuq tanani topishning yagona yo'li.",
        },
        {
          kind: "text",
          body:
            "**Mavjud bo'lmagan yo'l ham shu konvertda keladi.** `/api/` ostidagi hech qanday javob HTML " +
            "bo'lmaydi, shuning uchun mijoz `<h1>Not Found` ni JSON deb o'qib «Unexpected token '<'» bilan " +
            "yiqilmaydi.",
        },
        {
          kind: "response",
          label: "404 · noma'lum yo'l",
          code:
            "{\n" +
            '  "error": {\n' +
            '    "code": "unknown_endpoint",\n' +
            '    "message": "Bunday endpoint yo\'q: GET /api/v1/messages/"\n' +
            "  }\n" +
            "}",
        },
        {
          kind: "note",
          body:
            "Bu javob mavjud yo'llar ro'yxatini **bermaydi**, va bu ataylab: marshrutlanmagan yo'lda hech " +
            "qanday view yo'q, ya'ni hech kim kalitni tekshirmagan. Ro'yxat bu yerda manzilni noto'g'ri " +
            "yozgan har kimga berilgan xarita bo'lardi. Endpointlar shu sahifada — panelga kirgan odam " +
            "uchun.",
        },
        {
          kind: "text",
          body:
            "Limit — daqiqasiga **120 ta so'rov**, va u **ish maydoniga** tegishli, kalitga emas. Ikkinchi kalit " +
            "yaratish chegarani ko'tarmaydi: bir ish maydonidagi barcha kalitlar bitta hamyondan sarflaydi. " +
            "O'qish va yozish ham shu bitta hisobda.",
        },
        {
          kind: "response",
          label: "429 · javob",
          code:
            "Retry-After: 12\n" +
            "\n" +
            "{\n" +
            '  "error": {\n' +
            '    "code": "rate_limited",\n' +
            '    "message": "So\'rovlar chegarasidan oshib ketdingiz — 12 soniyadan keyin qayta urinib ko\'ring"\n' +
            "  }\n" +
            "}",
        },
        {
          kind: "note",
          body:
            "`Retry-After` sarlavhasi necha soniya kutish kerakligini aytadi — qayta urinishni shunga qarab " +
            "qo'ying. Bu chegaraning narxi bor va u ochiq aytilgan: bitta shovqinli integratsiya butun ish " +
            "maydonining hisobini sarflab, yonidagi sinxronizatsiyaga `429` keltirishi mumkin. `GET /me/` " +
            "ham shu hisobdan sarflaydi.",
        },
      ],
    },

    // -- 7 -------------------------------------------------------------------
    {
      id: "yoq",
      title: "Bu API nima qilmaydi",
      summary: "So'raladigan, lekin yo'q narsalar — topib o'tirmang.",
      icon: "info",
      blocks: [
        {
          kind: "text",
          body:
            "Yettita endpoint — bu ro'yxatning qisqaligi ataylab. Har bir endpoint ishlab turishga berilgan " +
            "va'da, va'dani kam berishning yo'li esa kam endpoint chiqarish. Quyidagilar — odam kutishi " +
            "mumkin bo'lgan, ammo yo'q narsalar.",
        },
        {
          kind: "rows",
          rows: [
            {
              term: "Oqimni yoqish/o'chirish",
              detail:
                "Yo'q. Yuklangan oqim `enabled: false` bo'lib tushadi va uni yoqish panelda qoladi — dastur " +
                "botni mijozlar oldiga o'zi chiqara olmaydi.",
            },
            { term: "Oqimni o'chirish", detail: "Yo'q. `DELETE /api/v1/flows/<id>/` → `405`." },
            {
              term: "Bot tokeni yoki webhook manzili",
              detail:
                "Yo'q. `bots:read` faqat niqoblangan `tokenMasked` ni beradi; haqiqiy tokenni bu API'ning " +
                "hech bir endpointi qaytarmaydi, webhook manzili esa umuman yo'q.",
            },
            {
              term: "Xabar yuborish",
              detail:
                "Yo'q. Bu API kontaktga yozmaydi va suhbatlarni ko'rmaydi. Xabar yuborish — oqimning ishi.",
            },
            {
              term: "Suhbatlar, analitika, to'lovlar, jamoa, ish maydoni sozlamalari",
              detail: "Yo'q — `/api/v1/` ostida bunday manzillar mavjud emas.",
            },
            { term: "Kontakt yozish", detail: "Yo'q. `contacts:read` faqat o'qiydi." },
            {
              term: "Bloklar lug'ati endpointi",
              detail:
                "Yo'q. Lug'at panelda: Bot → «Kod» → «Lug'atni nusxalash». API kaliti panel endpointlarini " +
                "ochmaydi.",
            },
            {
              term: "Kalit yaratish yoki bekor qilish",
              detail:
                "Yo'q. Kalit bilan kalit yaratib bo'lmaydi — aks holda to'rtta doira ma'nosini yo'qotardi. " +
                "Bu faqat panelda. `GET /me/` faqat o'qiydi va faqat **o'z** kalitini: qo'shni kalitlarni " +
                "sanab beradigan endpoint bu API'da yo'q.",
            },
            {
              term: "Webhook / hodisa yuborish",
              detail:
                "Yo'q. API tashqariga hech narsa yubormaydi — ma'lumot faqat siz so'raganingizda keladi. " +
                "Yangilikni bilish uchun so'rab turish kerak.",
            },
            {
              term: "Endpointlar ro'yxati API'ning o'zidan",
              detail:
                "Yo'q. `404` mavjud yo'llarni sanab bermaydi (yuqoriga qarang). Bitta yo'l haqida " +
                "so'ramoqchi bo'lsangiz — `OPTIONS`, va u kalit talab qiladi.",
            },
            {
              term: "OpenAPI fayli",
              detail: "Yo'q. Shu sahifa yagona ta'rif — mijoz kodini generatsiya qiladigan fayl chiqarilmaydi.",
            },
          ],
        },
        {
          kind: "note",
          body:
            "Ro'yxatdagi biror narsa kerak bo'lsa, uni bu yerda «tez orada» deb yozib qo'yishdan ko'ra " +
            "so'rab qo'ygan yaxshiroq — yo'q narsani va'da qilgan hujjat, yo'q narsaning o'zidan ko'ra ko'proq " +
            "vaqt yeydi.",
        },
        { kind: "link", href: "/help", label: "Yordam markazi", icon: "question" },
      ],
    },
  ];
}
