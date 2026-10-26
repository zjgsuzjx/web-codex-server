import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { codeLanguage, MAX_HIGHLIGHT_LENGTH } from './code-language.js';

// Also color calls and enum/member access in short C# excerpts without declarations.
function csharpExcerpt(highlighter) {
  const grammar = csharp(highlighter);
  // The numeric separator rule also matches a leading underscore on field names.
  const numbers = grammar.contains.findIndex(mode => mode.className === 'number');
  grammar.contains.splice(numbers, 0, { match: /\b_[A-Za-z_]\w*/, relevance: 0 });
  grammar.contains.push(
    { scope: 'title.function', match: /\b[A-Za-z_]\w*(?=\s*\()/, relevance: 0 },
    { scope: 'type', match: /\b[A-Z]\w*(?=\.)/, relevance: 0 },
    { scope: 'property', match: /\.\s*[A-Za-z_]\w*/, relevance: 0 },
  );
  return grammar;
}

const lowlight = createLowlight({ bash, c, cpp, csharp: csharpExcerpt, css, diff, dockerfile, go, ini, java, javascript, json, markdown, powershell, python, rust, sql, typescript, xml, yaml });
const autoLanguages = ['javascript', 'python', 'csharp', 'json', 'bash', 'sql', 'xml', 'css', 'cpp', 'java', 'rust', 'go'];

export function highlightCode(code, fence = '') {
  const language = codeLanguage(fence), plain = { language, tree: null, detected: false };
  if (!code.trim() || code.length > MAX_HIGHLIGHT_LENGTH || language.id === 'plaintext') return plain;
  try {
    if (language.grammar) return { ...plain, tree: lowlight.highlight(language.grammar, code) };
    // Do not reinterpret an explicit unsupported language, or repeatedly guess huge blocks.
    if (fence || code.length > 4_000) return plain;
    const tree = lowlight.highlightAuto(code, { subset: autoLanguages });
    if (tree.data.relevance >= 4) return { tree, language: codeLanguage(tree.data.language), detected: true };
  } catch {
    // Partial streamed code and unsupported syntax must remain readable and copyable.
  }
  return plain;
}
