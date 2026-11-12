import type {CSSProperties} from 'react';

// SVMA's own two-tone icon set: a soft filled shape plus a line. One distinct glyph per module / function, so no icon stands for two different things.
// Purely presentational — colour comes from `currentColor`, styled by `.du` in app/design-v3.css.
const DROP='M12 2.5c3.6 4.6 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.4-6.4 6-11z';
const SHIELD='M12 2.8l7.5 2.8v6c0 4.7-3.2 8-7.5 9.6-4.3-1.6-7.5-4.9-7.5-9.6v-6z';
const CHAT='M4 5h16v11H11l-4.5 4v-4H4z';
const BELL='M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z';
const ICONS:Record<string,[string,string]>={
 mgmt:['M16 4h4v16h-4z','M4 20v-5h4v5M10 20V10h4v10M16 20V4h4v16M3 20.5h18'],
 solvent:[DROP,DROP+'M12 11.2l2.4 1.4v2.8L12 16.8l-2.4-1.4v-2.8z'],
 quality:['M7.2 14h9.6l2.4 4.2a2 2 0 0 1-1.8 3H6.6a2 2 0 0 1-1.8-3z','M9 3h6M10 3v5.5L4.8 18a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L14 8.5V3M9.5 16l2 2 3.5-4'],
 entry:['M8 4h8v3H8z','M8 4h8v3H8zM6 6h12a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM9 12l1 1 2-2M9 17l1 1 2-2M14 12h2.5M14 17h2.5'],
 qentry:['M9 3h6v4H9z','M9 3h6v4H9zM6 5h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 12h2M8.5 16h2M13 11.5a2.5 2.5 0 1 0 0 .01M14.8 13.3l2 2'],
 plant:['M3 4h18v12H3z','M3 4h18v12H3zM6 12l2.5-3 2.5 2.5 2-4 2.5 4M8.5 20h7M12 16v4'],
 finance:['M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z','M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12M9.5 8h5M9.5 10.5h5M9.5 8c3.5 0 3.5 4.5-.5 4.5l3 3'],
 import:['M3 15h18l-2.4 4.5H5.4z','M3 15h18l-2.4 4.5H5.4zM6 15v-4h4v4M10 15V9h4v6M14 15v-3h4v3M12 9V5'],
 export:['M4 9l8 3v9l-8-3z','M4 9l8-4 3 1.5M4 9v9l8 3 8-3V9l-3-1.5M4 9l8 3 8-3M12 12v9M16 3h5v5M21 3l-6 6'],
 work:['M4 7h10.5v10H4v-3a2 2 0 0 0 0-4z','M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14.5 8v1.5M14.5 11.2v1.6M14.5 14.5V16'],
 people:['M7 9a5 5 0 0 1 10 0z','M7 9a5 5 0 0 1 10 0zM5.5 9h13M9 11.5a3 3 0 0 0 6 0M5 21a7 7 0 0 1 14 0'],
 admin:[SHIELD,SHIELD+'M12 9.2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 13.2v3.3'],
 tally:['M6 8h12v4a6 6 0 0 1-12 0z','M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3'],
 chat:[CHAT,CHAT+'M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01'],
 bell:[BELL,BELL+'M10 20.5a2 2 0 0 0 4 0M3.2 9.5a8.8 8.8 0 0 1 2-4.5M20.8 9.5a8.8 8.8 0 0 0-2-4.5'],
 grid:['M14 3h7v7h-7z','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
 approvals:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z','M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16.5 9'],
 reports:['M6 3h8l5 5v13H6z','M6 3h8l5 5v13H6zM14 3v5h5M9 17v-3M12 17v-5M15 17v-2'],
 announce:['M3 9v6h4l9 4V5L7 9z','M3 9v6h4l9 4V5L7 9zM19 9a4 4 0 0 1 0 6'],
 myhr:['M3 6h18v12H3z','M3 6h18v12H3zM7.5 12a1.8 1.8 0 1 0 0-.01M5 16a3 3 0 0 1 5 0M13 10h5M13 14h4'],
 assets:['M5 5h14v10H5z','M5 5h14v10H5zM2.5 19h19l-1.5-4H4z'],
 access:['M15 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z','M15 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12.3 12.2L4 20.5V17h2.5v-2.5H9v-2'],
 credits:['M5 8c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z','M5 8c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 8v4c0 1.7 3.1 3 7 3s7-1.3 7-3V8M5 12v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4'],
 // finance
 scale:['M5 7h14l-2 3H7z','M12 4v16M4 20h16M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z'],
 recon:['M12 8.1a5 5 0 0 1 0 7.8 5 5 0 0 1 0-7.8z','M9 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM15 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z'],
 debtors:['M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z','M4 8h13M14 4.5L17.5 8 14 11.5M20 16H7M10 12.5L6.5 16 10 19.5'],
 resettle:['M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z','M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4'],
 daysum:['M5 5h14v4H5z','M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M10 12.5h4l-2.5 2.5 2.5 2.5h-4'],
 exceptions:['M8.5 3h7l5.5 5.5v7L15.5 21h-7L3 15.5v-7z','M8.5 3h7l5.5 5.5v7L15.5 21h-7L3 15.5v-7zM12 8v5M12 16.2v.01'],
 // HR work areas
 employees:['M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z','M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 20a5.5 5.5 0 0 1 11 0M16.5 11a3 3 0 1 0 0-6M17 14.5a5.5 5.5 0 0 1 4.5 5.5'],
 directory:['M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z','M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6zM9.5 3v18M14 9.5a1.8 1.8 0 1 0 0-.01M11.6 16.5a2.6 2.6 0 0 1 4.8 0M5 7h2M5 12h2M5 17h2'],
 departments:['M9 3h6v5H9z','M9 3h6v5H9zM12 8v4M5 12h14M5 12v4M19 12v4M3 16h4v4H3zM17 16h4v4h-4zM10 16h4v4h-4zM12 12v4'],
 compensation:['M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21z','M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21zM9 8h6M9 11h6M9 8c3.4 0 3.4 4-.5 4l2.6 3'],
 insurance:['M3 12a9 9 0 0 1 18 0z','M3 12a9 9 0 0 1 18 0zM12 12v6a2 2 0 0 0 4 0M12 3V2'],
 roster:['M4 5h16v4H4z','M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M14.5 12.2a3.2 3.2 0 1 0 2 5.3 4 4 0 0 1-2-5.3z'],
 leave:['M7 15a5 5 0 0 1 10 0z','M7 15a5 5 0 0 1 10 0zM3 15h18M12 5V3M5.6 8.6L4.2 7.2M18.4 8.6l1.4-1.4M4 19c2 1.2 3 1.2 5 0s3-1.2 5 0 3 1.2 6 0'],
 performance:['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z','M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l8-8M17 4h3v3'],
 companydocs:['M3 7h7l2 2h9v10H3z','M3 7h7l2 2h9v10H3zM9 15l2 2 4-4'],
 balances:['M12 4a8 8 0 1 0 8 8h-8z','M12 4a8 8 0 1 0 8 8M12 4v8h8'],
 edu:['M12 4l9 4-9 4-9-4z','M12 4l9 4-9 4-9-4zM6.5 10.5V16c1.4 1.3 3.4 2 5.5 2s4.1-.7 5.5-2v-5.5M21 8v6'],
 docs:['M6 3h8l5 5v13H6z','M6 3h8l5 5v13H6zM14 3v5h5M9 14h7M9 17h5'],
 overview:['M3 3h8v8H3z','M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z'],
 holidays:['M5 4h12l-2 4 2 4H5z','M5 21V3M5 4h12l-2 4 2 4H5M20 4v.01M21 9v.01M19 14v.01'],
};

export type DuoName=keyof typeof ICONS|string;
export function DuoIcon({name,size=20,className='',style}:{name:DuoName;size?:number;className?:string;style?:CSSProperties}){
 const [f,s]=ICONS[name]||ICONS.grid;
 return <svg className={`du ${className}`.trim()} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={style}><path className="f" d={f}/><path className="s" d={s}/></svg>;
}
