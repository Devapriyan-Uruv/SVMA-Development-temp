// Deterministic target parsing and validation for Quality/Solvent/Boiler.
// AI is never used to decide whether an operational reading is within target.

export type TargetBounds = {
  low: number | null;
  high: number | null;
  exact: number | null;
  lowInclusive: boolean;
  highInclusive: boolean;
  ambiguous: boolean;
};

const UPPER_WORDS = /\b(BELOW|MAX\.?|MAXIMUM|UP ?TO|NOT MORE THAN|NOT EXCEEDING)\b/;
const LOWER_WORDS = /\b(ABOVE|MIN\.?|MINIMUM|NOT LESS THAN|AT LEAST)\b/;
const MULTI_BRANCH = /\b(E|NE|EDIBLE|NON[- ]EDIBLE)\b.*[&/].*\b(E|NE|EDIBLE|NON[- ]EDIBLE)\b/;
const empty = ():TargetBounds => ({low:null,high:null,exact:null,lowInclusive:true,highInclusive:true,ambiguous:false});

export function parseTargetBounds(raw?: string | null): TargetBounds {
  const out=empty();
  if(raw==null)return out;
  const text=String(raw).trim(); if(!text)return out;
  const upper=text.toUpperCase();
  if(upper==='OOS'||upper==='N/A'||upper==='NA'||MULTI_BRANCH.test(upper))return {...out,ambiguous:true};

  // Keep signs while removing ordinary unit text. This intentionally supports
  // source targets such as "-2 mm - +4 mm" and "2.5 KG - 3.5 KG".
  // A trailing "/" directly after a number (source formatting like
  // "8000/ LPH-12000/ LPH", meant as a plain "8000 LPH to 12000 LPH" range)
  // used to break the range match below entirely — the "/" sat between the
  // number and the required separator, so only the first number was ever
  // read, as a bare exact target instead of a range. Stripped here, before
  // unit removal, so it never reaches the range/exact matching at all.
  // The unit token itself is stripped with a lookbehind for a digit or
  // whitespace (not a leading \b) because a \b never matches between a digit
  // and an immediately-following letter — both are "word" characters. A
  // target glued straight onto its unit, e.g. "-2MM TO -4MM", used to leave
  // "MM" in place, which broke the range match below and silently collapsed
  // the whole target to an exact-match test against just the first number.
  const clean=upper.replace(/,/g,'').replace(/(\d)\/(?=\s|[A-Z]|$)/g,'$1').replace(/°\s*C/g,'').replace(/%/g,'').replace(/(?<=[\d\s])(KG\/CM²\(G\)|KG\/CM2\(G\)|KG|MM\/KG|MM|AMS|AMPS|A|RPM|LPH|PPM)\b/g,' ').replace(/\s+/g,' ').trim();

  const signedRange=clean.match(/([+-]?\d+(?:\.\d+)?)\s*(?:-|–|—|TO)\s*([+-]?\d+(?:\.\d+)?)/);
  if(signedRange){const a=Number(signedRange[1]),b=Number(signedRange[2]);return {low:Math.min(a,b),high:Math.max(a,b),exact:null,lowInclusive:true,highInclusive:true,ambiguous:false};}

  const le=clean.match(/<=\s*([+-]?\d+(?:\.\d+)?)/); if(le)return {low:null,high:Number(le[1]),exact:null,lowInclusive:true,highInclusive:true,ambiguous:false};
  const ge=clean.match(/>=\s*([+-]?\d+(?:\.\d+)?)/); if(ge)return {low:Number(ge[1]),high:null,exact:null,lowInclusive:true,highInclusive:true,ambiguous:false};
  const lt=clean.match(/<\s*([+-]?\d+(?:\.\d+)?)/); if(lt)return {low:null,high:Number(lt[1]),exact:null,lowInclusive:true,highInclusive:false,ambiguous:false};
  const gt=clean.match(/>\s*([+-]?\d+(?:\.\d+)?)/); if(gt)return {low:Number(gt[1]),high:null,exact:null,lowInclusive:false,highInclusive:true,ambiguous:false};

  const num=clean.match(/([+-]?\d+(?:\.\d+)?)/);
  if(num){
    const n=Number(num[1]);
    if(UPPER_WORDS.test(clean))return {low:null,high:n,exact:null,lowInclusive:true,highInclusive:true,ambiguous:false};
    if(LOWER_WORDS.test(clean))return {low:n,high:null,exact:null,lowInclusive:true,highInclusive:true,ambiguous:false};
    return {low:null,high:null,exact:n,lowInclusive:true,highInclusive:true,ambiguous:false};
  }
  return {...out,ambiguous:true};
}

export function numericDeviationReason(raw:string|null|undefined,n:number):string|null{
  const b=parseTargetBounds(raw); if(b.ambiguous)return null;
  if(b.low!=null && (b.lowInclusive?n<b.low:n<=b.low))return `Below ${b.lowInclusive?'minimum':'strict minimum'} target ${b.low}`;
  if(b.high!=null && (b.highInclusive?n>b.high:n>=b.high))return `Above ${b.highInclusive?'maximum':'strict maximum'} target ${b.high}`;
  if(b.exact!=null && Math.abs(n-b.exact)>1e-9)return `Expected ${b.exact}; actual differs by ${(n-b.exact).toFixed(3).replace(/\.000$/,'')}`;
  return null;
}

export function numericDeviatesFromTarget(raw:string|null|undefined,n:number):boolean{return numericDeviationReason(raw,n)!=null;}

export function categoricalDeviatesFromTarget(targetRaw:string|null|undefined,actualRaw:string|null|undefined):boolean{
  const t=String(targetRaw||'').trim().toUpperCase(),a=String(actualRaw||'').trim().toUpperCase();
  if(!t||!a)return false;
  if(['ABNORMAL','FAIL','FAILED','X','UNAUTHORISED PERSON','UNAUTHORIZED PERSON','NOT OK'].includes(a))return true;
  if(t.includes('AUTHORISED PERSON')||t.includes('AUTHORIZED PERSON'))return a.includes('UNAUTHORISED')||a.includes('UNAUTHORIZED');
  if(t.includes('CLOSED'))return a==='OPEN';
  if(t.includes('AVAILABLE')||t.includes('AVAILBLE'))return a.includes('NOT AVAILABLE');
  if(t.includes('CLEAN'))return a.includes('NOT CLEAN');
  // "NO LEAK" itself contains the substring "LEAK" — a plain a.includes('LEAK')
  // check flagged the fully compliant answer as a deviation every time. Rule
  // out the negated/compliant phrasings first.
  if(t.includes('NO LEAK')||t.includes('NO LEACK')||t.includes('VAPOUR NIL')||t.includes('VAPPOUR NIL')||t==='NIL'){
    if(a.includes('NO LEAK')||a.includes('NO LEACK')||a==='NIL')return false;
    return a.includes('LEAK')||a.includes('PRESENT')||a.includes('DETECTED');
  }
  if(t==='HIGH')return a==='LOW';
  if(t==='ON')return a==='OFF';
  // Generic condition/monitoring/maintain targets are represented in the UI
  // with NORMAL/ABNORMAL choices; only an explicit abnormal state deviates.
  return false;
}
