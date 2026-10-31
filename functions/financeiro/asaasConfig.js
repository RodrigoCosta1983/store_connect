'use strict';
function resolveAsaasConfig(){
 const projectId=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT;
 if(projectId!=='store-connect-app'||(process.env.GCLOUD_PROJECT&&process.env.GOOGLE_CLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==process.env.GOOGLE_CLOUD_PROJECT)||process.env.ASAAS_ENV!=='production'||process.env.ASAAS_CREDENTIAL_ENV!=='production'||process.env.FUNCTIONS_EMULATOR==='true'||process.env.FIRESTORE_EMULATOR_HOST)throw Error('Unauthorized Asaas configuration');
 return Object.freeze({projectId,environment:'production',baseUrl:'https://api.asaas.com/v3',publicRollout:process.env.ASAAS_PROD_MODE==='public',operationsEnabled:process.env.ASAAS_PROD_MODE==='public'&&process.env.ASAAS_PROD_READS==='enabled'});
}module.exports={resolveAsaasConfig};
