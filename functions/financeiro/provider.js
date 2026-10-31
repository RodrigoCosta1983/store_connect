'use strict';
const axios=require('axios');
const {resolveAsaasConfig}=require('./asaasConfig');
function validate(method,url,data){
 const config=resolveAsaasConfig();if(!config.operationsEnabled)throw Error('provider_operations_disabled');
 let u;try{u=new URL(url);}catch{throw Error('provider_url_invalid');}
 if(u.origin!=='https://api.asaas.com'||u.username||u.password||u.hash||!/^\/v3\/(customers|subscriptions|payments)(\/[A-Za-z0-9_-]+)?$/.test(u.pathname))throw Error('provider_url_forbidden');
 const resource=u.pathname.split('/')[2],id=u.pathname.split('/')[3];
 if(method==='POST'&&(!['customers','subscriptions'].includes(resource)||id))throw Error('provider_write_forbidden');
 if(method==='PUT'&&(resource!=='subscriptions'||!id||data?.updatePendingPayments===true))throw Error('provider_write_forbidden');
 if(!['GET','POST','PUT'].includes(method))throw Error('provider_write_forbidden');
}
async function request(method,url,data,options={}){
 validate(method,url,data);
 try{return await axios.request({method,url,data,headers:options.headers,params:options.params,timeout:25000,maxRedirects:0});}
 catch(original){const error=Error('Asaas request unavailable');error.code='ASAAS_REQUEST_FAILED';
  if(Number.isInteger(original.response?.status))error.response={status:original.response.status,data:{errors:[{code:'provider_request_failed',description:'Operacao Asaas indisponivel.'}]}};
  throw error;
 }
}
module.exports={validate,get:(u,o)=>request('GET',u,undefined,o),post:(u,d,o)=>request('POST',u,d,o),put:(u,d,o)=>request('PUT',u,d,o)};
