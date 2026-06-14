# בוט נועה — שירות המוח (Claude)

ה"מוח" של מערכת חימום הלידים: מקבל הודעה נכנסת, עונה בעברית מבסיס הידע של המכללה,
מזהה פרסונה, מנקד את חום הליד, ומחליט מתי להעביר לנציג. בלי תלויות חיצוניות (Node 20+).

## מבנה
```
bot/
  system-prompt.md      ← אישיות + חוקים קשיחים של נועה
  knowledge-base.md     ← בסיס הידע (שיטה, מסלולים, מחירים, עדויות, FAQ)
  src/
    config.js           ← טעינת .env
    knowledge.js        ← מרכיב את ה-system prompt
    claude.js           ← קריאה ל-Claude API (tool-use → JSON מובנה)
    brain.js            ← אורקסטרציה + גרדריילים (הסרה, רשת ביטחון למחיר, נציג)
    fireberry.js        ← עדכון שדות wa_* בכרטיס הליד
    server.js           ← webhook ל-Make/Wizup
  test/
    run.js              ← בדיקות אוטומטיות (MOCK בלי מפתח / LIVE עם מפתח)
    chat.js             ← צ'אט אינטראקטיבי בטרמינל
```

## התקנה והרצה
```bash
cd bot
cp .env.example .env        # מלא ANTHROPIC_API_KEY ו-WEBHOOK_SECRET
npm test                    # בדיקות (רץ גם בלי מפתח — מצב MOCK)
npm run chat                # שיחה אינטראקטיבית עם הבוט
npm start                   # מריץ את ה-webhook על PORT (ברירת מחדל 3000)
```

## ה-webhook
`POST /webhook` (כותרת `x-bot-secret: <WEBHOOK_SECRET>`)

**קלט:**
```json
{
  "lead":    { "id": "fireberry-record-id", "name": "מיכל", "persona": "unknown", "score": 0 },
  "message": "ההודעה שהליד שלח עכשיו",
  "history": [ {"role":"user","content":"..."}, {"role":"assistant","content":"..."} ]
}
```
**פלט:**
```json
{
  "reply": "טקסט לשליחה ללקוח בוואטסאפ",
  "persona": "parent",
  "intent": "buying_signal",
  "new_score": 45,
  "handoff": true,
  "handoff_reason": "שאלת מחיר — נדרשת יועצת",
  "status": "hot"
}
```
`GET /health` — בדיקת חיים + מצב (live/mock).

## איך זה מתחבר ל-Make/Wizup
ב-Make (תרחיש #2 ב-`../BUILD-GUIDE.md`): מודול HTTP → POST ל-`/webhook` של השירות הזה
עם ה-lead (מ-Fireberry) וה-message (מ-Wizup). את ה-`reply` שולחים ללקוח דרך Wizup,
ואת `handoff`/`new_score`/`status` משתמשים לניתוב ועדכון Fireberry.
(אפשר גם להריץ את לוגיקת Claude ישירות במודול HTTP של Make בלי השירות הזה —
אבל השירות נותן גרדריילים, ניקוד ועדכון Fireberry במקום אחד ונבדק.)

## אירוח
- מקומי לבדיקות.
- ייצור: כל פלטפורמה שמריצה Node (Render / Railway / VPS קטן). אין DB — המצב נשמר ב-Fireberry.

## גרדריילים מובנים (לא תלויים במודל)
1. **הסרה** ("הסר") — מזוהה דטרמיניסטית, תשובה קבועה, בלי קריאה למודל, `wa_status=unsubscribed`.
2. **רשת ביטחון למחיר** — אם המודל בטעות נוקב מחיר לימוד (1,000₪+), התשובה מוחלפת אוטומטית
   ב"שיחת התאמה" ומועברת לנציג. (מחירי טיפול 200–400₪ ודמי הרשמה 400₪ מותרים.)
3. **בקשת נציג** — מילת "נציג"/"יועצת" מבטיחה `handoff=true`.
