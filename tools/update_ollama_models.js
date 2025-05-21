/* eslint-disable @typescript-eslint/no-require-imports */
const { JSDOM } = require('jsdom')
const path = require('path')
const fs = require('fs')

const listOllamaModels = async (q) => {

  const response = await fetch(`https://ollama.com/search?c=${q}`);
  const html = await response.text();

  // Parse the HTML and extract all <span x-test-search-response-title>
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const spans = doc.querySelectorAll('span[x-test-search-response-title]');
  const titles = Array.from(spans).map(span => span.textContent.trim());
  return titles.sort();

}

const updateOllama = async(content, q, tr, regex, template) => {

  const models = await listOllamaModels(q)
  const code = models.map(tool => `      '${tr(tool)}',`).join('\n')

  return content.replace(
    regex, template.replace(/{{models}}/g, code)
  );

}

(async () => {

  const filePath = path.resolve(__dirname, '../src/providers/ollama.ts')
  let fileContent = fs.readFileSync(filePath, 'utf8')

  fileContent = await updateOllama(
    fileContent, 'tools', (tool) => tool,
    /modelSupportsTools\(model: string\): boolean \{[\s\S]*?\}/,
    `modelSupportsTools(model: string): boolean {
    return [
{{models}}
    ].includes(model.split(':')[0])
  }`
  )

  fileContent = await updateOllama(
    fileContent, 'vision', (tool) => `${tool}:*`,
    /getVisionModels\(\): string\[\] \{[\s\S]*?\}/,
    `getVisionModels(): string[] {
    return [
{{models}}
    ]
  }`
  )

  fs.writeFileSync(filePath, fileContent, 'utf8');
  console.log('Updated ollama.ts successfully');

}
)()
