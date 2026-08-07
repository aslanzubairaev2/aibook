import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { runImagePrompt } from "@/lib/ai/lessonModel";
import { buildImageExtractPrompt, parseExtractedImageText } from "@/lib/ai/buildImageLessonPrompt";

export const dynamic = "force-dynamic";
// Reading an image, or writing a document from it, routinely takes longer than
// the 10-second default: without this the platform kills the function mid-call
// and the browser reports only "Failed to fetch". 60s is the ceiling on the
// Hobby plan.
export const maxDuration = 60;


// Photos are downscaled and cropped in the browser before upload; this is the
// backstop against a client that does not, and against the platform's own body
// limit turning into an opaque 413.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// POST /api/lessons/from-image
// Body: { image: "data:image/jpeg;base64,…" }
//
// Reads the photo once and returns what it says and in what language. Nothing
// is saved here and the image is not stored — the lesson is built from the
// transcription by /api/lessons/from-text, so choosing a language or retrying
// never costs a second image call.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы создавать уроки." }, { status: 401 });
  }

  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Access Denied" }, { status: 403 });
  }

  const body = await req.json() as { image?: string };
  const dataUrl = (body.image ?? "").trim();

  const match = dataUrl.match(/^data:([a-z/+.-]+);base64,(.+)$/i);
  if (!match) {
    return NextResponse.json({ error: "Некорректное изображение." }, { status: 400 });
  }

  const [, mimeType, base64] = match;
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    return NextResponse.json({ error: "Поддерживаются JPEG, PNG и WebP." }, { status: 400 });
  }

  // base64 carries 3 bytes per 4 characters.
  if ((base64.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Снимок слишком большой. Обрежьте кадр плотнее." }, { status: 413 });
  }

  const result = await runImagePrompt(apiKey, buildImageExtractPrompt(), base64, mimeType.toLowerCase());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const extracted = parseExtractedImageText(result.data);
  if (!extracted) {
    return NextResponse.json(
      { error: "На снимке не удалось разобрать текст. Попробуйте кадр покрупнее или при лучшем свете." },
      { status: 422 },
    );
  }

  return NextResponse.json(extracted);
}
