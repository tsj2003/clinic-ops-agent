import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    mode: process.env.TINYFISH_MODE || 'mock',
    hasApiKey: !!process.env.TINYFISH_API_KEY
  });
}
