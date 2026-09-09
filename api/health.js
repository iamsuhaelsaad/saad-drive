import {json} from './_security.js';
export default function handler(req,res){return json(res,200,{name:'Saad Drive',status:'ok',timestamp:new Date().toISOString()})}
