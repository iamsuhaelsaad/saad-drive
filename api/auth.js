import jwt from 'jsonwebtoken';
import {json,hashPin} from './_security.js';
export default function(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{const {pin}=JSON.parse(raw||'{}');if(!process.env.APP_PIN_HASH||hashPin(pin)!==process.env.APP_PIN_HASH)return json(res,401,{error:'Invalid PIN'});json(res,200,{token:jwt.sign({scope:'drive'},process.env.JWT_SECRET,{expiresIn:'2h'})})}catch{json(res,400,{error:'Invalid request'})}})}
