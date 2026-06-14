# חיבור Wizup → הבוט (כרטיס חיבור לבדיקות)

> ⚠️ הכתובת הזמנית הזו עובדת רק כל עוד המחשב פתוח והבוט+המנהרה רצים.
> היא משתנה בכל הפעלה מחדש. לייצור — נארח את הבוט קבוע (Render) ונקבל כתובת קבועה.

## פרטי החיבור (HTTP Request node ב-Wizup Flow Builder)
- **URL:** https://davis-caught-cottage-assists.trycloudflare.com/webhook
- **Method:** POST
- **Headers:**
  - `content-type: application/json`
  - `x-bot-secret: cmtm-wizup-7421`
- **Body (JSON):**
  ```json
  {
    "message": "{{טקסט ההודעה הנכנסת}}",
    "lead": { "id": "{{מספר הטלפון}}", "name": "{{שם הליד}}" }
  }
  ```
- **Response:** ה-JSON מכיל `reply` (הטקסט לשליחה ללקוח), `persona`, `new_score`, `handoff`.

## הפלואו ב-Wizup (Flow Builder)
1. **טריגר:** הודעה נכנסת (כל הודעה).
2. **HTTP Request:** לפי הפרטים למעלה.
3. **Send Message:** שלח את `{{reply}}` מתשובת ה-HTTP.
4. (אופציונלי) **Condition:** אם `handoff = true` → תייג/הקצה לנציג.

## בדיקה
לכתוב מהטלפון הפרטי למספר המחובר ב-Wizup → לראות את נועה עונה.
(בתוך חלון 24 שעות — הודעות session חופשיות, בלי צורך באישור תבניות.)

## הערות לבדיקה ראשונה
- בשלב הזה הבוט "סטייטלס" — עונה לכל הודעה בנפרד בלי לזכור את הקודמת.
  זיכרון שיחה (multi-turn) נוסיף אחרי שהפלואו הבסיסי עובד (שומרים היסטוריה ב-Fireberry/Wizup).
