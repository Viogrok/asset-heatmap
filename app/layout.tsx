import type { Metadata } from 'next';import './globals.css';
export const metadata:Metadata={title:'资产地图',description:'私人持仓与市场热力图',manifest:'/manifest.webmanifest',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
