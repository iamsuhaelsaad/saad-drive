import {json,requireAuth} from './_security.js';
export default function(req,res){if(!requireAuth(req,res))return;json(res,200,{items:[],message:'Upload responses include file_id. Persist file metadata in a database before enabling full listing and folders.'})}
