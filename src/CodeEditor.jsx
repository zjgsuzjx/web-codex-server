import Editor, { loader } from '@monaco-editor/react';
import { memo, useEffect, useRef } from 'react';
import { appearanceColors } from './appearance-runtime';
import LoadingPlaceholder from './LoadingPlaceholder';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution';
import { editorLanguage } from './editor-language';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
globalThis.MonacoEnvironment = { getWorker(_id, label) { if (label === 'json') return new JsonWorker(); if (['css','scss','less'].includes(label)) return new CssWorker(); if (['html','handlebars','razor'].includes(label)) return new HtmlWorker(); if (['typescript','javascript'].includes(label)) return new TsWorker(); return new EditorWorker(); } };
loader.config({ monaco });
for (const defaults of [monaco.languages.typescript.javascriptDefaults, monaco.languages.typescript.typescriptDefaults]) defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true });
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false });
for (const defaults of [monaco.languages.css.cssDefaults, monaco.languages.css.scssDefaults, monaco.languages.css.lessDefaults]) defaults.setOptions({ validate: false });
export default memo(function CodeEditor({ file, content, onChange, onSave, readonly = false, theme = 'light' }) {
  const saveRef=useRef(onSave);saveRef.current=onSave;
  const updateTheme = () => {
    const c = appearanceColors();
    monaco.editor.defineTheme('starvalley-skin', { base: document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs', inherit: true, rules: [], colors: {
      'editor.background': c.background, 'editor.foreground': c.foreground, 'editorLineNumber.foreground': c.muted, 'editorCursor.foreground': c.accent,
      'editor.selectionBackground': c.selection, 'editor.lineHighlightBackground': c.highlight, 'editorWidget.background': c.background, 'editorWidget.border': c.line,
      'editorSuggestWidget.background': c.background, 'editorSuggestWidget.foreground': c.foreground, 'editorSuggestWidget.selectedBackground': c.selection, 'editorGutter.background': c.background
    } });
    monaco.editor.setTheme('starvalley-skin');
  };
  useEffect(() => { updateTheme(); window.addEventListener('appearancechange', updateTheme); return () => window.removeEventListener('appearancechange', updateTheme); }, [theme]);
  return <Editor path={file} value={content} language={editorLanguage(file, monaco.languages.getLanguages())} theme="starvalley-skin" onChange={onChange} loading={<LoadingPlaceholder label="正在准备编辑器…" variant="code" rows={9}/>} onMount={editor => { updateTheme(); editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, ()=>saveRef.current?.()); }} options={{ renderValidationDecorations: 'off', fontSize: 13, lineHeight: 22, fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace", minimap: { enabled: false }, padding: { top: 16 }, scrollBeyondLastLine: false, automaticLayout: true, readOnly: readonly, tabSize: 2, wordWrap: 'on', smoothScrolling: true, scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9, useShadows: false, verticalHasArrows: false, horizontalHasArrows: false } }} />;
});
