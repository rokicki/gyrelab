// The build reads .html as text, so the page's markup can travel with
// the program (see main.ts).
declare module "*.html" {
  const markup: string;
  export default markup;
}
