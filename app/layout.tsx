import './globals.css';
import './modern.css';
import './design-v3.css';
import localFont from 'next/font/local';
import { AppShell } from '@/components/AppShell';
import { PwaRegister } from '@/components/PwaRegister';

// Self-hosted variable font (no build-time network fetch): Urbanist, the
// geometric-humanist display face used by the Behance reference this
// redesign follows. Bundled locally under OFL so `next build` never
// depends on reaching fonts.googleapis.com.
const urbanist = localFont({ src: './fonts/Urbanist-Variable.ttf', weight: '100 900', variable: '--font-display', display: 'swap' });

// iOS's "Add to Home Screen" reads apple-touch-icon directly rather than
// the web manifest's icons — without this it was falling back to
// svma-logo.png (a 420x117 wide wordmark banner), which is why the
// installed icon looked stretched. icon-192.png is the proper square
// crop of just the mark.
export const metadata={title:'SVMA Intelligent AI Operations',description:'Finance, production, safety and AI management intelligence for SVMA',icons:{icon:'/favicon.png',apple:'/apple-touch-icon.png'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" className={urbanist.variable}><body><PwaRegister/><AppShell>{children}</AppShell></body></html>}
