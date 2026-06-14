# הקמת WhatsApp Cloud API ב-Meta — מדריך צעד-צעד

המטרה: לקבל מספר בדיקה חינמי + טוקן, לחבר ל-webhook של הבוט, ולשלוח הודעה אמיתית.
זמן: ~15 דקות. לא נוגעים במספר האמיתי שלך ב-Wizup.

---

## כתובת ה-webhook של הבוט (תצטרך בשלב 4)
```
https://better-high-gives-conflicts.trycloudflare.com/whatsapp
Verify token:  cmtm-verify-7421
```
> הכתובת זמנית — אם הבוט יופעל מחדש היא תשתנה. הרץ `bash ~/cmtm-leads-bot/start-bot.sh` כדי לראות את הנוכחית.

---

## שלב 1 — צור אפליקציה
1. כנס ל-[developers.facebook.com](https://developers.facebook.com) (התחבר עם הפייסבוק שמנהל את ה-Business Manager).
2. **My Apps** → **Create App**.
3. בחר סוג **Business** → **Next**.
4. תן שם (למשל "CMTM Bot") → בחר את ה-Business portfolio שלך → **Create app**.

## שלב 2 — הוסף את מוצר WhatsApp
1. במסך האפליקציה → גלול ל-**WhatsApp** → **Set up**.
2. זה ייצור אוטומטית חשבון WhatsApp לבדיקה + **מספר בדיקה חינמי** של Meta.

## שלב 3 — קח את הטוקן ואת ה-Phone Number ID
במסך **WhatsApp → API Setup**:
1. **Temporary access token** — העתק (תקף 24 שעות, מספיק לבדיקות).
2. **Phone number ID** — מתחת ל-"From", העתק את המספר הארוך (זה ה-ID, לא הטלפון).
3. **הוסף את הטלפון שלך כנמען בדיקה:** תחת "To" → **Manage phone number list** → הוסף את מספר הטלפון הפרטי שלך → אשר עם הקוד שתקבל בוואטסאפ.
   (מספר בדיקה יכול לשלוח רק עד 5 מספרים מאושרים — זה בסדר לבדיקות.)

## שלב 4 — חבר את ה-webhook
במסך **WhatsApp → Configuration**:
1. ליד **Webhook** → **Edit**.
2. **Callback URL:** `https://better-high-gives-conflicts.trycloudflare.com/whatsapp`
3. **Verify token:** `cmtm-verify-7421`
4. **Verify and save** (Meta יקרא לבוט ויאמת — הבוט שלנו כבר יודע לענות על זה).
5. אחרי שנשמר → ליד **Webhook fields** → **Manage** → סמן **messages** (Subscribe).

## שלב 5 — הזן את הטוקן ל-.env
שלח לי כאן בצ'אט את שני הערכים (טוקן + Phone number ID) ואני אכניס ואפעיל מחדש.
או לבד: ב-`~/cmtm-leads-bot/bot/.env`:
```
WHATSAPP_TOKEN=<הטוקן הזמני>
WHATSAPP_PHONE_NUMBER_ID=<ה-ID>
```
ואז: `bash ~/cmtm-leads-bot/start-bot.sh`

## שלב 6 — בדיקה אמיתית 🎉
מהטלפון הפרטי שלך → שלח הודעת וואטסאפ **למספר הבדיקה של Meta** (מופיע ב-API Setup),
למשל: *"היי, ראיתי את הקורס, יש לי כמה שאלות"* → נועה תענה לך בוואטסאפ אמיתי!

---

## לזכור
- הטוקן הזמני תקף 24 שעות. לייצור — ניצור System User token קבוע (נדריך כשנגיע).
- המספר האמיתי שלך נשאר ב-Wizup, לא נגענו בו. המעבר שלו = שלב נפרד בהמשך.
