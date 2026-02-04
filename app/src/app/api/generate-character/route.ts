import { NextRequest, NextResponse } from 'next/server';
import { generateCharacterPrompt } from '@/lib/characterGenerator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description } = body;

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json(
        { error: 'Description is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    const result = await generateCharacterPrompt(description.trim());
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Character generation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate character' },
      { status: 500 }
    );
  }
}
