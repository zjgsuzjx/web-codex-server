import 'react';

declare module 'react' {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}

declare global {
  var MonacoEnvironment: import('monaco-editor').Environment | undefined;
}
