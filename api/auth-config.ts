type RequestLike = { method?: string };
type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(value: unknown): void;
  end(): void;
};

export default function handler(request: RequestLike, response: ResponseLike): void {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).end();
    return;
  }

  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    configured: Boolean(url && publishableKey),
    url: url ?? null,
    publishableKey: publishableKey ?? null
  });
}
