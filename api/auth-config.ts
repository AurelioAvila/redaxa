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

  // Only a boolean is exposed: the browser talks to Supabase exclusively through the
  // /api/auth/* proxy endpoints now, so it has no need for the project URL or key.
  const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ configured });
}
