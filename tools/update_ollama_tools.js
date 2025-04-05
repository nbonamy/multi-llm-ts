/* eslint-disable @typescript-eslint/no-require-imports */
const { JSDOM } = require('jsdom')
const path = require('path')
const fs = require('fs')

const listOllamaTools = async () => {

  const response = await fetch('https://ollama.com/search?c=tools');
  const html = await response.text();

  // Parse the HTML and extract all <span x-test-search-response-title>
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const spans = doc.querySelectorAll('span[x-test-search-response-title]');
  const titles = Array.from(spans).map(span => span.textContent.trim());
  return titles.sort();

}

(async () => {

  const tools = await listOllamaTools()
  const code = tools.map(tool => `      '${tool}',`).join('\n')

  const filePath = path.resolve(__dirname, '../src/providers/ollama.ts')
  const fileContent = fs.readFileSync(filePath, 'utf8')

  const updatedContent = fileContent.replace(
    /modelSupportsTools\(model: string\): boolean \{[\s\S]*?\}/,
    `modelSupportsTools(model: string): boolean {
    return [
${code}
    ].includes(model.split(':')[0])
  }`
  );

  fs.writeFileSync(filePath, updatedContent, 'utf8');
  console.log('Updated ollama.ts successfully');

}
)()
