# Oqim Studio

Telegram bot avtomatlashtirish platformasi: vizual oqim muharriri va uni haqiqiy
suhbatlarda ishlatadigan runtime.

```
otchyot/
  frontend/   Next.js 16 · React 19 · Tailwind 4 — interfeys (o'zbekcha)
  backend/    Django 6 · DRF · Channels · Celery — API, webhook, oqim runtime
```

## Ishga tushirish

**Frontend** — `frontend/README` o'rnida `frontend/AGENTS.md` va `package.json`:

```bash
cd frontend
npm install
cp .env.example .env      # API_BASE_URL -> http://127.0.0.1:8000
npm run dev               # http://localhost:3000
```

Backend ishlab turishi shart: interfeys hamma ma'lumotni undan oladi.

**Backend** — to'liq qo'llanma: [`backend/README.md`](backend/README.md)

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
cp .env.example .env

.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py seed_demo     # namuna ish maydoni
.venv/Scripts/python manage.py runserver     # http://localhost:8000 (ASGI)
```

Redis kerak bo'ladi (Celery brokeri + Channels qatlami):

```bash
docker run -p 6379:6379 redis:7
.venv/Scripts/python -m celery -A config worker -l info --pool=solo
.venv/Scripts/python -m celery -A config beat  -l info
```

Namuna kirish: **aziza@sunrise.uz / Parol12345** (Sunrise Agency ish maydoni).

## Ikkalasi orasidagi bog'lanish

Interfeys **butunlay** Django API'dan o'qiydi va unga yozadi: `src/features/*/data/`
ichidagi repozitoriylar `/api/...` ga so'rov yuboradi, xotiradagi namuna
ma'lumotlar qolmadi.

- Yagona seam: [`frontend/src/lib/api/server.ts`](frontend/src/lib/api/server.ts) —
  manzil, autentifikatsiya, tenant sarlavhasi va xato shakli shu yerda.
- Kredensial — `oqim_token` httpOnly cookie'si. Brauzer uni o'qiy olmaydi;
  API'ga har bir so'rovni Next serveri yuboradi. Kirish, ro'yxatdan o'tish va
  chiqish — server action'lar.
- Faol ish maydoni `X-Workspace-Id` sarlavhasida ketadi, backend esa uni
  a'zoliklarga qarab tekshiradi.
- Oqim muharriri kanvasni backend'ga avtosaqlaydi (`PUT /api/flows/<id>/graph/`),
  backend o'sha so'rovda trigger indeksini qayta quradi.

Telegram bilan faqat backend gaplashadi: token bot ulanganda tekshiriladi va
webhook o'sha yerda ro'yxatdan o'tadi — frontendda Telegram tokeni yo'q.

Realtime: `ws://localhost:8000/ws/workspace/<id>/?token=<key>` — oqim qadamlari,
bot faoliyati va bildirishnomalar shu yerdan keladi. Backend tomoni tayyor;
interfeysda hali obuna bo'ladigan ekran yo'q.
