declare module "html-to-text" {
  export function htmlToText(html: string, options?: { wordwrap?: string | false | number }): string;
}
