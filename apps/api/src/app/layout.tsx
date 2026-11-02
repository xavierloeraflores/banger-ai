import '@banger/shadcn/styles.css';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'banger-ai'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
