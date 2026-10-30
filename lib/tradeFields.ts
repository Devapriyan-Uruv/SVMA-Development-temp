// Field definitions for the Import/Export entry forms — one shared shape
// (components/trade/TradeFieldGrid.tsx) instead of ~90 near-identical JSX
// blocks. Keys are camelCase and match the API route's FIELD_MAP exactly
// (see app/api/import/entries/route.ts and app/api/export/entries/route.ts).
export type TradeField={key:string;label:string;type?:'text'|'number'|'date'|'checkbox'|'select'|'textarea';options?:{value:string;label:string}[]};

type Opt={value:string;label:string};

// Every camelCase field key here was deliberately chosen to be the exact
// camelCase spelling of its snake_case DB column (see the FIELD_MAP in
// app/api/import|export/entries/route.ts), so the detail pages can seed
// their edit form straight from the fetched row without a second,
// hand-maintained mapping table.
function camelToSnake(key:string):string{return key.replace(/([A-Z])/g,'_$1').toLowerCase()}
export function valuesFromEntry(entry:Record<string,any>,tabs:{fields:TradeField[]}[]):Record<string,any>{
 const values:Record<string,any>={};
 for(const tab of tabs)for(const f of tab.fields){
  const v=entry[camelToSnake(f.key)];
  values[f.key]=f.type==='checkbox'?!!v:(v==null?'':v);
 }
 return values;
}

