import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
export function json(res,status,payload){res.status(status).setHeader('Content-Type','application/json');return res.end(JSON.stringify(payload));}
export function hashPin(pin){return crypto.createHash('sha256').update(String(pin)).digest('hex');}
export function tokenFor(){return jwt.sign({scope:'drive'},process.env.JWT_SECRET,{expiresIn:'2h'});}
export function requireAuth(req,res){try{const value=req.headers.authorization||'';if(!value.startsWith('Bearer '))throw new Error('missing');return jwt.verify(value.slice(7),process.env.JWT_SECRET)}catch{return json(res,401,{error:'Unauthorized'})}}
