// Worker entry. Routing under /parts is added in step 1, commit 3.

const NOINDEX = { "X-Robots-Tag": "noindex" };

export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404, headers: NOINDEX });
  },
} satisfies ExportedHandler;