export function importTabs(partyOptions:Opt[],commodityOptions:Opt[]):{key:string;label:string;fields:TradeField[]}[]{
 return [
  {key:'contract',label:'Contract',fields:[
   {key:'brokerName',label:'Broker Name'},
   {key:'partyId',label:'Supplier',type:'select',options:partyOptions},
   {key:'commodityId',label:'Commodity',type:'select',options:commodityOptions},
   {key:'country',label:'Country'},
   {key:'contractNo',label:'Contract No.'},
   {key:'contractDate',label:'Contract Date',type:'date'},
   {key:'contractQty',label:'Contract Qty',type:'number'},
   {key:'ratePerTon',label:'Rate / Ton',type:'number'},
   {key:'currency',label:'Currency'},
   {key:'contractValueFcy',label:'Contract Value (FCY)',type:'number'},
   {key:'paymentTerms',label:'Payment Terms'},
  ]},
  {key:'advance_lc',label:'Advance & LC',fields:[
   {key:'advancePct',label:'Advance %',type:'number'},
   {key:'advanceAmountFcy',label:'Advance Amount (FCY)',type:'number'},
   {key:'advanceRefNo',label:'Advance Ref No.'},
   {key:'advanceDate',label:'Advance Date',type:'date'},
   {key:'exchangeRate',label:'Exchange Rate',type:'number'},
   {key:'advanceValueInr',label:'Advance Value (₹)',type:'number'},
   {key:'lcNo',label:'LC No.'},
   {key:'lcType',label:'LC Type (Sight/Usance)'},
   {key:'lcOpeningDate',label:'LC Opening Date',type:'date'},
   {key:'lcExpiryDate',label:'LC Expiry Date',type:'date'},
   {key:'lcAmountFcy',label:'LC Amount (FCY)',type:'number'},
  ]},
  {key:'shipment',label:'Shipment',fields:[
   {key:'shipmentPeriod',label:'Shipment Period'},
   {key:'shipperName',label:'Shipper Name'},
   {key:'portOfLoading',label:'Port of Loading'},
   {key:'blAwbNo',label:'BL / AWB No.'},
   {key:'blDate',label:'BL Date',type:'date'},
   {key:'noOfContainers',label:'No. of Containers'},
   {key:'arrivalDate',label:'Arrival Date',type:'date'},
  ]},
  {key:'invoice_boe',label:'Invoice & BOE',fields:[
   {key:'invoiceNo',label:'Invoice No.'},
   {key:'invoiceDate',label:'Invoice Date',type:'date'},
   {key:'invoiceQty',label:'Invoice Qty',type:'number'},
   {key:'invoiceValueFcy',label:'Invoice Value (FCY)',type:'number'},
   {key:'balanceAmountFcy',label:'Balance Amount (FCY)',type:'number'},
   {key:'billRefNo',label:'Bill Reference No.'},
   {key:'billCollectionDate',label:'Bill Collection Date',type:'date'},
   {key:'billCollectionChargesInr',label:'Bill Collection Charges (₹)',type:'number'},
   {key:'boeNo',label:'BOE No.'},
   {key:'boeDate',label:'BOE Date',type:'date'},
   {key:'boePaidDate',label:'BOE Paid Date',type:'date'},
   {key:'boeAmountInr',label:'BOE Amount (₹)',type:'number'},
   {key:'assessableValueInr',label:'Assessable Value (₹)',type:'number'},
   {key:'basicCustomsDutyInr',label:'Basic Customs Duty (₹)',type:'number'},
   {key:'swsOtherDutyInr',label:'SWS / Other Duty (₹)',type:'number'},
   {key:'importIgstInr',label:'Import IGST (₹)',type:'number'},
   {key:'otherCustomsChargesInr',label:'Other Customs Charges (₹)',type:'number'},
  ]},
  {key:'bc_settlement',label:"Buyer's Credit & Settlement",fields:[
   {key:'settlementDate',label:'Settlement Date',type:'date'},
   {key:'settlementFxRate',label:'Settlement FX Rate',type:'number'},
   {key:'settlementValueInr',label:'Settlement Value (₹)',type:'number'},
   {key:'convertedToBc',label:"Converted to Buyer's Credit",type:'checkbox'},
   {key:'bcNo',label:'BC No.'},
   {key:'bcIssueDate',label:'BC Issue Date',type:'date'},
   {key:'bcPrincipalInr',label:'BC Principal (₹)',type:'number'},
   {key:'bcDueDate',label:'BC Due Date',type:'date'},
   {key:'bcInterestRate',label:'BC Interest Rate % p.a.',type:'number'},
   {key:'bcInterestAccruedInr',label:'BC Interest Accrued (₹)',type:'number'},
   {key:'bcInterestPaidInr',label:'BC Interest Paid (₹)',type:'number'},
   {key:'bcCloseChargesInr',label:'BC Close Charges (₹)',type:'number'},
   {key:'bcClosed',label:"Buyer's Credit Closed",type:'checkbox'},
   {key:'bcClosedDate',label:'BC Closed Date',type:'date'},
   {key:'brokerCommissionFcy',label:'Broker Commission (FCY)',type:'number'},
   {key:'brokerCommissionInr',label:'Broker Commission (₹)',type:'number'},
  ]},
  {key:'status_docs',label:'Status & Documents',fields:[
   {key:'documentsComplete',label:'All Documents Complete',type:'checkbox'},
   {key:'exceptionsNotes',label:'Exceptions / Issues',type:'textarea'},
   {key:'cfoComments',label:'CFO Comments / Action Required',type:'textarea'},
  ]},
 ];
}

