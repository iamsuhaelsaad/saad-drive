import Busboy from 'busboy';
import {json,requireAuth,telegramUrl,configured} from './_security.js';
const MAX=Number(process.env.MAX_UPLOAD_MB||20)*1024*1024;
export const config={api:{bodyParser:false}};
export default async function(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(!requireAuth(req,res))return;
  if(!configured())return json(res,503,{error:'Telegram storage is not configured'});
  const bb=Busboy({headers:req.headers,limits:{files:1,fileSize:MAX}});let file=null;let tooBig=false;
  bb.on('file',(field,stream,info)=>{const chunks=[];let size=0;file={name:info.filename,type:info.mimeType};stream.on('data',c=>{size+=c.length;if(size<=MAX)chunks.push(c)});stream.on('limit',()=>{tooBig=true});stream.on('end',()=>{if(file)file.buffer=Buffer.concat(chunks)})});
  bb.on('finish',async()=>{try{if(tooBig)return json(res,413,{error:`File exceeds ${MAX/1024/1024} MB limit`});if(!file?.buffer?.length)return json(res,400,{error:'No file supplied'});const form=new FormData();form.append('chat_id',process.env.TELEGRAM_CHAT_ID);form.append('caption',`Saad Drive | ${file.name}`);form.append('document',new Blob([file.buffer],{type:file.type||'application/octet-stream'}),file.name);const r=await fetch(telegramUrl('sendDocument'),{method:'POST',body:form});const d=await r.json();if(!r.ok||!d.ok)return json(res,502,{error:'Telegram upload failed',detail:d.description});const doc=d.result.document;return json(res,200,{ok:true,file:{id:doc.file_id,name:file.name,size:doc.file_size,mime:file.type}})}catch(e){return json(res,500,{error:'Upload failed',detail:e.message})}});req.pipe(bb)
}
