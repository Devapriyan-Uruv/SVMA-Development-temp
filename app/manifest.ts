import type { MetadataRoute } from 'next';
// icon-192/icon-512 are a proper square crop of just the SVMA mark (the
// leaf graphic), padded and centered on a white square — svma-logo.png
// itself is a 420x117 wide wordmark banner, never meant to be forced into
// a square home-screen icon slot, which is what made the installed icon
// look stretched/off on both Android and iOS. The maskable variant keeps
// the mark within Android's adaptive-icon safe zone so its own circle/
// squircle mask never clips it.
export default function manifest():MetadataRoute.Manifest{return {name:'SVMA Intelligent AI Operations',short_name:'SVMA Ops',start_url:'/login',display:'standalone',background_color:'#f3f7fb',theme_color:'#08246f',description:'SVMA Finance, Solvent Production & Safety and CEO intelligence',icons:[
 {src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
 {src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
 {src:'/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
]}}
