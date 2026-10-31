import Editor, { loader } from '@monaco-editor/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { appearanceColors } from './appearance-runtime';
import LoadingPlaceholder from './LoadingPlaceholder';
import ContextMenu from './ContextMenu';
import useLongPress from './useLongPress';
import { Undo2, Redo2, Scissors, Copy, ClipboardPaste, TextSelect, Save } from 'lucide-react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution';
import { editorLanguage } from './editor-language';
import { codeFontFamily } from './typography';
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
export default memo(function CodeEditor({ file, content, dirty = false, onChange, onSave, notify, readonly = false, theme = 'light', focusRequested = false, onFocused }) {
  const saveRef=useRef(onSave);saveRef.current=onSave;
  const editorRef = useRef(), [menu, setMenu] = useState(null);
  const focusRequest = useRef(focusRequested); focusRequest.current = focusRequested;
  function focusWhenReady() {
    if (focusRequest.current && editorRef.current?.getDomNode()?.isConnected) { editorRef.current.focus(); onFocused?.(); }
  }
  useEffect(() => {
    if (!focusRequested) return;
    // Run after the picker portal has restored its previous focus.
    const frame = requestAnimationFrame(focusWhenReady);
    return () => cancelAnimationFrame(frame);
  }, [focusRequested, onFocused]);
  const subscriptions = useRef([]);
  const [status, setStatus] = useState({ line: 1, column: 1, tabSize: 2, insertSpaces: true, language: '' });
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'), update = () => setReducedMotion(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => () => subscriptions.current.forEach(subscription => subscription.dispose()), []);
  useEffect(() => { setMenu(null); }, [file]);
  function openMenu(point) {
    const editor = editorRef.current, model = editor?.getModel();
    if (!model) return;
    const position = !point.preservePosition && editor.getTargetAtClientPoint(point.x, point.y)?.position;
    if (position && !editor.getSelections().some(selection => selection.containsPosition(position))) editor.setPosition(position);
    const selections = editor.getSelections(), text = selections.map(selection => model.getValueInRange(selection)).join('\n');
    setMenu({ x: point.x, y: point.y, label: '代码编辑菜单', model, selections, text, version: model.getVersionId() });
  }
  const longPress = useLongPress(openMenu, { allowInputs: true });
  function closeMenu(focus) { if (focus) editorRef.current?.focus(); setMenu(null); }
  async function clipboard(action) {
    const snapshot = menu;
    try {
      const text = action === 'paste' ? await navigator.clipboard.readText() : snapshot.text;
      if (action === 'paste' && !text) { notify?.('剪贴板中没有可粘贴的文本'); return; }
      if (action !== 'paste') await navigator.clipboard.writeText(text);
      if (action !== 'copy') {
        const editor = editorRef.current, model = editor?.getModel();
        if (model !== snapshot.model || model.isDisposed() || model.getVersionId() !== snapshot.version) throw new Error('文件已发生变化，请重新打开菜单后操作');
        editor.pushUndoStop();
        editor.executeEdits('context-menu', snapshot.selections.map(range => ({ range, text: action === 'cut' ? '' : text, forceMoveMarkers: true })));
        editor.pushUndoStop(); editor.focus();
      }
    } catch (error) { notify?.(error.message?.startsWith('文件已') ? error.message : `无法访问剪贴板，请使用 ${action === 'paste' ? 'Ctrl+V / ⌘V' : action === 'cut' ? 'Ctrl+X / ⌘X' : 'Ctrl+C / ⌘C'} 或检查浏览器权限`, true); }
  }
  function menuItems() {
    const editor = editorRef.current, mac = /Mac|iPhone|iPad/.test(navigator.platform), modifier = mac ? '⌘' : 'Ctrl+';
    return [
      { label: '撤销', icon: Undo2, shortcut: `${modifier}Z`, disabled: readonly, action: () => editor.trigger('context-menu', 'undo', null) },
      { label: '重做', icon: Redo2, shortcut: mac ? '⇧⌘Z' : 'Ctrl+Y', disabled: readonly, action: () => editor.trigger('context-menu', 'redo', null) },
      { separator: true },
      { label: '剪切', icon: Scissors, shortcut: `${modifier}X`, disabled: readonly || !menu.text, action: () => void clipboard('cut') },
      { label: '复制', icon: Copy, shortcut: `${modifier}C`, disabled: !menu.text, action: () => void clipboard('copy') },
      { label: '粘贴', icon: ClipboardPaste, shortcut: `${modifier}V`, disabled: readonly, action: () => void clipboard('paste') },
      { separator: true },
      { label: '全选', icon: TextSelect, shortcut: `${modifier}A`, action: () => { editor.setSelection(editor.getModel().getFullModelRange()); editor.focus(); } },
      { label: '保存', icon: Save, shortcut: `${modifier}S`, disabled: readonly || !dirty, action: () => saveRef.current?.() },
    ];
  }
  // Cursor/status updates must not reapply all Monaco options on every keystroke.
  const options = useMemo(() => ({ contextmenu: false, renderValidationDecorations: 'off', fontSize: 13.5, lineHeight: 22, fontFamily: codeFontFamily(), lineNumbersMinChars: 3, minimap: { enabled: false }, padding: { top: 8, bottom: 8 }, scrollBeyondLastLine: false, automaticLayout: true, readOnly: readonly, tabSize: 2, wordWrap: 'on', glyphMargin: false, renderLineHighlight: 'all', bracketPairColorization: { enabled: false }, guides: { indentation: true, bracketPairs: false }, overviewRulerLanes: 0, hideCursorInOverviewRuler: true, smoothScrolling: !reducedMotion, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false, verticalHasArrows: false, horizontalHasArrows: false } }), [readonly, reducedMotion]);
  const updateTheme = () => {
    const c = appearanceColors();
    const token = name => c[`code-${name}`].slice(1,7);
    const groups = {
      keyword: ['keyword','keyword.flow','keyword.json'],
      type: ['type','type.identifier','namespace','tag','attribute.name'],
      string: ['string','string.key.json','string.value.json','string.html','string.sql','string.yaml','attribute.value','attribute.value.html','attribute.value.xml'],
      number: ['number','number.hex','attribute.value.number','attribute.value.unit'],
      comment: ['comment','annotation'],
      foreground: ['delimiter','delimiter.html','delimiter.xml','identifier','operator'],
    };
    const rules = Object.entries(groups).flatMap(([name, tokens]) => tokens.map(value => ({ token: value, foreground: token(name) })));
    monaco.editor.defineTheme('starvalley-skin', { base: document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs', inherit: true, rules, colors: {
      'editor.background': c.background, 'editor.foreground': c['code-foreground'], 'editorLineNumber.foreground': c['code-line-number'], 'editorLineNumber.activeForeground': c['code-line-number-active'], 'editorCursor.foreground': c.accent,
      'editor.selectionBackground': c['code-selection'], 'editor.lineHighlightBackground': c['code-current-line'], 'editor.lineHighlightBorder': '#00000000', 'editorWidget.background': c.background, 'editorWidget.border': c.line,
      'editorIndentGuide.background1': c['code-indent'], 'editorIndentGuide.activeBackground1': c['code-indent-active'],
      'editorSuggestWidget.background': c.background, 'editorSuggestWidget.foreground': c.foreground, 'editorSuggestWidget.selectedBackground': c.selection, 'editorGutter.background': c.background
    } });
    monaco.editor.setTheme('starvalley-skin');
  };
  useEffect(() => { updateTheme(); window.addEventListener('appearancechange', updateTheme); return () => window.removeEventListener('appearancechange', updateTheme); }, [theme]);
  return <div className="code-editor"><div className="code-editor-surface" {...longPress} onContextMenuCapture={event => { event.preventDefault(); event.stopPropagation(); openMenu({ x: event.clientX, y: event.clientY }); }} onKeyDownCapture={event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault(); event.stopPropagation();
    const editor = editorRef.current, rect = editor?.getDomNode().getBoundingClientRect(), position = editor?.getScrolledVisiblePosition(editor.getPosition());
    if (rect) openMenu({ x: rect.x + (position?.left || 40), y: rect.y + (position?.top || 20) + 22, preservePosition: true });
  }}><Editor path={file} value={content} language={editorLanguage(file, monaco.languages.getLanguages())} theme="starvalley-skin" onChange={onChange} loading={<LoadingPlaceholder label="正在准备编辑器…" variant="code" rows={9}/>} onMount={editor => {
    editorRef.current = editor;
    requestAnimationFrame(focusWhenReady);
    updateTheme(); editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, ()=>saveRef.current?.());
    const update = () => {
      const model = editor.getModel(), position = editor.getPosition(), options = model?.getOptions(), language = monaco.languages.getLanguages().find(item => item.id === model?.getLanguageId());
      const next = { line: position?.lineNumber || 1, column: position?.column || 1, tabSize: options?.tabSize || 2, insertSpaces: options?.insertSpaces ?? true, language: language?.aliases?.[0] || model?.getLanguageId() || '' };
      setStatus(previous => Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
    };
    // The React wrapper creates models before the editor options are applied.
    const configureModel = () => {
      const model = editor.getModel();
      if (model?.getOptions().bracketPairColorizationOptions.enabled) model.updateOptions({ bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false } });
      update();
    };
    subscriptions.current.forEach(subscription => subscription.dispose());
    subscriptions.current = [editor.onDidChangeCursorPosition(update), editor.onDidChangeModel(configureModel), editor.onDidChangeModelOptions(update), editor.onDidChangeModelLanguage(update)];
    configureModel();
  }} options={options} /></div>
    <div className="editor-status"><span className={`editor-save-status ${dirty ? 'is-dirty' : ''}`}><i aria-hidden="true"/>{dirty ? '未保存' : '已保存'}</span><div className="editor-position"><span>行 {status.line}，列 {status.column}</span><span>{status.insertSpaces ? '空格' : '制表符'}: {status.tabSize}</span><span>UTF-8</span><span>{status.language}</span></div></div>
    {menu && <ContextMenu menu={menu} items={menuItems()} onClose={closeMenu}/>}
  </div>;
});
