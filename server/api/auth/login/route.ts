import { NextRequest, NextResponse } from 'next/server';
import { verifySession, createSessionToken } from '@/lib/auth';

const SESSION_DURATION = 3650 * 24 * 60 * 60 * 1000; // 10 years — no auto-logout

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

/**
 * Get all configured owner accounts from environment variables.
 * Supports:
 *   - OWNER1_USERNAME + OWNER1_PASSWORD (owner 1)
 *   - OWNER2_USERNAME + OWNER2_PASSWORD (owner 2)
 *   - ADMIN_USERNAME  + ADMIN_PASSWORD  (legacy fallback)
 * Returns array of { username, password } pairs.
 */
function getOwnerAccounts(): { username: string; password: string }[] {
  const accounts: { username: string; password: string }[] = [];

  // Owner 1 (primary)
  const o1User = process.env.OWNER1_USERNAME?.trim();
  const o1Pass = process.env.OWNER1_PASSWORD?.trim();
  if (o1User && o1Pass) accounts.push({ username: o1User, password: o1Pass });

  // Owner 2 (secondary)
  const o2User = process.env.OWNER2_USERNAME?.trim();
  const o2Pass = process.env.OWNER2_PASSWORD?.trim();
  if (o2User && o2Pass) accounts.push({ username: o2User, password: o2Pass });

  // Legacy: ADMIN_USERNAME + ADMIN_PASSWORD (backward compat)
  const adminUser = process.env.ADMIN_USERNAME?.trim();
  const adminPass = process.env.ADMIN_PASSWORD?.trim();
  if (adminUser && adminPass && !accounts.some(a => a.username === adminUser)) {
    accounts.push({ username: adminUser, password: adminPass });
  }

  return accounts;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    // Get all configured owner accounts
    const accounts = getOwnerAccounts();

    if (accounts.length === 0) {
      return NextResponse.json(
        { error: 'No owner credentials configured on server. Set OWNER1_USERNAME/OWNER1_PASSWORD and OWNER2_USERNAME/OWNER2_PASSWORD environment variables.' },
        { status: 500 }
      );
    }

    // Check credentials against all owner accounts
    let matched = false;
    for (const account of accounts) {
      if (constantTimeCompare(username, account.username) && constantTimeCompare(password, account.password)) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Add random delay (400-800ms) to prevent brute force
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // Create session token
    const token = await createSessionToken(username);

    // Set httpOnly cookie for API route protection
    const response = NextResponse.json({
      success: true,
      username,
      expiresAt: Date.now() + SESSION_DURATION,
    });

    response.cookies.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: SESSION_DURATION / 1000,
      path: '/',
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET endpoint to check if session is valid
export async function GET(request: NextRequest) {
  const username = await verifySession(request);
  if (username) {
    return NextResponse.json({ authenticated: true, username });
  }
  return NextResponse.json({ authenticated: false }, { status: 401 });
}

// DELETE endpoint to logout
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
  return response;
}
