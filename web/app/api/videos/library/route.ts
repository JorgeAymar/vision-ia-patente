import { NextResponse } from 'next/server';
import { listAvailableVideos } from '@/lib/videoLibrary';

export async function GET() {
  const videos = await listAvailableVideos();
  return NextResponse.json({ videos });
}
