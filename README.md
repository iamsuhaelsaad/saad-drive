# Saad Drive

Vercel-ready backend foundation for the Saad Drive prototype.

## What is wired
- Server-side PIN verification with SHA-256 hash comparison
- Short-lived JWT access token
- Protected API route and health check
- Telegram storage configuration through environment variables
- No bot token or PIN stored in frontend code

## Deploy
1. Import this folder into Vercel.
2. Add the variables from `.env.example` in Vercel Project Settings.
3. Generate a PIN hash locally:
   `node -e "console.log(require('crypto').createHash('sha256').update('246810').digest('hex'))"`
4. Set `APP_PIN_HASH` to that output and set a long random `JWT_SECRET`.
5. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## Important
This starter intentionally does not pretend Telegram is a complete database. The next backend pass should add a metadata index, upload/download routes, folder records, signed URLs, rate limiting, MIME/size checks, and audit logging before production use.
