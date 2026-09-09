import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
export function json(res,status,body){res.status(status).setHeader('Content-Type','application/json');res.end(JSON.stringify(body));}
export function hashPin(pin){return crypto.createHash('sha256').update(String(pin)).digest('hex');}
export function requireAuth(req,res){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw new Error();return jwt.verify(h.slice(7),process.env.JWT_SECRET)}catch{json(res,401,{error:'Unauthorized'});return null}}
export function telegramUrl(method){return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`}
export function configured(){return Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID&&process.env.JWT_SECRET)}
