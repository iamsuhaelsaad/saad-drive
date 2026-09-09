import crypto from 'node:crypto';import jwt from 'jsonwebtoken';
export const json=(res,s,b)=>{res.status(s).setHeader('Content-Type','application/json');res.end(JSON.stringify(b))};
export const hashPin=p=>crypto.createHash('sha256').update(String(p)).digest('hex');
export const sign=()=>jwt.sign({scope:'drive'},process.env.JWT_SECRET,{expiresIn:'2h'});
export function auth(req,res){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw 0;return jwt.verify(h.slice(7),process.env.JWT_SECRET)}catch{json(res,401,{error:'Unauthorized'});return null}}