export function exportTabs(partyOptions:Opt[],commodityOptions:Opt[]):{key:string;label:string;fields:TradeField[]}[]{
 return [
  {key:'contract',label:'Contract',fields:[
   {key:'partyId',label:'Customer',type:'select',options:partyOptions},
   {key:'commodityId',label:'Commodity',type:'select',options:commodityOptions},
   {key:'country',label:'Country'},
   {key:'incoterm',label:'Incoterm'},
   {key:'portOfLoading',label:'Port of Loading'},
   {key:'portOfDischarge',label:'Port of Discharge'},
   {key:'mode',label:'Mode (Sea/Air/Road)'},
   {key:'currency',label:'Currency'},
   {key:'contractNo',label:'Contract No.'},
   {key:'contractDate',label:'Contract Date',type:'date'},
   {key:'contractQty',label:'Contract Qty',type:'number'},
   {key:'contractValueFcy',label:'Contract Value (FCY)',type:'number'},
   {key:'advancePct',label:'Advance %',type:'number'},
   {key:'advanceAmountFcy',label:'Advance Amount (FCY)',type:'number'},
   {key:'balanceAmountFcy',label:'Balance Amount (FCY)',type:'number'},
  ]},
  {key:'lc_finance',label:'LC & Pre-shipment Finance',fields:[
   {key:'lcOrNonlc',label:'LC / Non-LC'},
   {key:'lcNo',label:'LC No.'},
   {key:'lcDate',label:'LC Date',type:'date'},
   {key:'lcType',label:'LC Type (Sight/Usance)'},
   {key:'lcAmountFcy',label:'LC Amount (FCY)',type:'number'},
   {key:'lcExpiryDate',label:'LC Expiry Date',type:'date'},
   {key:'latestShipmentDate',label:'Latest Shipment Date',type:'date'},
   {key:'amendmentDetails',label:'Amendment Details',type:'textarea'},
   {key:'pcAmountInr',label:'Packing Credit Amount (₹)',type:'number'},
   {key:'pcDate',label:'Packing Credit Date',type:'date'},
   {key:'goodsReadyDate',label:'Goods Ready Date',type:'date'},
  ]},
  {key:'shipment',label:'Shipment',fields:[
   {key:'shipmentInvoiceNo',label:'Invoice No.'},
   {key:'invoiceDate',label:'Invoice Date',type:'date'},
   {key:'invoiceValueFcy',label:'Invoice Value (FCY)',type:'number'},
   {key:'shippingBillNo',label:'Shipping Bill No.'},
   {key:'shippingBillDate',label:'Shipping Bill Date',type:'date'},
   {key:'blAwbNo',label:'BL / AWB No.'},
   {key:'blDate',label:'BL Date',type:'date'},
   {key:'actualShipmentDate',label:'Actual Shipment Date',type:'date'},
   {key:'etd',label:'ETD',type:'date'},
   {key:'eta',label:'ETA',type:'date'},
   {key:'docsSubmittedDate',label:'Documents Submitted to Bank',type:'date'},
  ]},
  {key:'bill_realisation',label:'Export Bill & Realisation',fields:[
   {key:'exportBillNo',label:'Export Bill No.'},
   {key:'billDate',label:'Bill Date',type:'date'},
   {key:'billType',label:'Bill Type (DP/DA/Usance)'},
   {key:'billAmountFcy',label:'Bill Amount (FCY)',type:'number'},
   {key:'bankAdCode',label:'Bank / AD Code'},
   {key:'bcConvertedDate',label:'Bill Converted Date',type:'date'},
   {key:'dueDate',label:'Due Date',type:'date'},
   {key:'realisationDate',label:'Realisation Date',type:'date'},
   {key:'realisedAmountFcy',label:'Realised Amount (FCY)',type:'number'},
   {key:'exchangeRate',label:'Exchange Rate',type:'number'},
   {key:'exchangeDifferenceInr',label:'Exchange Difference (₹)',type:'number'},
   {key:'bankChargesInr',label:'Bank Charges (₹)',type:'number'},
   {key:'interestRate',label:'Interest Rate',type:'number'},
   {key:'interestAmountInr',label:'Interest Amount (₹)',type:'number'},
  ]},
  {key:'incentives_tracking',label:'Incentives & Follow-up',fields:[
   {key:'customsDutyInr',label:'Customs Duty (₹)',type:'number'},
   {key:'igstRefundInr',label:'IGST Refund (₹)',type:'number'},
   {key:'otherIncentivesInr',label:'Other Incentives / Drawback (₹)',type:'number'},
   {key:'reasonForDelay',label:'Reason for Delay',type:'textarea'},
   {key:'followUpAction',label:'Follow-up / Action Required',type:'textarea'},
   {key:'managementComments',label:'Management Comments',type:'textarea'},
  ]},
 ];
}
