/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next dev` and `next build` both own .next, so running a build while the
  // dev server is up replaces the chunks it has loaded and every page 500s with
  // MODULE_NOT_FOUND. Setting NEXT_DIST_DIR sends a build somewhere else:
  //   NEXT_DIST_DIR=.next-build npm run build
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
