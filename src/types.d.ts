// Cloudflare Workers `[[rules]] type = "Data"` imports — vegeu wrangler.toml.
// Els PNGs a src/private/ s'empotren al bundle del worker com a ArrayBuffer
// (no exposats via el binding ASSETS) i es serveixen com a `Uint8Array` al
// codi. Les declaracions aquí permeten a TypeScript reconèixer els imports.
declare module "*.png" {
  const content: ArrayBuffer;
  export default content;
}
