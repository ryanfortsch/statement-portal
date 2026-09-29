'use client';
import { usePathname } from 'next/navigation';
import { PilotLoading } from './PilotLoading';
export default function Loading() { return <PilotLoading inbox={usePathname().endsWith('/inbox')} />; }
