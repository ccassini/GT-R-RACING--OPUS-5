/**
 * Two deployment shapes from one codebase.
 *
 * Default: a normal Next server, which is what the chain integration
 * will eventually want — an indexer proxy or an RPC route can hold its
 * API key server-side instead of shipping it to the browser.
 *
 * STATIC_EXPORT=1: emits a plain `out/` directory for static hosting
 * (HuggingFace Spaces, GitHub Pages, any CDN). Server routes are not
 * available in that mode, so the app must stay provider-driven.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: process.env.STATIC_EXPORT ? 'export' : undefined,
  reactStrictMode: true,

  // The engine allocates a WebGL context and a dozen canvas textures on
  // construction. Strict Mode's double-invoke is handled explicitly in
  // useEngine, but leaving images unoptimised keeps static export simple.
  images: { unoptimized: true },
};

export default nextConfig;
