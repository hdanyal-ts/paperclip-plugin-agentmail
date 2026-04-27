declare module "pdf-parse" {
  function pdfParse(
    data: Buffer,
    options?: unknown,
  ): Promise<{ numpages: number; text: string; info?: unknown; metadata?: unknown }>;
  export default pdfParse;
}
