import {json,auth} from './_security.js';
export default async function(req,res){if(!auth(req,res))return;if(req.method==='GET')return json(res,200,{items:[],storage:'telegram',ready:Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID)});return json(res,501,{error:'Upload/download adapter is next'});}
