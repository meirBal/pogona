# פוגונה

יומן, שגרה ומדריך בעברית לגידול חרדונים (Pogona vitticeps).

- **היום** – כרטיס לכל חרדון, שגרה יומית, אבקת הערב, התראות
- **יומן** – משקל, צואה ואוראט, ארוחות, השלה, התנהגות, סיכום לווטרינר
- **התנהגות** – 16 התנהגויות מאוירות עם רמת דחיפות ובדיקה מהירה
- **אוכל** – ירקות שזמינים בסופר בארץ, טריות קופסת הסלט, סל שבועי
- **הקמה** – מחשבון טרריום וסימולציה, בדיקת טמפרטורות, רשימת קנייה, מדריך נורות

## טכנולוגיה
- קובץ `index.html` יחיד, בלי שלב build
- Supabase: התחברות במייל, Postgres עם RLS לכל משתמש, אחסון תמונות פרטי (`photos/<user_id>/...`)
- מפתח ה־publishable בקוד בטוח לחשיפה; ההרשאות נאכפות ב־RLS

## טבלאות
`households`, `household_members`, `household_invites`, `household_settings` (כולל `vet` jsonb), `dragons`, `bulbs`, `logs` (type + jsonb `v`). הגישה לפי חברות במשק בית (`is_member`), הזמנה בקישור `?join=CODE`, עדכון חי ב־Realtime.

## הרצה מקומית
```
python3 -m http.server 8000
```
ולהוסיף `http://localhost:8000/` ל־Redirect URLs ב־Supabase.

> המידע באפליקציה מבוסס על מקורות מגדלים (ReptiFiles, VCA) ואינו תחליף לווטרינר זוחלים.

## התראות (Web Push)
- פונקציית `supabase/functions/notify` רצה כל 15 דקות דרך `pg_cron` (job `pogona-notify`) עם כותרת `x-cron-secret`.
- מפתחות VAPID וסוד ה־cron שמורים בטבלה `app_secrets` (RLS בלי מדיניות, נגישה רק ל־service role).
- `push_subscriptions` לכל מכשיר, `push_sent` למניעת כפילויות. תזכורת לא נשלחת אם מישהו בבית כבר סימן.
