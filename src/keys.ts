// Клавиши перезагрузки страницы. В релизной сборке main.ts их глушит: перезагрузка окна сбрасывает ядро,
// как «Забыть токен», и посреди операции это неожиданно. Контекстное меню не трогаем: им вставляют токен.

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** F5, Ctrl+F5, Ctrl/Cmd+R, Ctrl/Cmd+Shift+R. R — по физической клавише: в русской раскладке `key` равен «к». */
export function isReloadKey(e: KeyLike): boolean {
  if (e.key === 'F5' || e.code === 'F5') return true;
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyR' || e.key.toLowerCase() === 'r');
}
