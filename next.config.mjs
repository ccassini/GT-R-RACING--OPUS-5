/**
 * Two deployment shapes from one codebase.
 *
 * Default: a normal Next server, which is what the chain integration
 * will eventually want — an indexer proxy or an RPC route can hold its
 * API key server-side instead of shipping it to the browser.
 *
 * STATIC_EXPORT=1: emits a plain `out/` directory for static hosting
 * (GitHub Pages, HuggingFace Spaces, any CDN). Server routes are not
 * available in that mode, so the app must stay provider-driven.
 *
 * GitHub Pages project URL:
 *   https://ccassini.github.io/GT-R-RACING--OPUS-5/
 * so static export sets basePath / assetPrefix to the repo name.
 *
 * @type {import('next').NextConfig}
 */
const isStaticExport = process.env.STATIC_EXPORT === '1';
const pagesBasePath = '/GT-R-RACING--OPUS-5';

const nextConfig = {
  output: isStaticExport ? 'export' : undefined,
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        basePath: pagesBasePath,
        assetPrefix: pagesBasePath,
        trailingSlash: true,
        env: {
          NEXT_PUBLIC_BASE_PATH: pagesBasePath,
        },
      }
    : {
        env: {
          NEXT_PUBLIC_BASE_PATH: '',
        },
      }),

  // The engine allocates a WebGL context and a dozen canvas textures on
  // construction. Strict Mode's double-invoke is handled explicitly in
  // useEngine, but leaving images unoptimised keeps static export simple.
  images: { unoptimized: true },
};

export default nextConfig;
