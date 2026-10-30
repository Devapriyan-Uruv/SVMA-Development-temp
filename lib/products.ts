export type ProductCode='RB'|'COPRA'|'PK';
export type ProductDef={code:ProductCode;name:string;shortName:string;description:string};
export const PRODUCTS:ProductDef[]=[
 {code:'RB',name:'Rice Bran',shortName:'Rice Bran',description:'Rice Bran / DORB / RB Oil process'},
 {code:'COPRA',name:'Copra',shortName:'Copra',description:'Edible & Non-Edible Copra / DOC / Copra Oil process'},
 {code:'PK',name:'Palm Kernel',shortName:'Palm Kernel',description:'Palm Kernel / PK DOC / PK Oil process'},
];
export function productName(code?:string|null){return PRODUCTS.find(p=>p.code===code)?.name||code||'Plant-wide'}
export function isProductCode(v:unknown):v is ProductCode{return PRODUCTS.some(p=>p.code===v)}
