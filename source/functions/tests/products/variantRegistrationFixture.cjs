const {randomUUID}=require('node:crypto');
const base=require('../sales/fixtures/commercial08Fixture.cjs');
const {seedAdmission}=require('../sales/fixtures/storeWriterAdmissionFixture.cjs');
async function fixture(){const f=await base.fixture();await seedAdmission(base.db,f.scope.storeId,'authoritative');return f;}
function command(f){return {schemaVersion:1,requestId:randomUUID(),scope:{...f.scope},productId:randomUUID(),
 product:{productKind:'variantParent',name:'Camiseta',cod:'CAMISETA',attributeDefinitions:[
 {attributeId:'color',label:'Cor',values:[{valueId:'blue',label:'Azul'},{valueId:'black',label:'Preto'}]},
 {attributeId:'size',label:'Tamanho',values:[{valueId:'p',label:'P'},{valueId:'m',label:'M'},{valueId:'g',label:'G'}]}]},
 commercial:{priceCents:3990,costCents:1500},variants:[['blue','p'],['blue','m'],['black','g']].map(([color,size],i)=>({
 variantId:randomUUID(),variant:{attributes:[{attributeId:'color',valueId:color},{attributeId:'size',valueId:size}],cod:`CAM-${color}-${size}`},
 commercial:{priceCents:i===1?{mode:'override',value:4290}:{mode:'inherit'},costCents:{mode:'inherit'},minimumStock:1},
 initialStock:i===2?{kind:'convertToLots',lots:[{quantidade:2,validadeMs:2000000000000},{quantidade:3,validadeMs:2100000000000}]}:
 {kind:'setManualQuantity',quantity:4+i}}))};}
async function state(f,c){const p=f.store.collection('products').doc(c.productId);
 const [parent,variants,combos,profile,codes,receipts]=await Promise.all([p.get(),p.collection('variants').get(),
 p.collection('variantCombinations').get(),p.collection('commercialProfiles').get(),f.store.collection('productCodes').get(),f.store.collection('auditLogs').get()]);
 return {parent:parent.data()||null,variants:variants.docs.map(d=>({id:d.id,...d.data()})),combos:combos.size,profile:profile.size,codes:codes.size,receipts:receipts.size};}
module.exports={...base,fixture,command,state,seedAdmission};
