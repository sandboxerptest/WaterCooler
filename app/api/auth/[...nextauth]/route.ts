import type { NextRequest } from "next/server";
import { authConfigured, handlers } from "@/lib/auth/config";

/** Auth.js's own endpoints — or a plain 404 while sign-in is not set up. */
const notSetUp = () => Response.json({ error: "Sign-in is not set up" }, { status: 404 });

export const GET = (request: NextRequest) =>
  authConfigured() ? handlers.GET(request) : notSetUp();
export const POST = (request: NextRequest) =>
  authConfigured() ? handlers.POST(request) : notSetUp();
