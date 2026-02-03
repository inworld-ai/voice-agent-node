import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { audioData, displayName, langCode } = body;

    // Validate required fields
    if (!audioData || typeof audioData !== 'string') {
      return NextResponse.json(
        { error: 'audioData is required and must be a base64 string' },
        { status: 400 }
      );
    }

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
      return NextResponse.json(
        { error: 'displayName is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Get API key and workspace from server-side environment variables
    const apiKey = process.env.INWORLD_API_KEY;
    const workspace = process.env.INWORLD_WORKSPACE;

    if (!apiKey || !apiKey.trim()) {
      return NextResponse.json(
        { error: 'INWORLD_API_KEY is not configured on the server' },
        { status: 500 }
      );
    }

    if (!workspace || !workspace.trim()) {
      return NextResponse.json(
        { error: 'INWORLD_WORKSPACE is not configured on the server' },
        { status: 500 }
      );
    }

    // Call Inworld Voice Cloning API
    const normalizedLangCode = langCode || 'EN_US';
    
    const requestBody = {
      displayName: displayName.trim(),
      langCode: normalizedLangCode,
      voiceSamples: [
        {
          audioData: audioData,
        },
      ],
    };
    
    const response = await fetch(
      `https://api.inworld.ai/voices/v1/workspaces/${workspace}/voices:clone`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: `HTTP ${response.status}: ${response.statusText}`,
      }));
      console.error('Inworld API error:', errorData);
      return NextResponse.json(
        { error: errorData.message || errorData.error || `Voice cloning failed: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Extract voice ID from response
    // The API returns either:
    // 1. data.voice.voiceId (from the voice object)
    // 2. data.voice.name (full resource name like "workspaces/{workspace}/voices/{voiceId}")
    // 3. data.voiceId (direct property)
    // 4. data.name (full resource name)
    const voiceId = data.voice?.voiceId 
      || (data.voice?.name ? data.voice.name.split('/').pop() : null)
      || (data.name ? data.name.split('/').pop() : null)
      || data.voiceId;

    console.log('✅ Voice cloned successfully:', {
      voiceId,
      voiceName: data.voice?.name,
      displayName: data.voice?.displayName || data.displayName || displayName,
      fullResponse: data,
    });

    // Return the voice ID and display name
    return NextResponse.json({
      voiceId: voiceId,
      displayName: data.voice?.displayName || data.displayName || displayName,
      warnings: data.audioSamplesValidated?.flatMap((s: any) => s.warnings || []) || data.warnings || [],
    });
  } catch (error: any) {
    console.error('Voice cloning error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to clone voice' },
      { status: 500 }
    );
  }
}
